const { createHash, randomUUID } = require('node:crypto');
const { constants } = require('node:fs');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const maxFileBytes = 16 * 1024 * 1024;
const maxRequestBytes = 6 * maxFileBytes + 4096;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const loopbackHosts = ['127.0.0.1', 'localhost', '[::1]'];
const windowsDeviceName = /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])$/i;

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function validName(name) {
  return name.length > 0
    && name.isWellFormed()
    && name.toLowerCase() !== '.git'
    && !/[/\\<>:"|?*\u0000-\u001f]/.test(name)
    && !/[. ]$/.test(name)
    && !windowsDeviceName.test(name.split('.')[0].trimEnd());
}

function relativeParts(value, isFile) {
  if (!isFile && value === '') return [];
  if (typeof value !== 'string') throw new RequestError(400, 'A relative path is required.');
  const parts = value.split('/');
  if (!parts.every(validName) || (isFile && !/\.qmd$/i.test(parts.at(-1)))) {
    throw new RequestError(400, isFile ? 'Choose a relative .qmd path.' : 'Choose a relative directory path.');
  }
  return parts;
}

async function resolveDirectory(root, parts) {
  let directory = root;
  for (const part of parts) {
    directory = path.join(directory, part);
    if (!(await fs.lstat(directory)).isDirectory()) {
      throw new RequestError(400, 'Choose a directory without symbolic links.');
    }
  }
  if (path.relative(directory, await fs.realpath(directory)) !== '') {
    throw new RequestError(400, 'Choose a directory without symbolic links.');
  }
  return directory;
}

async function listDirectory(root, directory) {
  const parts = relativeParts(directory, false);
  const absolutePath = await resolveDirectory(root, parts);
  const entries = await fs.readdir(absolutePath, { withFileTypes: true });
  const directories = [];
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!validName(entry.name)) continue;
    const item = { name: entry.name, path: [...parts, entry.name].join('/') };
    if (entry.isDirectory()) directories.push(item);
    else if (entry.isFile() && /\.qmd$/i.test(entry.name)) files.push(item);
  }
  return { directory, directories, files };
}

function revisionOf(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readFile(file) {
  if (!(await fs.lstat(file)).isFile() || path.relative(file, await fs.realpath(file)) !== '') {
    throw new RequestError(400, 'Choose a regular .qmd file without symbolic links.');
  }
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new RequestError(400, 'Choose a regular .qmd file.');
    if (stat.size > maxFileBytes) throw new RequestError(413, 'The document exceeds the 16 MiB size limit.');
    const bytes = await handle.readFile();
    if (bytes.length > maxFileBytes) throw new RequestError(413, 'The document exceeds the 16 MiB size limit.');
    return { bytes, mode: stat.mode & 0o777, revision: revisionOf(bytes) };
  } finally {
    await handle.close();
  }
}

async function readDocument(root, relativePath) {
  const parts = relativeParts(relativePath, true);
  const directory = await resolveDirectory(root, parts.slice(0, -1));
  const { bytes, revision } = await readFile(path.join(directory, parts.at(-1)));
  try {
    return { path: relativePath, content: decoder.decode(bytes), revision };
  } catch {
    throw new RequestError(422, 'The document must be UTF-8 text.');
  }
}

