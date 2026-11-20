import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import LocalVisualEditor from '../components/editor/LocalVisualEditor';
import './LocalEditorPage.css';

const blankDocument = { path: null, revision: null, original: '', savedSource: '' };
const backendUnavailable = 'Start the local backend with pnpm start:local <checkout-path> from the Quartorium folder, then try again.';

async function localRequest(endpoint, options = {}) {
  let response;
  try {
    response = await fetch(`/api/local/${endpoint}`, {
      ...options,
      headers: { 'X-Quartorium-Local': '1', ...options.headers },
    });
  } catch {
    throw new Error(backendUnavailable);
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || backendUnavailable);
  return result;
}

function parentDirectory(path) {
  return path.split('/').slice(0, -1).join('/');
}

function toFileSource(source, original) {
  const lineEnding = original.match(/\r\n|\r|\n/)?.[0] ?? '\n';
  const bom = original.startsWith('\uFEFF') ? '\uFEFF' : '';
  return bom + source.replaceAll('\n', lineEnding);
}

export default function LocalEditorPage() {
  const [document, setDocument] = useState(blankDocument);
  const [source, setSource] = useState('');
  const [mode, setMode] = useState('visual');
  const [documentVersion, setDocumentVersion] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pickerMode, setPickerMode] = useState(null);
  const [listing, setListing] = useState(null);
  const [fileName, setFileName] = useState('');
  const picker = useRef(null);
  const dirty = source !== document.savedSource;

  useEffect(() => {
    if (!dirty) return;
    function warnBeforeLeaving(event) {
      event.preventDefault();
      event.returnValue = true;
    }
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [dirty]);

  function mayDiscard() {
    return !dirty || window.confirm('Discard unsaved changes?');
  }

  function newDocument() {
    if (!mayDiscard()) return;
    setDocument(blankDocument);
    setSource('');
    setDocumentVersion(version => version + 1);
    setError('');
    setStatus('');
  }

  async function browse(directory) {
    setError('');
    setBusy(true);
    try {
      setListing(await localRequest(`files?${new URLSearchParams({ directory })}`));
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  function showPicker(mode) {
    setPickerMode(mode);
    setListing(null);
    setFileName(document.path?.split('/').at(-1) ?? 'untitled.qmd');
    picker.current.showModal();
    void browse(document.path ? parentDirectory(document.path) : '');
  }

  function closePicker() {
    picker.current.close();
  }

  function resetPicker() {
    setPickerMode(null);
    setError('');
  }

  async function openDocument(path) {
    if (!mayDiscard()) return;
    setError('');
    setBusy(true);
    try {
      const opened = await localRequest(`file?${new URLSearchParams({ path })}`);
      const savedSource = opened.content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
      setDocument({ path: opened.path, revision: opened.revision, original: opened.content, savedSource });
      setSource(savedSource);
      setDocumentVersion(version => version + 1);
      setStatus('');
      closePicker();
    } catch (failure) {
      setError(`Could not open the file. ${failure.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveDocument(path, revision) {
    const { original } = document;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const content = dirty ? toFileSource(source, original) : original;
      const saved = await localRequest('file', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content, revision }),
      });
      setDocument({ path: saved.path, revision: saved.revision, original: content, savedSource: source });
      setStatus(`Saved ${saved.path}`);
      if (pickerMode === 'save') closePicker();
    } catch (failure) {
      setError(`Could not save the file. ${failure.message}`);
    } finally {
      setBusy(false);
    }
  }

  function saveAs(event) {
    event.preventDefault();
    const name = fileName.trim();
    if (!/\.qmd$/i.test(name) || name.includes('/') || name.includes('\\')) {
      setError('Enter a filename ending in .qmd and use the folder list to choose where to save it.');
      return;
    }
    const path = listing.directory ? `${listing.directory}/${name}` : name;
    void saveDocument(path, null);
  }

  function changeSource(nextSource) {
    setSource(nextSource);
    setStatus('');
  }

  return (
    <main className="local-editor">
      <header className="local-editor-header">
        <div>
          <h1>Quartorium</h1>
          <p className="local-editor-filename">{document.path ?? 'untitled.qmd'}{dirty && ' · Unsaved changes'}</p>
        </div>
        <Link to="/dashboard" onClick={(event) => { if (busy || !mayDiscard()) event.preventDefault(); }}>Collaboration</Link>
      </header>
      <div className="local-editor-toolbar">
        <button type="button" onClick={newDocument} disabled={busy}>New</button>
        <button type="button" onClick={() => showPicker('open')} disabled={busy}>Open .qmd</button>
        {document.path && (
          <button type="button" className="primary" onClick={() => saveDocument(document.path, document.revision)} disabled={busy || !dirty}>Save</button>
        )}
        <button type="button" className={document.path ? undefined : 'primary'} onClick={() => showPicker('save')} disabled={busy}>Save As</button>
        <div className="local-editor-modes" role="group" aria-label="Editor mode">
          <button type="button" aria-pressed={mode === 'visual'} onClick={() => setMode('visual')} disabled={busy}>Visual</button>
          <button type="button" aria-pressed={mode === 'source'} onClick={() => setMode('source')} disabled={busy}>Source</button>
        </div>
        <span className="local-editor-status" role="status">{status}</span>
      </div>
      {!pickerMode && error && <p className="local-editor-error" role="alert">{error}</p>}
      {mode === 'visual' ? (
        <LocalVisualEditor key={documentVersion} source={source} onChange={changeSource} readOnly={busy} />
      ) : (
        <section className="local-editor-pane">
          <label className="local-editor-pane-title" htmlFor="qmd-source">Quarto source</label>
          <textarea
            id="qmd-source"
            value={source}
            onChange={(event) => changeSource(event.target.value)}
            placeholder="Start writing or open a .qmd file…"
            spellCheck={false}
            readOnly={busy}
          />
        </section>
      )}
      <dialog
        className="local-editor-picker"
        aria-labelledby="local-editor-picker-title"
        onCancel={(event) => { if (busy) event.preventDefault(); }}
        onClose={resetPicker}
        ref={picker}
      >
        <header className="local-editor-picker-header">
          <h2 id="local-editor-picker-title">{pickerMode === 'save' ? 'Save As' : 'Open .qmd'}</h2>
          <button type="button" onClick={closePicker} disabled={busy}>Cancel</button>
        </header>
        <div className="local-editor-picker-location">
          <button
            type="button"
            onClick={() => browse(listing?.directory ? parentDirectory(listing.directory) : '')}
            disabled={busy || listing?.directory === ''}
          >
            {listing ? 'Up one folder' : 'Project root'}
          </button>
          <p className="local-editor-filename">{listing?.directory || 'Project root'}</p>
        </div>
        {busy && <p role="status">Working…</p>}
        {error && <p className="local-editor-error" role="alert">{error}</p>}
        {listing && (
          <ul className="local-editor-picker-files">
            {listing.directories.map(({ name, path }) => (
              <li key={path}><button type="button" onClick={() => browse(path)} disabled={busy}>{name}/</button></li>
            ))}
            {listing.files.map(({ name, path }) => (
              <li key={path}>
                <button type="button" onClick={() => pickerMode === 'save' ? setFileName(name) : void openDocument(path)} disabled={busy}>{name}</button>
              </li>
            ))}
            {!listing.directories.length && !listing.files.length && <li>No folders or .qmd files here.</li>}
          </ul>
        )}
        {pickerMode === 'save' && listing && (
          <form className="local-editor-picker-save" onSubmit={saveAs}>
            <label htmlFor="local-editor-filename">Filename</label>
            <input id="local-editor-filename" value={fileName} onChange={(event) => setFileName(event.target.value)} disabled={busy} required />
            <button type="submit" className="primary" disabled={busy}>Save</button>
          </form>
        )}
      </dialog>
    </main>
  );
}
