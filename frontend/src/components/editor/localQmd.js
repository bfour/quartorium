import { MarkdownParser, defaultMarkdownParser, defaultMarkdownSerializer, schema } from '@tiptap/pm/markdown';
import { Schema } from '@tiptap/pm/model';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

const sourceAttrs = {
  qmdIndex: { default: null },
  qmdGap: { default: '' },
  qmdSource: { default: null },
  qmdCanonical: { default: null },
};

function pastedLink(href, title) {
  try {
    const { protocol } = new URL(href, 'https://example.invalid');
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(protocol) ? { href, title } : false;
  } catch {
    return false;
  }
}

let nodes = schema.spec.nodes;
nodes.forEach((name, spec) => {
  if (spec.group !== 'block') return;
  nodes = nodes.update(name, {
    ...spec,
    group: 'block editableBlock',
    content: name === 'blockquote' ? 'editableBlock+' : spec.content,
    attrs: { ...spec.attrs, ...sourceAttrs },
  });
});
nodes = nodes
  .update('doc', {
    ...nodes.get('doc'),
    attrs: { qmdPrefix: { default: '' }, qmdSuffix: { default: '' } },
  })
  .update('list_item', { ...nodes.get('list_item'), content: 'editableBlock+' })
  .update('image', {
    ...nodes.get('image'),
    parseDOM: [],
    toDOM: node => ['span', node.attrs.alt ? '[Image: ' + node.attrs.alt + ']' : '[Image]'],
  })
  .addToEnd('qmdRaw', {
    group: 'block',
    atom: true,
    isolating: true,
    attrs: { ...sourceAttrs, source: {}, kind: { default: 'Quarto source' } },
    parseDOM: [{
      tag: 'div[data-qmd-raw]',
      getAttrs: dom => ({ source: dom.querySelector('pre')?.textContent ?? '', kind: dom.dataset.qmdRaw }),
    }],
    toDOM: node => ['div', { 'data-qmd-raw': node.attrs.kind, contenteditable: 'false' },
      ['div', { class: 'local-qmd-raw-label' }, node.attrs.kind],
      ['pre', node.attrs.source]],
  });

export const visualSchema = new Schema({
  nodes,
  marks: schema.spec.marks.update('link', {
    ...schema.spec.marks.get('link'),
    parseDOM: [
      { tag: 'a[href]', getAttrs: dom => pastedLink(dom.getAttribute('href'), dom.getAttribute('title')) },
      { tag: 'span[data-local-qmd-link]', getAttrs: dom => pastedLink(dom.dataset.localQmdLink, dom.dataset.localQmdTitle ?? null) },
    ],
    toDOM: mark => ['span', { 'data-local-qmd-link': mark.attrs.href, 'data-local-qmd-title': mark.attrs.title }, 0],
  }),
});

