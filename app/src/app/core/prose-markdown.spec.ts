import { describe, expect, it } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { parseProse, serialiseProse, speechRuns } from './prose-markdown';

/**
 * The editor's markdown is the message's markdown: whatever goes in comes back
 * out unchanged, and the marks in between are the ones the page would colour.
 */

/** What the demo story and the fake model write, plus the shapes that bite. */
const CORPUS = [
  'I climb the stairs.',
  'He looked away. *shrugs* "Not today."',
  '"You are smaller than the songs promised," she said.',
  '*The dragon shifted, scales grinding on stone.*',
  '*The dragon shifted.* "And you are louder," it answered.',
  'The knight lowered her lantern. "You are smaller than the songs promised," she said.',
  '"Fifty-one years I have been up these stairs," she says.',
  '*Below, the sound of a man getting to his feet.*\n"She tells it wrong," he says. "She always has."',
  '“Curly,” she said, “and straight,” he said. "Both."',
  '**bold *both* bold**',
  '*a **b** c*',
  '***both at once***',
  '**a** **b**',
  '*one*\n*two*',
  '*a line\nand the next, still an action*',
  'A paragraph.\n\nA second one.\n\n\nA third, after two blank lines.',
  'Trailing newline\n',
  '\n\nLeading blank lines',
  'Two spaces  \nthen a break, and a backslash\\\nbreak.',
  '# A heading the writer typed\n\n- one\n- two\n\n> a quote\n\n```\ncode with\n\nblank lines\n```',
  'Underscores _stay_ as __typed__, and 5 * 3 * 2 is arithmetic.',
  'A [link](https://example.com), `code`, ~~struck~~, <b>html</b> and an escaped \\* star.',
  '[AUTHOR] The room is empty.',
  '"I *do* mind." A quote around an action is two things, not one.',
  '',
];

function texts(node: JSONContent): JSONContent[] {
  if (node.type === 'text') return [node];
  return (node.content ?? []).flatMap(texts);
}

function marksOn(doc: JSONContent, text: string): string[] {
  const node = texts(doc).find((n) => n.text === text);
  if (!node) throw new Error(`no text node "${text}"`);
  return (node.marks ?? []).map((m) => m.type).sort();
}

describe('the round trip', () => {
  for (const source of CORPUS) {
    it(`gives back ${JSON.stringify(source)}`, () => {
      expect(serialiseProse(parseProse(source))).toBe(source);
    });
  }

  it('is stable on a second pass too', () => {
    for (const source of CORPUS) {
      const once = serialiseProse(parseProse(source));
      expect(serialiseProse(parseProse(once))).toBe(once);
    }
  });
});

describe('the document', () => {
  it('is paragraphs at blank lines and hard breaks at newlines', () => {
    const doc = parseProse('one\ntwo\n\nthree');
    expect(doc.content).toHaveLength(2);
    expect(doc.content![0].content!.map((n) => n.type)).toEqual(['text', 'hardBreak', 'text']);
    expect(doc.content![1].content!.map((n) => n.type)).toEqual(['text']);
  });

  it('is one empty paragraph for nothing at all', () => {
    expect(parseProse('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(serialiseProse({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe('');
  });

  it('marks the action, the bold and the speech the page would colour', () => {
    const doc = parseProse('He looked away. *shrugs* "Not today." **Really.**');
    expect(marksOn(doc, 'shrugs')).toEqual(['action']);
    expect(marksOn(doc, '"Not today."')).toEqual(['speech']);
    expect(marksOn(doc, 'Really.')).toEqual(['bold']);
    expect(marksOn(doc, 'He looked away. ')).toEqual([]);
  });

  it('nests bold inside an action and an action inside bold', () => {
    expect(marksOn(parseProse('*a **b** c*'), 'b')).toEqual(['action', 'bold']);
    expect(marksOn(parseProse('**a *b* c**'), 'b')).toEqual(['action', 'bold']);
    expect(marksOn(parseProse('***x***'), 'x')).toEqual(['action', 'bold']);
  });

  it('keeps an action going across a hard break', () => {
    const [text, br, more] = parseProse('*a\nb*').content![0].content!;
    expect(text.marks?.map((m) => m.type)).toEqual(['action']);
    expect(br.type).toBe('hardBreak');
    expect(br.marks?.map((m) => m.type)).toEqual(['action']);
    expect(more.marks?.map((m) => m.type)).toEqual(['action']);
  });

  it('never matches speech across an action or a break, as the page does not', () => {
    const doc = parseProse('"I *do* mind."\n"Yes"\nno"');
    expect(marksOn(doc, '"I ')).toEqual([]);
    expect(marksOn(doc, ' mind."')).toEqual([]);
    expect(marksOn(doc, '"Yes"')).toEqual(['speech']);
    expect(marksOn(doc, 'no"')).toEqual([]);
  });

  it('colours speech inside an action, with the action', () => {
    expect(marksOn(parseProse('*she says "no" and leaves*'), '"no"')).toEqual(['action', 'speech']);
  });

  it('leaves headings, lists and code as the text they were', () => {
    const doc = parseProse('# Title\n\n- one\n- two');
    expect(texts(doc).map((n) => n.text)).toEqual(['# Title', '- one', '- two']);
    expect(texts(doc).every((n) => !n.marks)).toBe(true);
  });
});

describe('writing marks out', () => {
  const doc = (content: JSONContent[]): JSONContent => ({
    type: 'doc',
    content: [{ type: 'paragraph', content }],
  });
  const text = (text: string, ...marks: string[]): JSONContent =>
    marks.length
      ? { type: 'text', text, marks: marks.map((type) => ({ type })) }
      : { type: 'text', text };

  it('moves the whitespace at the edge of a run outside the asterisks', () => {
    expect(serialiseProse(doc([text('a'), text(' bold ', 'bold'), text('b')]))).toBe(
      'a **bold** b',
    );
  });

  it('closes an outer mark and reopens the inner one, with the space between them', () => {
    expect(
      serialiseProse(doc([text('a ', 'bold'), text('b', 'bold', 'action'), text(' c', 'action')])),
    ).toBe('**a *b*** *c*');
  });

  it('ignores speech, whose quotes are already in the text', () => {
    expect(serialiseProse(doc([text('"hello"', 'speech'), text(' she said')]))).toBe(
      '"hello" she said',
    );
  });

  it('does not escape a thing', () => {
    const literal = '# * _ ` [x](y) <b> \\ ~~ > -';
    expect(serialiseProse(doc([text(literal)]))).toBe(literal);
  });

  it('writes a space that was made bold on its own as a space', () => {
    expect(serialiseProse(doc([text('x'), text(' ', 'bold'), text('y')]))).toBe('x y');
  });

  it('writes a break inside a run without closing it', () => {
    expect(
      serialiseProse(
        doc([
          text('a', 'action'),
          { type: 'hardBreak', marks: [{ type: 'action' }] },
          text('b', 'action'),
        ]),
      ),
    ).toBe('*a\nb*');
    expect(
      serialiseProse(doc([text('a', 'action'), { type: 'hardBreak' }, text('b', 'action')])),
    ).toBe('*a*\n*b*');
  });
});

describe('speechRuns', () => {
  it('finds each quoted run, straight or curly', () => {
    expect(speechRuns('"a" and “b” and "unclosed')).toEqual([
      [0, 3],
      [8, 11],
    ]);
  });
});
