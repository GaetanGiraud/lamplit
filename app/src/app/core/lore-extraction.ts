import { Chapter, LoreCategory, LoreEntry, OutboundMessage, Story } from './models';
import { chapterTranscript } from './prompt-builder';

/**
 * What a chapter established, asked for as JSON.
 *
 * The second request a chapter close can make, and the only one in the app that
 * wants an answer rather than prose. It reads the same chapter the summary
 * reads — the summary keeps what the story needs to make sense, and this keeps
 * the details it will drop: a name, a town, who owes whom.
 *
 * Nothing here writes anything. It builds a request and reads what comes back
 * into proposals; every one of them is a tick box in the review sheet, and an
 * unticked one leaves no trace.
 */

const LORE_CATEGORIES: readonly LoreCategory[] = ['fact', 'person', 'place', 'other'];

/**
 * Asked for in the prompt whether or not the endpoint enforces a schema, so the
 * fallback path is the same request asked less formally rather than a different
 * one. `updates` is required and empty for a new entry: a schema in strict mode
 * has no optional properties, and "" is a clearer nothing than a missing key.
 */
const LORE_INSTRUCTION = [
  'List what this chapter established that is worth remembering after it —',
  'the people, places and facts a later chapter would be poorer for forgetting.',
  'Leave out anything the entries below already cover, unless this chapter changed it:',
  "then propose it as an update, with `updates` set to that entry's exact title.",
  'Keep each one short — a title, a few keys that would appear in the prose when it matters,',
  'and a sentence or two of what is true. Invent nothing the chapter does not say,',
  'and return an empty list rather than filling one.',
  'Answer with a JSON object and nothing else, in this shape:',
  '{"entries":[{"title":"","category":"person|place|fact|other","keys":[""],"content":"","updates":""}]}',
].join(' ');

export const LORE_SCHEMA = {
  name: 'lore_entries',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['entries'],
    properties: {
      entries: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'category', 'keys', 'content', 'updates'],
          properties: {
            title: { type: 'string' },
            category: { type: 'string', enum: [...LORE_CATEGORIES] },
            keys: { type: 'array', items: { type: 'string' } },
            content: { type: 'string' },
            updates: {
              type: 'string',
              description: 'The exact title of the entry this replaces, or "" for a new one.',
            },
          },
        },
      },
    },
  },
} as const;

/** One row of the review sheet's checklist. */
export interface LoreProposal {
  title: string;
  category: LoreCategory;
  keys: string[];
  content: string;
  /** The entry this would overwrite. Absent on a new entry, which is most. */
  updates?: LoreEntry;
}

/**
 * The request itself: the chapter, the entries the world already holds, and
 * what to do about the difference.
 *
 * The existing entries go in as titles and keys and not as their text. It is
 * enough for the model to know what is already covered and to name one it wants
 * to change, and it keeps a world of forty entries from doubling the bill on
 * every chapter close.
 */
export function buildLorePrompt(story: Story, chapter: Chapter): OutboundMessage[] {
  const parts: string[] = [];
  if (chapter.scene.trim()) parts.push(`The scene it opened on:\n${chapter.scene.trim()}`);
  const transcript = chapterTranscript(story, chapter);
  parts.push(`What happened in it:\n${transcript || '(nothing was written in this chapter)'}`);

  const known = story.world.entries
    .filter((entry) => entry.title.trim())
    .map(
      (entry) => `- ${entry.title.trim()}${entry.keys.length ? ` (${entry.keys.join(', ')})` : ''}`,
    );
  parts.push(
    known.length
      ? `The world already holds these entries:\n${known.join('\n')}`
      : 'The world holds no entries yet.',
  );

  return [
    {
      role: 'system',
      content:
        'You read a chapter of an ongoing story and report what it established, accurately and briefly. You answer with JSON and nothing else.',
    },
    { role: 'user', content: `${parts.join('\n\n')}\n\n${LORE_INSTRUCTION}` },
  ];
}

/**
 * What came back, as proposals — or nothing, which is a perfectly good answer
 * and not an error.
 *
 * Everything here is defensive on purpose: this is the one place in the app
 * where a model's output is read as data rather than shown as prose, and a
 * model asked for a category will occasionally invent a fifth one.
 */
export function readProposals(value: unknown, entries: readonly LoreEntry[]): LoreProposal[] {
  const raw = (value as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(raw)) return [];

  const proposals: LoreProposal[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const title = text(row['title']);
    const content = text(row['content']);
    if (!title || !content) continue;

    // A title the world already has is an update whether the model said so or
    // not: two entries of the same name is the duplication this asked to avoid.
    const named = text(row['updates']);
    const updates = match(entries, named) ?? match(entries, title);

    proposals.push({
      title,
      category: LORE_CATEGORIES.includes(row['category'] as LoreCategory)
        ? (row['category'] as LoreCategory)
        : 'fact',
      keys: keysOf(row['keys'], title),
      content,
      updates,
    });
  }
  return proposals;
}

/** A proposal as it will be filed: a new entry, or the old one rewritten. */
export function entryFrom(proposal: LoreProposal, id: string): LoreEntry {
  const base = proposal.updates;
  return {
    // An update keeps its id, and everything about it the writer had set that
    // this request knows nothing about — whether it is on, whether it is
    // always on, its own scan settings.
    ...(base ?? { id, enabled: true, alwaysOn: false }),
    id: base?.id ?? id,
    title: proposal.title,
    category: proposal.category,
    keys: proposal.keys,
    content: proposal.content,
  };
}

function match(entries: readonly LoreEntry[], title: string): LoreEntry | undefined {
  if (!title) return undefined;
  const wanted = title.trim().toLowerCase();
  return entries.find((entry) => entry.title.trim().toLowerCase() === wanted);
}

/**
 * An entry with no keys can never fire, so a proposal that forgot them is given
 * its own title to answer to rather than being filed as something that will
 * never be read.
 */
function keysOf(value: unknown, title: string): string[] {
  const keys = Array.isArray(value) ? value.map(text).filter(Boolean) : [];
  const unique = [...new Set(keys.map((key) => key.toLowerCase()))].map((lower) =>
    keys.find((key) => key.toLowerCase() === lower)!,
  );
  return unique.length ? unique : [title];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