const markdown = new MarkdownParser(visualSchema, defaultMarkdownParser.tokenizer, defaultMarkdownParser.tokens);
const remark = unified().use(remarkParse).use(remarkGfm);
const commonMarkTypes = new Set([
  'paragraph', 'heading', 'blockquote', 'list', 'listItem', 'thematicBreak',
  'code', 'text', 'emphasis', 'strong', 'link', 'inlineCode', 'break',
]);
const quartoInline = /(?<![\p{L}\p{N}_.@+-])@[\p{L}\p{N}_]|(?<!\\)\$[^$\n]+\$|\\[()[\]]|\{[.#=]|\^\[|\]\s*\[/u;
const quartoLine = /^[ \t]*(?::{3,}(?=[ \t{]|$)|\$\$|\\\[|[|:][ \t]|\+(?:[-=]+\+)+[ \t]*$)/m;

function needsSourceBlock(node, source) {
  if (!commonMarkTypes.has(node.type) || node.checked != null) return true;
  if (node.type === 'code') return node.lang?.startsWith('{') || node.meta?.includes('{');
  if (node.type === 'text') {
    const value = source.slice(node.position.start.offset, node.position.end.offset);
    return quartoInline.test(value) || quartoLine.test(value);
  }
  if (node.type === 'link' && !'[<'.includes(source[node.position.start.offset])) return true;
  return node.children?.some(child => needsSourceBlock(child, source));
}

function literalSpans(nodes, spans = []) {
  for (const node of nodes) {
    if (['list', 'blockquote', 'code', 'inlineCode', 'html'].includes(node.type)) {
      spans.push({ start: node.position.start.offset, end: node.position.end.offset });
    } else if (node.children) {
      literalSpans(node.children, spans);
    }
  }
  return spans;
}

function specialBlocks(source, tree) {
  const literal = literalSpans(tree.children);
  const blocks = [];
  let literalIndex = 0;
  let divStart = 0;
  let divDepth = 0;
  let math = null;

  // Match delimiters at block boundaries without interpreting code or HTML contents.
  for (const line of source.matchAll(/^ {0,3}(?::{3,}.*|\$\$[ \t]*(?:\{[^}\n]*\})?[ \t]*|\\(?:\[|\])[ \t]*)$/gm)) {
    const start = line.index;
    while (literal[literalIndex]?.end <= start) literalIndex++;
    if (literal[literalIndex]?.start <= start) continue;
    const marker = line[0].trim();
    const end = start + line[0].length;
    if (math) {
      if (marker.startsWith(math.close)) {
        if (divDepth === 0) blocks.push({ start: math.start, end, kind: 'Display math' });
        math = null;
      }
    } else if (marker.startsWith('$$') || marker === '\\[') {
      math = { start, close: marker === '\\[' ? '\\]' : '$$' };
    } else if (/^:+$/.test(marker)) {
      if (divDepth === 0) blocks.push({ start, end, kind: 'Quarto div' });
      else if (--divDepth === 0) blocks.push({ start: divStart, end, kind: 'Quarto div' });
    } else if (marker.startsWith(':::')) {
      if (divDepth++ === 0) divStart = start;
    }
  }
  if (divDepth > 0) blocks.push({ start: divStart, end: source.length, kind: 'Quarto div' });
  else if (math) blocks.push({ start: math.start, end: source.length, kind: 'Display math' });
  return blocks;
}

function spanOf(node, source) {
  const { start, end } = node.position;
  // A Setext heading's position can include preceding link definitions.
  const first = node.type === 'heading' ? node.children[0]?.position.start ?? start : start;
  return {
    start: source.lastIndexOf('\n', first.offset - 1) + 1,
    end: end.offset,
  };
}

function serializeBlock(block) {
  return defaultMarkdownSerializer.serialize(visualSchema.topNodeType.create(null, [block]));
}

export function parseQmd(source) {
  const start = /^\uFEFF*/.exec(source)[0].length;
  const metadata = /^---[ \t]*\n(?:[^\n]*\n)*?(?:---|\.\.\.)[ \t]*(?=\n|$)/.exec(source.slice(start));
  const bodyStart = start + (metadata?.[0].length ?? 0);
  const body = source.slice(bodyStart);
  const tree = remark.parse(body);
  const ranges = specialBlocks(body, tree);
  const blocks = [];
  let prefix = '';
  let previousEnd = 0;

  function append(start, end, node, kind = 'Quarto source') {
    const raw = source.slice(start, end);
    const gap = source.slice(previousEnd, start);
    if (blocks.length === 0) prefix = gap;
    const attrs = { qmdIndex: blocks.length, qmdGap: gap };
    blocks.push(node
      ? node.type.create({ ...node.attrs, ...attrs, qmdSource: raw, qmdCanonical: serializeBlock(node) }, node.content, node.marks)
      : visualSchema.nodes.qmdRaw.create({ ...attrs, source: raw, kind }));
    previousEnd = end;
  }

  function appendMarkdown(text, offset, ast) {
    for (const child of ast.children) {
      const span = spanOf(child, text);
      const { end } = span;
      const start = Math.max(span.start, previousEnd - offset);
      if (start >= end) continue;
      let node;
      if (!needsSourceBlock(child, text)) {
        const parsed = markdown.parse(text.slice(start, end));
        if (parsed.childCount === 1) node = parsed.firstChild;
      }
      append(offset + start, offset + end, node);
    }
  }

  if (metadata) append(start, bodyStart, null, 'YAML front matter');
  if (ranges.length === 0) {
    appendMarkdown(body, bodyStart, tree);
  } else {
    let offset = 0;
    for (const range of ranges) {
      const text = body.slice(offset, range.start);
      appendMarkdown(text, bodyStart + offset, remark.parse(text));
      append(bodyStart + range.start, bodyStart + range.end, null, range.kind);
      offset = range.end;
    }
    const text = body.slice(offset);
    appendMarkdown(text, bodyStart + offset, remark.parse(text));
  }

  if (blocks.length === 0 || blocks.at(-1).type === visualSchema.nodes.qmdRaw) {
    blocks.push(visualSchema.nodes.paragraph.create());
  }
  return visualSchema.topNodeType.create({ qmdPrefix: prefix, qmdSuffix: source.slice(previousEnd) }, blocks);
}

export function serializeQmd(doc) {
  let previous = null;
  let source = doc.attrs.qmdPrefix;
  doc.forEach(block => {
    let text;
    if (block.type === visualSchema.nodes.qmdRaw) {
      text = block.attrs.source;
    } else {
      const canonical = serializeBlock(block);
      text = canonical === block.attrs.qmdCanonical ? block.attrs.qmdSource : canonical;
    }
    if (text === '') return;
    if (previous) {
      const adjacent = previous.attrs.qmdIndex !== null && block.attrs.qmdIndex === previous.attrs.qmdIndex + 1;
      source += adjacent ? block.attrs.qmdGap : '\n\n';
    }
    source += text;
    previous = block;
  });
  return source + doc.attrs.qmdSuffix;
}