async function matchRevision(file, revision) {
  let current;
  try {
    current = await readFile(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if ((current?.revision ?? null) !== revision) {
    const message = revision === null
      ? 'A file already exists at that path. Choose a different filename.'
      : 'The file changed on disk. Reopen it before saving or use Save As.';
    throw new RequestError(409, message);
  }
  return current;
}

async function saveDocument(root, body) {
  const { path: relativePath, content, revision } = body ?? {};
  const parts = relativeParts(relativePath, true);
  if (typeof content !== 'string' || !content.isWellFormed()
      || (revision !== null && (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)))) {
    throw new RequestError(400, 'Supply document content and its revision, or null for a new file.');
  }
  const bytes = Buffer.from(content, 'utf8');
  if (bytes.length > maxFileBytes) throw new RequestError(413, 'The document exceeds the 16 MiB size limit.');

  const directoryParts = parts.slice(0, -1);
  const directory = await resolveDirectory(root, directoryParts);
  const file = path.join(directory, parts.at(-1));
  const current = await matchRevision(file, revision);
  const temporary = path.join(directory, `.quartorium-${randomUUID()}.tmp`);
  const handle = await fs.open(temporary, 'wx', current?.mode ?? 0o666);
  try {
    try {
      if (current) await handle.chmod(current.mode);
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    // Re-check the directory and existing contents before publishing the prepared file.
    await resolveDirectory(root, directoryParts);
    if (revision === null) {
      // Link atomically only when the destination does not exist.
      await fs.link(temporary, file);
    } else {
      await matchRevision(file, revision);
      await fs.rename(temporary, file);
    }
    return { path: relativePath, revision: revisionOf(bytes) };
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}

async function readJson(request) {
  if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    throw new RequestError(415, 'Send JSON with Content-Type: application/json.');
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > maxRequestBytes) throw new RequestError(413, 'The request exceeds the document size limit.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(decoder.decode(Buffer.concat(chunks, length)));
  } catch {
    throw new RequestError(400, 'Send valid UTF-8 JSON.');
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

function sendError(response, error) {
  if (error instanceof RequestError) return sendJson(response, error.status, { error: error.message });
  if (error.code === 'ENOENT') return sendJson(response, 404, { error: 'The file or directory does not exist.' });
  if (error.code === 'EEXIST') return sendJson(response, 409, { error: 'A file already exists at that path.' });
  if (['EACCES', 'EPERM', 'ELOOP'].includes(error.code)) {
    return sendJson(response, 403, { error: 'The file or directory is inaccessible.' });
  }
  console.error('Local workspace request failed:', error.message);
  return sendJson(response, 500, { error: 'Could not access the local workspace.' });
}

function localOrigins(port) {
  const origins = new Set(loopbackHosts.flatMap(host => [`http://${host}:5173`, `http://${host}:${port}`]));
  const configured = process.env.QUARTORIUM_FRONTEND_ORIGIN;
  if (configured) {
    const url = new URL(configured);
    if (url.protocol !== 'http:' || !loopbackHosts.includes(url.hostname) || configured !== url.origin) {
      throw new Error('QUARTORIUM_FRONTEND_ORIGIN must be an HTTP loopback origin.');
    }
    origins.add(configured);
  }
  return origins;
}

async function startLocalServer(workspace, port = 8001) {
  if (typeof workspace !== 'string' || !workspace.trim()) throw new Error('A local workspace directory is required.');
  const root = await fs.realpath(path.resolve(workspace));
  if (!(await fs.stat(root)).isDirectory()) throw new Error('The local workspace must be a directory.');

  let latestSave = Promise.resolve();
  let hosts;
  let origins;
  const server = http.createServer({ requestTimeout: 30_000 }, async (request, response) => {
    try {
      const { host, origin, 'x-quartorium-local': local, 'sec-fetch-site': fetchSite } = request.headers;
      if (request.socket.remoteAddress !== '127.0.0.1' || !hosts.has(host?.toLowerCase())
          || local !== '1' || (origin !== undefined && !origins.has(origin))
          || (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none')) {
        throw new RequestError(403, 'Local workspace requests must come from this app on localhost.');
      }
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/api/local/files') {
        return sendJson(response, 200, await listDirectory(root, url.searchParams.get('directory') ?? ''));
      }
      if (request.method === 'GET' && url.pathname === '/api/local/file') {
        return sendJson(response, 200, await readDocument(root, url.searchParams.get('path')));
      }
      if (request.method === 'PUT' && url.pathname === '/api/local/file') {
        const body = await readJson(request);
        const saved = latestSave.then(() => saveDocument(root, body));
        latestSave = saved.catch(() => {});
        return sendJson(response, 200, await saved);
      }
      throw new RequestError(404, 'Unknown local workspace endpoint.');
    } catch (error) {
      request.resume();
      sendError(response, error);
    }
  });

  // Validate the override before opening a listening socket.
  origins = localOrigins(port);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const actualPort = server.address().port;
      hosts = new Set(loopbackHosts.map(host => `${host}:${actualPort}`));
      for (const host of hosts) origins.add(`http://${host}`);
      server.removeListener('error', reject);
      resolve();
    });
  });
  return server;
}

module.exports = { startLocalServer };
