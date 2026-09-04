import type { JSONContent } from '@tiptap/core';
import { Lexer, type Token } from 'marked';

/**
 * Markdown in, a document out, and the same markdown back.
 *
 * The composer and the message editor hold prose as a document while it is
 * being written and hand it back as the markdown string a message has always
 * been. The document knows four things: a paragraph, a hard break, bold, and
 * the italic that reads as an action. Speech is coloured but never stored —
 * the quotes are the markup, so the mark is worked out from the text on the
 * way in and ignored on the way out. Everything else markdown can say (a
 * heading, a list, a fenced block, a link) is kept as the text the writer
 * typed, and renders after sending exactly as it always has.
 *
 * Which is why nothing here escapes anything, and why a round trip is the
 * identity on any string: a paragraph is a blank line and a hard break is a
 * newline, so the only thing the two directions have to agree on is where an
 * asterisk is emphasis and where it is an asterisk. `marked` answers that,
 * with the same settings the page renders with.
 */

type Mark = 'bold' | 'action' | 'speech';

const LEXER_OPTIONS = { gfm: true, breaks: true } as const;

/**
 * Outermost first. It is the order the editor's schema ranks the marks in, so
 * a run that is both is written `***like this***` and read back the same way.
 */
const MARK_ORDER: readonly Mark[] = ['bold', 'action'];

const DELIMITER: Record<Mark, string> = { bold: '**', action: '*', speech: '' };

/**
 * A spoken run: an opening quote, anything that is not a quote, a closing
 * quote. Straight or curly, whatever was typed. The same rule the page reads
 * with, in `formatting.ts`, applied to the same thing: one stretch of text
 * with one set of marks on it, so a quote is never matched across an action.
 */
