import { useDeferredValue, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './LocalEditorPage.css';

const blankDocument = { name: 'untitled.qmd', handle: null, original: '', savedSource: '' };

async function readSource(file) {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
}

function toFileSource(source, original) {
  const lineEnding = original.match(/\r\n|\r|\n/)?.[0] ?? '\n';
  const bom = original.startsWith('\uFEFF') ? '\uFEFF' : '';
  return bom + source.replaceAll('\n', lineEnding);
}

const pickerOptions = {
  types: [{ description: 'Quarto document', accept: { 'text/plain': ['.qmd'] } }],
};

// Keep front matter in the source and omit it from the Markdown preview.
const frontMatter = /^---[ \t]*\n(?:[^\n]*\n)*?(?:---|\.\.\.)[ \t]*(?:\n|$)/;
const previewComponents = {
  img: ({ alt }) => <span>{alt ? `[Image: ${alt}]` : '[Image]'}</span>,
};

export default function LocalEditorPage() {
  const [document, setDocument] = useState(blankDocument);
  const [source, setSource] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const previewSource = useDeferredValue(source);
  const dirty = source !== document.savedSource;
  const canWriteFiles = typeof window.showOpenFilePicker === 'function'
    && typeof window.showSaveFilePicker === 'function';

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
    setError('');
    setStatus('');
  }

  async function loadDocument(file, handle = null) {
    if (!/\.qmd$/i.test(file.name)) throw new Error('Choose a .qmd file.');
    const original = await readSource(file);
    const savedSource = original.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    setDocument({ name: file.name, handle, original, savedSource });
    setSource(savedSource);
    setStatus('');
  }

  async function openDocument() {
    if (!mayDiscard()) return;
    setError('');
    setBusy(true);
    try {
      const [handle] = await window.showOpenFilePicker(pickerOptions);
      await loadDocument(await handle.getFile(), handle);
    } catch (failure) {
      if (failure.name !== 'AbortError') setError(`Could not open the file. ${failure.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveDocument(saveAs = false) {
    const { original } = document;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const handle = saveAs || !document.handle
        ? await window.showSaveFilePicker({ ...pickerOptions, suggestedName: document.name })
        : document.handle;
      if (!/\.qmd$/i.test(handle.name)) throw new Error('Save the file with a .qmd extension.');

      // A Git operation or another editor may have changed the file since we opened it.
      if (!saveAs && document.handle && await readSource(await handle.getFile()) !== original) {
        setError('The file changed on disk. Use Save As to keep your edits in another file.');
        return;
      }
      const content = dirty ? toFileSource(source, original) : original;
      const writable = await handle.createWritable();
      try {
        await writable.write(content);
        await writable.close();
      } catch (failure) {
        await writable.abort().catch(() => {});
        throw failure;
      }
      setDocument({ name: handle.name, handle, original: content, savedSource: source });
      setStatus(`Saved ${handle.name}`);
    } catch (failure) {
      if (failure.name !== 'AbortError') setError(`Could not save the file. ${failure.message}`);
    } finally {
      setBusy(false);
    }
  }

  const preview = previewSource.replace(frontMatter, '');

  return (
    <main className="local-editor">
      <header className="local-editor-header">
        <div>
          <h1>Quartorium</h1>
          <p className="local-editor-filename">{document.name}{dirty && ' · Unsaved changes'}</p>
        </div>
        <Link to="/dashboard" onClick={(event) => { if (!mayDiscard()) event.preventDefault(); }}>Collaboration</Link>
      </header>
      <div className="local-editor-toolbar">
        <button type="button" onClick={newDocument} disabled={busy}>New</button>
        <button type="button" onClick={openDocument} disabled={busy || !canWriteFiles}>Open .qmd</button>
        {document.handle && (
          <button type="button" className="primary" onClick={() => saveDocument()} disabled={busy || !dirty}>Save</button>
        )}
        <button type="button" className={document.handle ? undefined : 'primary'} onClick={() => saveDocument(true)} disabled={busy || !canWriteFiles}>Save As</button>
        <span className="local-editor-status" role="status">{status}</span>
      </div>
      {!canWriteFiles && <p className="local-editor-error">Open this editor in Chrome or Edge on localhost to edit files on disk.</p>}
      {error && <p className="local-editor-error" role="alert">{error}</p>}
      <div className="local-editor-workspace">
        <section className="local-editor-pane">
          <label className="local-editor-pane-title" htmlFor="qmd-source">Quarto source</label>
          <textarea
            id="qmd-source"
            value={source}
            onChange={(event) => { setSource(event.target.value); setStatus(''); }}
            placeholder="Start writing or open a .qmd file…"
            spellCheck={false}
            readOnly={busy}
          />
        </section>
        <section className="local-editor-pane" aria-labelledby="markdown-preview-title">
          <h2 className="local-editor-pane-title" id="markdown-preview-title">Markdown preview</h2>
          <div className="local-editor-preview">
            <Markdown remarkPlugins={[remarkGfm]} components={previewComponents} skipHtml>{preview}</Markdown>
          </div>
        </section>
      </div>
    </main>
  );
}
