import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { speechRuns } from './prose-markdown';

// A story is not a codebase: register the handful of languages a fenced block
// here plausibly holds rather than pulling in all of highlight.js.
for (const [name, language] of Object.entries({
  bash,
  css,
  json,
  markdown,
  python,
  typescript,
  xml,
  yaml,
})) {
  hljs.registerLanguage(name, language);
}
hljs.registerAliases(['js', 'javascript', 'jsx', 'tsx', 'ts'], { languageName: 'typescript' });
hljs.registerAliases(['sh', 'shell', 'zsh'], { languageName: 'bash' });
hljs.registerAliases(['html', 'svg'], { languageName: 'xml' });
hljs.registerAliases(['md'], { languageName: 'markdown' });
hljs.registerAliases(['yml'], { languageName: 'yaml' });

export interface RenderOptions {
  /** Each spoken line gets its own paragraph, the way a novel sets dialogue. */
  bookStyleDialogue: boolean;
}

const renderer = {
  code({ text, lang }: { text: string; lang?: string }) {
    const language = (lang ?? '').trim().split(/\s+/)[0];
    const highlighted =
      language && hljs.getLanguage(language)
        ? hljs.highlight(text, { language, ignoreIllegals: true }).value
        : hljs.highlightAuto(text).value;
    return `<pre><code class="hljs language-${escapeAttribute(language || 'plaintext')}">${highlighted}</code></pre>`;
  },
};

/**
 * Story prose, where a newline the writer typed is a newline they meant. A
 * model that puts each spoken line on its own row expects to see it that way.
 */
const marked = new Marked({ gfm: true, breaks: true, renderer });

/**
 * Ordinary markdown, where a wrapped line is still the same paragraph. Release
 * notes are written for GitHub and hard-wrapped by the formatter, so `breaks`
 * would put a line ending in the middle of every sentence.
 */
const markedPlain = new Marked({ gfm: true, breaks: false, renderer });

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'hr',
    'em',
    'strong',
    'del',
    's',
    'code',
    'pre',
    'span',
    'blockquote',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'a',
  ],
  ALLOWED_ATTR: ['class', 'href', 'title'],
  ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
};

/**
 * Markdown -> safe HTML, and nothing else. What release notes want: they are
 * ordinary markdown written for GitHub, not story prose, so none of the
 * book-setting below has any business with them.
 */
export function renderMarkdown(source: string): string {
  if (!source) return '';
  return DOMPurify.sanitize(toHtml(markedPlain, source), PURIFY_CONFIG);
}

/**
 * The parse, and what to do when there is no parsing it.
 *
 * marked walks the source recursively, so prose nested deeply enough — a
 * thousand levels of `> - `, which a model that has started repeating itself
 * will eventually write — leaves it as a `RangeError` rather than as HTML.
 * This runs inside a `computed` read during change detection, so the throw
 * would take the view down and not just the paragraph. An unparseable answer
 * is shown as the text it is instead: still readable, still copyable, still
 * the words the model sent.
 */
function toHtml(parser: Marked, source: string): string {
  try {
    return parser.parse(source, { async: false });
  } catch {
    return `<p>${escapeText(source)}</p>`;
  }
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Story text -> safe HTML: markdown first, then sanitising, then a formatting
 * pass over the resulting text nodes (never over the markup) that marks speech
 * and italic "actions" so the stylesheet can set them like a book.
 */
export function renderStoryHtml(source: string, options: RenderOptions): string {
  if (!source) return '';
  const clean = DOMPurify.sanitize(toHtml(marked, source), PURIFY_CONFIG);

  const host = document.createElement('div');
  host.innerHTML = clean;
  markSpeech(host);
  markActions(host);
  if (options.bookStyleDialogue) splitSpokenLines(host);
  return host.innerHTML;
}

/** Tags whose text is verbatim and must not be reformatted. */
const VERBATIM = new Set(['CODE', 'PRE', 'A']);

/**
 * Wraps `"quoted runs"` (straight or curly) in `<span class="speech">`. The
 * rule lives in `prose-markdown.ts`, because the editor colours what is being
 * typed by the same one.
 */
function markSpeech(host: HTMLElement): void {
  for (const node of textNodes(host)) {
    const text = node.nodeValue ?? '';
    if (!/["“]/.test(text)) continue;
    const runs = speechRuns(text);
    if (!runs.length) continue;

    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const [from, to] of runs) {
      if (from > cursor) fragment.append(document.createTextNode(text.slice(cursor, from)));
      const span = document.createElement('span');
      span.className = 'speech';
      span.textContent = text.slice(from, to);
      fragment.append(span);
      cursor = to;
    }
    if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
    node.parentNode?.replaceChild(fragment, node);
  }
}

/** `*like this*` already became `<em>`; label it so actions can be styled. */
function markActions(host: HTMLElement): void {
  for (const em of Array.from(host.querySelectorAll('em'))) {
    if (em.closest('code, pre')) continue;
    em.classList.add('action');
  }
}

/**
 * Book style: inside a paragraph, every stretch that starts with speech begins
 * a new paragraph, so `He grinned. "Hello." "And you?"` sets as three lines.
 */
function splitSpokenLines(host: HTMLElement): void {
  for (const paragraph of Array.from(host.querySelectorAll('p'))) {
    const speech = paragraph.querySelectorAll(':scope > span.speech');
    if (!speech.length) continue;

    const groups: Node[][] = [];
    let current: Node[] = [];
    for (const child of Array.from(paragraph.childNodes)) {
      const startsSpeech = isSpeech(child) && hasContent(current);
      if (startsSpeech) {
        groups.push(current);
        current = [];
      }
      current.push(child);
    }
    if (current.length) groups.push(current);
    if (groups.length < 2) continue;

    const replacement = document.createDocumentFragment();
    for (const group of groups) {
      if (!hasContent(group)) continue;
      const line = document.createElement('p');
      trimEdges(group).forEach((node) => line.append(node));
      replacement.append(line);
    }
    paragraph.replaceWith(replacement);
  }
}

function isSpeech(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && (node as Element).classList.contains('speech');
}

function hasContent(nodes: readonly Node[]): boolean {
  return nodes.some((n) => (n.textContent ?? '').trim().length > 0);
}

/**
 * Drops what used to separate two now-separate lines: the whitespace, and the
 * `<br>` a single newline in the model's answer became. Left in place, that
 * `<br>` would open an empty line inside the new paragraph.
 */
function trimEdges(nodes: readonly Node[]): Node[] {
  const kept = [...nodes];
  while (kept[0] && isBlank(kept[0])) kept.shift();
  while (kept.length && isBlank(kept[kept.length - 1]!)) kept.pop();
  return kept;
}

function isBlank(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) return !(node.nodeValue ?? '').trim();
  return node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'BR';
}

function textNodes(host: HTMLElement): Text[] {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement && isVerbatim(node.parentElement)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const found: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    found.push(node as Text);
  }
  return found;
}

function isVerbatim(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (VERBATIM.has(node.tagName)) return true;
  }
  return false;
}

function escapeAttribute(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}