export function speechRuns(text: string): [number, number][] {
  const runs: [number, number][] = [];
  const quoted = /(["“])([^"“”]+)(["”])/g;
  for (let match = quoted.exec(text); match; match = quoted.exec(text)) {
    runs.push([match.index, match.index + match[0].length]);
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Markdown -> document
// ---------------------------------------------------------------------------

export function parseProse(markdown: string): JSONContent {
  return { type: 'doc', content: markdown.split('\n\n').map(parseParagraph) };
}

function parseParagraph(source: string): JSONContent {
  const content = markSpeech(inlineNodes(Lexer.lexInline(source, LEXER_OPTIONS), []));
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
}

function inlineNodes(tokens: Token[], marks: Mark[]): JSONContent[] {
  const out: JSONContent[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case 'em':
      case 'strong':
        // Only the asterisk spelling is ours. `_like this_` renders the same
        // after sending, but it is not what the editor writes, so it is kept
        // as the text it was typed as rather than rewritten on the way out.
        if (token.raw.startsWith('*')) {
          const mark: Mark = token.type === 'em' ? 'action' : 'bold';
          out.push(...inlineNodes(token.tokens ?? [], [...marks, mark]));
        } else {
          out.push(...textNodes(token.raw, marks));
        }
        break;
      case 'br': {
        // Whatever came before the newline — two spaces, a backslash — is
        // text, and goes back out in front of it.
        const before = token.raw.slice(0, token.raw.lastIndexOf('\n'));
        if (before) out.push(...textNodes(before, marks));
        out.push(hardBreak(marks));
        break;
      }
      default:
        // Code, links, strikethrough, HTML, escapes, and text: all of it is
        // the writer's own characters, kept exactly.
        out.push(...textNodes(token.raw, marks));
    }
  }
  return out;
}

/** Text tokens can carry a newline of their own at the end of a paragraph. */
function textNodes(text: string, marks: Mark[]): JSONContent[] {
  const out: JSONContent[] = [];
  text.split('\n').forEach((line, index) => {
    if (index) out.push(hardBreak(marks));
    if (line) out.push(textNode(line, marks));
  });
  return out;
}

function textNode(text: string, marks: readonly Mark[]): JSONContent {
  return marks.length
    ? { type: 'text', text, marks: marks.map((type) => ({ type })) }
    : { type: 'text', text };
}

function hardBreak(marks: readonly Mark[]): JSONContent {
  return marks.length
    ? { type: 'hardBreak', marks: marks.map((type) => ({ type })) }
    : { type: 'hardBreak' };
}

/**
 * Speech, worked out over each stretch of text that shares its marks. A hard
 * break ends a stretch, and so does an action or a bold run, because that is
 * where the page's own text nodes end — the rule and its blind spots are the
 * same on both sides so that what is typed looks like what will be read.
 */
function markSpeech(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = [];
  let group: JSONContent[] = [];
  const flush = () => {
    if (group.length) out.push(...speakGroup(group));
    group = [];
  };
  for (const node of nodes) {
    if (node.type !== 'text') {
      flush();
      out.push(node);
    } else if (group[0] && markKey(group[0]) !== markKey(node)) {
      flush();
      group.push(node);
    } else {
      group.push(node);
    }
  }
  flush();
  return out;
}

function speakGroup(group: JSONContent[]): JSONContent[] {
  const runs = speechRuns(group.map((node) => node.text ?? '').join(''));
  if (!runs.length) return group;

  const out: JSONContent[] = [];
  let offset = 0;
  for (const node of group) {
    const text = node.text ?? '';
    const start = offset;
    const end = offset + text.length;
    offset = end;

    let cursor = start;
    for (const [from, to] of runs) {
      if (to <= start || from >= end) continue;
      const a = Math.max(from, start);
      const b = Math.min(to, end);
      if (a > cursor) out.push(piece(node, cursor - start, a - start, false));
      out.push(piece(node, a - start, b - start, true));
      cursor = b;
    }
    if (cursor < end) out.push(piece(node, cursor - start, end - start, false));
  }
  return out;
}

function piece(node: JSONContent, from: number, to: number, speech: boolean): JSONContent {
  const marks = [...(node.marks ?? [])];
  if (speech) marks.push({ type: 'speech' });
  const text = (node.text ?? '').slice(from, to);
  return marks.length ? { type: 'text', text, marks } : { type: 'text', text };
}

/** The marks that matter to markdown, as a key: speech is not one of them. */
function markKey(node: JSONContent): string {
  return marksOf(node).join(',');
}

function marksOf(node: JSONContent): Mark[] {
  return (node.marks ?? [])
    .map((mark) => mark.type as Mark)
    .filter((mark) => mark !== 'speech')
    .sort((a, b) => MARK_ORDER.indexOf(a) - MARK_ORDER.indexOf(b));
}

// ---------------------------------------------------------------------------
// Document -> markdown
// ---------------------------------------------------------------------------

export function serialiseProse(doc: JSONContent): string {
  return (doc.content ?? []).map(serialiseParagraph).join('\n\n');
}

/**
 * Walks the paragraph keeping track of which marks are open. A mark that
 * continues onto the next node stays open; one that ends is closed, innermost
 * first, and the delimiters never sit against whitespace, which markdown would
 * refuse to read as emphasis: a space at the start of a run goes out before
 * the opening asterisks, one at the end waits until after the closing ones.
 */
function serialiseParagraph(paragraph: JSONContent): string {
  let out = '';
  let active: Mark[] = [];
  /** Trailing whitespace of the last text, held until we know whether a mark closes after it. */
  let pending = '';

  /** Closes what does not continue into `next`, innermost first, then lets the held whitespace out. */
  const close = (next: readonly Mark[]) => {
    let keep = 0;
    while (keep < active.length && keep < next.length && active[keep] === next[keep]) keep++;
    for (let i = active.length - 1; i >= keep; i--) out += DELIMITER[active[i]!];
    out += pending;
    pending = '';
    active = active.slice(0, keep);
  };

  /** Opens what `next` has beyond what is already open; `close` has made `active` a prefix of it. */
  const open = (next: Mark[]) => {
    for (let i = active.length; i < next.length; i++) out += DELIMITER[next[i]!];
    active = next;
  };

  for (const node of paragraph.content ?? []) {
    if (node.type === 'hardBreak') {
      const next = ordered(active, marksOf(node));
      close(next);
      open(next);
      out += '\n';
      continue;
    }
    if (node.type !== 'text') continue;

    const text = node.text ?? '';
    if (!text.trim()) {
      // Whitespace carries no mark of its own: it can end a run but never
      // start one, so `**a** **b**` keeps its space between the runs and a
      // space that was made bold by accident is just a space.
      const kept = ordered(
        active,
        marksOf(node).filter((mark) => active.includes(mark)),
      );
      close(kept);
      open(kept);
      out += text;
      continue;
    }

    const next = ordered(active, marksOf(node));
    const lead = /^\s*/.exec(text)![0];
    const body = text.slice(lead.length).replace(/\s+$/, '');
    // Leading whitespace goes between whatever closes and whatever opens; the
    // trailing kind waits to see whether something closes after it.
    close(next);
    out += lead;
    open(next);
    out += body;
    pending = text.slice(lead.length + body.length);
  }
  close([]);
  return out;
}

/** Marks already open first, in the order they were opened, then the new ones outermost first. */
function ordered(active: readonly Mark[], marks: readonly Mark[]): Mark[] {
  return [
    ...active.filter((mark) => marks.includes(mark)),
    ...MARK_ORDER.filter((mark) => marks.includes(mark) && !active.includes(mark)),
  ];
}
