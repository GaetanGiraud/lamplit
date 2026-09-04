import { characterColour } from './character-colours';
import { ChapterMessage, Story, ThemeName } from './models';

/**
 * Who is speaking on each line of the page.
 *
 * A message says which side wrote it; with a cast, and with one character
 * switched for another, that is not enough to read by. So each turn can carry a
 * small name above its prose — the character the model was playing, or the
 * persona the reader plays — and the rest of the page is left alone.
 *
 * Three rules, and all three are here rather than in the template:
 *
 *  - **A name is the one that was stored on the message**, not the one the
 *    character has now. A rename is a change to the story from here on, not a
 *    correction of what was already written.
 *  - **A run of turns by the same speaker is labelled once**, on the first,
 *    because the second one is the same person still talking. A cast record
 *    between them ends the run: something happened there, even though the page
 *    does not show it.
 *  - **Nothing is labelled that has no name to show** — narrator mode, an
 *    ensemble answer that belongs to nobody, a persona with no name.
 */
export interface SpeakerLabel {
  name: string;
  /**
   * `#rrggbb`, or empty where there is no character colour to use: the reader's
   * own lines, and a character who has since been deleted. Those read muted.
   */
  colour: string;
}

/** By message id. A message that is not in it carries no label. */
export function speakerLabels(
  story: Pick<Story, 'mode' | 'characters' | 'persona'>,
  messages: readonly ChapterMessage[],
  theme: ThemeName,
): Map<string, SpeakerLabel> {
  const labels = new Map<string, SpeakerLabel>();
  // The page is the narrator's and the reader knows it.
  if (story.mode !== 'roleplay') return labels;

  // Never a key, so the first turn of a chapter is always labelled and a cast
  // record can put the page back to knowing nobody.
  let previous = '';

  for (const message of messages) {
    if (message.kind === 'cast') {
      previous = '';
      continue;
    }
    // A turn that failed has no prose under it, and the error says enough.
    if (message.meta?.error) continue;

    const { key, label } = whoSpoke(story, message, theme);
    if (label && key !== previous) labels.set(message.id, label);
    previous = key;
  }

  return labels;
}

/**
 * The speaker of one turn, as a key that says whether it is the same person as
 * the turn before it, and the label to draw when it is not.
 */
function whoSpoke(
  story: Pick<Story, 'characters' | 'persona'>,
  message: ChapterMessage,
  theme: ThemeName,
): { key: string; label: SpeakerLabel | null } {
  if (message.role === 'user') {
    const name = story.persona.name.trim();
    return { key: 'reader', label: name ? { name, colour: '' } : null };
  }

  const character = story.characters.find((c) => c.id === message.speakerId);
  // What it was called when it was written; an answer written before names were
  // stored falls back to what the character is called now.
  const name = message.speakerName?.trim() || character?.name.trim() || '';
  if (!message.speakerId && !name) {
    // An ensemble answer is the room talking: the prose carries the names.
    return { key: 'ensemble', label: null };
  }

  const key = `${message.speakerId ?? ''}:${name}`;
  if (!name) return { key, label: null };
  return { key, label: { name, colour: character ? characterColour(character, theme) : '' } };
}
