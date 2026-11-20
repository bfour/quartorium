import { useLayoutEffect, useRef, useState } from 'react';
import { baseKeymap, lift, setBlockType, toggleMark, wrapIn } from '@tiptap/pm/commands';
import { history, redo, undo } from '@tiptap/pm/history';
import { keymap } from '@tiptap/pm/keymap';
import { liftListItem, sinkListItem, splitListItem, wrapInList } from '@tiptap/pm/schema-list';
import { EditorState } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';
import { parseQmd, serializeQmd, visualSchema } from './localQmd.js';
import './LocalVisualEditor.css';

const { nodes, marks } = visualSchema;
const toggleBold = toggleMark(marks.strong);
const toggleItalic = toggleMark(marks.em);

function inBlock(state, nodeType, attrs) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type === nodeType && (!attrs || Object.entries(attrs).every(([name, value]) => node.attrs[name] === value))) {
      return true;
    }
  }
  return false;
}

function hasMark(state, mark) {
  const { empty, from, to, $from } = state.selection;
  return empty
    ? Boolean(mark.isInSet(state.storedMarks ?? $from.marks()))
    : state.doc.rangeHasMark(from, to, mark);
}

function toggleList(nodeType) {
  const wrap = wrapInList(nodeType);
  const unwrap = liftListItem(nodes.list_item);
  return (state, dispatch) => inBlock(state, nodeType) ? unwrap(state, dispatch) : wrap(state, dispatch);
}

const wrapInQuote = wrapIn(nodes.blockquote);
const formatting = [
  {
    name: 'Paragraph',
    run: setBlockType(nodes.paragraph),
    active: (state) => inBlock(state, nodes.paragraph),
  },
  ...[1, 2, 3].map((level) => ({
    name: `Heading ${level}`,
    run: setBlockType(nodes.heading, { level }),
    active: (state) => inBlock(state, nodes.heading, { level }),
  })),
  { name: 'Bold', run: toggleBold, active: (state) => hasMark(state, marks.strong) },
  { name: 'Italic', run: toggleItalic, active: (state) => hasMark(state, marks.em) },
  { name: 'Inline code', run: toggleMark(marks.code), active: (state) => hasMark(state, marks.code) },
  {
    name: 'Bulleted list',
    run: toggleList(nodes.bullet_list),
    active: (state) => inBlock(state, nodes.bullet_list),
  },
  {
    name: 'Numbered list',
    run: toggleList(nodes.ordered_list),
    active: (state) => inBlock(state, nodes.ordered_list),
  },
  {
    name: 'Quote',
    run: (state, dispatch) => inBlock(state, nodes.blockquote) ? lift(state, dispatch) : wrapInQuote(state, dispatch),
    active: (state) => inBlock(state, nodes.blockquote),
  },
  { name: 'Undo', run: undo },
  { name: 'Redo', run: redo },
];

function rawBlocks(doc) {
  const blocks = [];
  doc.forEach((node) => { if (node.type === nodes.qmdRaw) blocks.push(node); });
  return blocks;
}

function preserveRawBlocks(before, after) {
  const original = rawBlocks(before);
  const updated = rawBlocks(after);
  return original.length === updated.length && original.every((node, index) => node.eq(updated[index]));
}

function editorAttributes(readOnly) {
  return {
    role: 'textbox',
    'aria-label': 'Visual Quarto editor',
    'aria-multiline': 'true',
    'aria-readonly': String(readOnly),
  };
}

export default function LocalVisualEditor({ source, onChange, readOnly }) {
  // The page remounts the editor when opening a file or switching from Source.
  const [initialSource] = useState(source);
  const [editorState, setEditorState] = useState(null);
  const [error, setError] = useState('');
  const container = useRef(null);
  const editor = useRef(null);
  const changeHandler = useRef(onChange);

  useLayoutEffect(() => {
    changeHandler.current = onChange;
  }, [onChange]);

  useLayoutEffect(() => {
    let doc;
    try {
      doc = parseQmd(initialSource);
    } catch {
      setError('This document could not open in the visual editor. Switch to Source to edit it.');
      return;
    }

    const state = EditorState.create({
      doc,
      plugins: [
        history(),
        keymap({
          'Mod-z': undo,
          'Shift-Mod-z': redo,
          'Mod-y': redo,
          'Mod-b': toggleBold,
          'Mod-i': toggleItalic,
          Enter: splitListItem(nodes.list_item),
          Tab: sinkListItem(nodes.list_item),
          'Shift-Tab': liftListItem(nodes.list_item),
        }),
        keymap(baseKeymap),
      ],
    });
    const view = new EditorView(container.current, {
      state,
      handleDOMEvents: {
        click: (_view, event) => {
          if (!(event.target instanceof Element) || !event.target.closest('a')) return false;
          event.preventDefault();
          return true;
        },
      },
      dispatchTransaction(transaction) {
        const next = view.state.apply(transaction);
        if (next.doc !== view.state.doc) {
          if (!view.editable || !preserveRawBlocks(doc, next.doc)) {
            if (view.editable) setError('Switch to Source to change protected Quarto blocks.');
            view.updateState(view.state);
            return;
          }
          try {
            const updatedSource = next.doc.eq(doc) ? initialSource : serializeQmd(next.doc);
            changeHandler.current(updatedSource);
          } catch {
            setError('This edit could not be saved as Quarto source. Switch to Source to make the change.');
            view.updateState(view.state);
            return;
          }
          setError('');
        }
        view.updateState(next);
        setEditorState(next);
      },
    });
    editor.current = view;
    setEditorState(state);
    return () => {
      editor.current = null;
      view.destroy();
    };
  }, [initialSource]);

  useLayoutEffect(() => {
    editor.current?.setProps({ editable: () => !readOnly, attributes: editorAttributes(readOnly) });
  }, [readOnly]);

  function runCommand(command) {
    const view = editor.current;
    if (view?.editable) {
      command(view.state, view.dispatch, view);
      view.focus();
    }
  }

  return (
    <div className="local-visual-editor">
      <div className="local-visual-editor-formatting" role="group" aria-label="Text formatting">
        {formatting.map(({ name, run, active }) => (
          <button
            key={name}
            type="button"
            aria-pressed={editorState ? active?.(editorState) : undefined}
            disabled={readOnly || !editorState || !run(editorState)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runCommand(run)}
          >
            {name}
          </button>
        ))}
      </div>
      {error && <p className="local-editor-error" role="alert">{error}</p>}
      <div className="local-visual-editor-document" ref={container} />
    </div>
  );
}
