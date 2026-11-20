import assert from 'node:assert/strict';
import test from 'node:test';
import { Transform } from '@tiptap/pm/transform';
import { parseQmd, serializeQmd, visualSchema } from './localQmd.js';

const source = [
  '---',
  'title: "Report"',
  'format: html',
  '---',
  '',
  'Introduction',
  '============',
  '',
  'Original **prose** with _emphasis_.',
  '',
  '::: {.callout-note}',
  'Do not reformat the callout.',
  ':::',
  '',
  '```{python}',
  '#| label: fig-example',
  'print("example")',
  '```',
  '',
  'See @fig-example and [@reference].',
  '',
  '| A | B |',
  '|:-:|---|',
  '| 1 | 2 |',
  '',
  'Last paragraph  ',
  'with a hard break.',
  '',
].join('\n');

test('visual mode round-trips a Quarto file before any edits', () => {
  for (const text of ['', '\n \n', source, source.trimEnd()]) {
    assert.equal(serializeQmd(parseQmd(text)), text);
  }
});

test('visual edits preserve neighboring Quarto syntax and unchanged Markdown', () => {
  const doc = parseQmd(source);
  let textPosition;
  doc.descendants((node, position) => {
    if (node.text?.startsWith('Original ')) textPosition = position;
  });
  assert.ok(Number.isInteger(textPosition));
  const edit = new Transform(doc);
  edit.replaceWith(textPosition, textPosition + 'Original'.length, visualSchema.text('Revised'));
  const expected = source.replace('Original **prose** with _emphasis_.', 'Revised **prose** with *emphasis*.');
  assert.equal(serializeQmd(edit.doc), expected);
});
