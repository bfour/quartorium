const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { startLocalServer } = require('../src/localServer');

test('local mode edits Quarto files in place and keeps newer disk changes', async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'quartorium-local-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  await fs.mkdir(path.join(workspace, 'chapters'));
  const file = path.join(workspace, 'chapters', 'intro.qmd');
  const original = '\uFEFF---\r\ntitle: Project\r\n---\r\n';
  await fs.writeFile(file, original);
  await fs.writeFile(path.join(workspace, 'notes.txt'), 'Private notes');

  const server = await startLocalServer(workspace, 0);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/local`;
  const headers = { 'X-Quartorium-Local': '1' };
  const read = (filePath) => fetch(`${baseUrl}/file?path=${encodeURIComponent(filePath)}`, { headers });
  const save = (filePath, content, revision) => fetch(`${baseUrl}/file`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath, content, revision }),
  });

  const listing = await fetch(`${baseUrl}/files`, { headers });
  assert.equal(listing.status, 200);
  assert.deepEqual(await listing.json(), {
    directory: '',
    directories: [{ name: 'chapters', path: 'chapters' }],
    files: [],
  });

  const opened = await read('chapters/intro.qmd');
  assert.equal(opened.status, 200);
  const document = await opened.json();
  assert.equal(document.content, original);
  const updated = `${original}\r\n# Introduction\r\n`;
  const saved = await save('chapters/intro.qmd', updated, document.revision);
  assert.equal(saved.status, 200);
  const { revision } = await saved.json();
  assert.equal(await fs.readFile(file, 'utf8'), updated);

  await fs.writeFile(file, '# Written by Git\n');
  assert.equal((await save('chapters/intro.qmd', 'Stale change', revision)).status, 409);
  assert.equal(await fs.readFile(file, 'utf8'), '# Written by Git\n');

  const created = await save('chapters/new.qmd', '# New\n', null);
  assert.equal(created.ok, true);
  assert.equal((await save('chapters/new.qmd', 'Duplicate', null)).status, 409);
  assert.equal(await fs.readFile(path.join(workspace, 'chapters', 'new.qmd'), 'utf8'), '# New\n');

  assert.equal((await fetch(`${baseUrl}/files`)).status, 403);
  assert.equal((await fetch(`${baseUrl}/files`, { headers: { ...headers, Origin: 'https://example.com' } })).status, 403);
  assert.ok((await read('notes.txt')).status >= 400);
  assert.ok((await read('../intro.qmd')).status >= 400);
});
