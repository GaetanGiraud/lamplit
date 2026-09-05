import { describe, expect, it } from 'vitest';
import { speechPieces, spokenText } from './reading-aloud';

/**
 * What a voice is handed. Two jobs, both pure: the marks come out and the
 * words stay, and what is left is cut into pieces short enough that Chrome
 * finishes saying them.
 */

describe('the words, without the marks', () => {
  it('reads an action as the words it is, not as three asterisks', () => {
    expect(spokenText('*She crosses to the glass.*')).toBe('She crosses to the glass.');
    expect(spokenText('**Never**, she said.')).toBe('Never, she said.');
    expect(spokenText('***both at once***')).toBe('both at once');
    expect(spokenText('*a **b** c*')).toBe('a b c');
  });

  it('keeps the quotation marks, because a voice pauses at them', () => {
    expect(spokenText('"Tomas kept this light," she says.')).toBe(
      '"Tomas kept this light," she says.',
    );
    expect(spokenText('“Curly ones too,” he said.')).toBe('“Curly ones too,” he said.');
  });

  it('drops the marks that are a shape rather than a word', () => {
    expect(spokenText('# A heading')).toBe('A heading');
    expect(spokenText('> a quotation')).toBe('a quotation');
    expect(spokenText('- one\n- two')).toBe('one\ntwo');
    expect(spokenText('1. first\n2. second')).toBe('first\nsecond');
    expect(spokenText('above\n\n---\n\nbelow')).toBe('above\n\nbelow');
    expect(spokenText('`code`')).toBe('code');
  });

  it('says what a link says, not where it goes', () => {
    expect(spokenText('The [lighthouse](https://example.com/light) again.')).toBe(
      'The lighthouse again.',
    );
    expect(spokenText('![a lamp](lamp.png)')).toBe('a lamp');
  });

  it('keeps the code inside a fence, because dropping words is worse', () => {
    expect(spokenText('```\nlet lamp = 1;\n```')).toBe('let lamp = 1;');
  });

  it('gives back the character an escape was protecting', () => {
    expect(spokenText('five \\* three')).toBe('five * three');
  });

  it('leaves arithmetic and mid-word underscores alone', () => {
    expect(spokenText('5 * 3 * 2 is arithmetic.')).toBe('5 * 3 * 2 is arithmetic.');
  });

  it('says the speaker first, when there is one to say', () => {
    expect(spokenText('Fifty-one years.', 'Nell')).toBe('Nell. Fifty-one years.');
    expect(spokenText('Fifty-one years.', '  ')).toBe('Fifty-one years.');
  });

  it('is nothing at all when there is nothing to say', () => {
    expect(spokenText('')).toBe('');
    expect(spokenText('---')).toBe('');
    expect(spokenText('   \n\n  ', 'Nell')).toBe('');
  });

  it('collapses the blank lines a voice cannot hear the difference between', () => {
    expect(spokenText('One.\n\n\n\nTwo.')).toBe('One.\n\nTwo.');
  });
});

describe('the pieces it is said in', () => {
  it('keeps a short message in one piece', () => {
    expect(speechPieces('She climbs the stairs.')).toEqual(['She climbs the stairs.']);
  });

  it('cuts at the end of a sentence, never inside one', () => {
    const sentence = `${'word '.repeat(30).trim()}.`;
    const pieces = speechPieces(`${sentence} ${sentence} ${sentence}`);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(piece.endsWith('.')).toBe(true);
  });

  it('packs as many whole sentences into a piece as fit', () => {
    expect(speechPieces('One. Two. Three.')).toEqual(['One. Two. Three.']);
  });

  it('keeps a closing quotation mark with the sentence it closes', () => {
    expect(speechPieces('"Not today." She turned away.')).toEqual([
      '"Not today." She turned away.',
    ]);
  });

  it('cuts a sentence that is longer than a piece, at a comma or a space', () => {
    const long = `${'word '.repeat(80).trim()}.`;
    const pieces = speechPieces(long);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(200);
    // Every word survives the cutting, in the order it was written.
    expect(pieces.join(' ')).toBe(long);
  });

  it('cuts mid-word only where there is nowhere else to cut', () => {
    const pieces = speechPieces('x'.repeat(450));
    expect(pieces).toEqual(['x'.repeat(200), 'x'.repeat(200), 'x'.repeat(50)]);
  });

  it('says nothing about nothing', () => {
    expect(speechPieces('')).toEqual([]);
    expect(speechPieces('   ')).toEqual([]);
  });
});
