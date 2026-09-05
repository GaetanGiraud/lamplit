import { characterColour } from './character-colours';
import { ChapterMessage, Story, ThemeName } from './models';
import { isOneAtATime } from './prompt-builder';

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
 * The name to say before a message that is being read aloud, or '' for none.
 *
 * Not the same question as the label on the page, and it has to be asked
 * separately for two reasons. A run of turns by one speaker is labelled once
 * because the reader can see the run; a listener cannot, so every message
 * carries its name. And it is only asked at all where the model is playing one
 * character at a time — an ensemble answer belongs to nobody, and a narrator's
 * page has no names on it, so announcing one would be inventing a speaker.
 */
export function announcedName(
  story: Pick<Story, 'mode' | 'roleplay' | 'characters' | 'persona'>,
  message: ChapterMessage,
): string {
  if (story.mode !== 'roleplay' || !isOneAtATime(story)) return '';
  if (message.kind === 'cast' || message.meta?.error) return '';
  // An ensemble answer is the room talking and belongs to nobody, exactly as
  // it does on the page.
  if (message.role !== 'user' && !message.speakerId && !nameOf(story, message)) return '';
  return nameOf(story, message);
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
  const name = nameOf(story, message);
  if (message.role === 'user') {
    return { key: 'reader', label: name ? { name, colour: '' } : null };
  }

  if (!message.speakerId && !name) {
    // An ensemble answer is the room talking: the prose carries the names.
    return { key: 'ensemble', label: null };
  }

  const key = `${message.speakerId ?? ''}:${name}`;
  if (!name) return { key, label: null };
  const character = story.characters.find((c) => c.id === message.speakerId);
  return { key, label: { name, colour: character ? characterColour(character, theme) : '' } };
}

/**
 * What the speaker of a message is called: the reader's persona on their own
 * lines, and on the model's the name it was playing under *when the message was
 * written*. A rename is a change to the story from here on, not a correction of
 * what was already said — an answer written before names were stored has none
 * of its own and falls back to what the character is called now.
 */
function nameOf(story: Pick<Story, 'characters' | 'persona'>, message: ChapterMessage): string {
  if (message.role === 'user') return story.persona.name.trim();
  const character = story.characters.find((c) => c.id === message.speakerId);
  return message.speakerName?.trim() || character?.name.trim() || '';
}
