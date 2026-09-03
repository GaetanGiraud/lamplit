import {
  DEFAULT_NARRATOR_PROMPT,
  DEFAULT_SUMMARY_INSTRUCTION,
  REPLY_LENGTH_HINTS,
} from './defaults';
import {
  Chapter,
  ChapterMessage,
  GenerationParams,
  LoreEntry,
  OutboundMessage,
  Story,
} from './models';
import { TokenEstimator } from './tokens';

export type BlockId = 'mode' | 'persona' | 'story-so-far' | 'lore' | 'scene' | 'style';

export interface PromptBlock {
  id: BlockId;
  label: string;
  content: string;
  tokens: number;
}

/** Why an entry is in this request, for the "What the model sees" modal. */
export interface LoreHit {
  entry: LoreEntry;
  /** The key that matched, or empty when the entry is always on. */
  key: string;
  where: 'always on' | 'scene' | 'message' | 'draft';
}

export interface PromptInput {
  story: Story;
  chapter: Chapter;
  /** The message about to be sent; counted, and appended as the last turn. */
  draft?: string;
  /** History to use instead of the chapter's own, for regenerate and replay. */
  messages?: readonly ChapterMessage[];
  params: GenerationParams;
  estimator: TokenEstimator;
}

export interface BuiltPrompt {
  messages: OutboundMessage[];
  blocks: PromptBlock[];
  lore: LoreHit[];
  tokens: {
    system: number;
    history: number;
    draft: number;
    total: number;
    budget: number;
    reserve: number;
  };
  /** History messages the budget forced out of this request. */
  dropped: number;
}

/**
 * The whole prompt, rebuilt from data. Pure: same documents in, same request
 * out, which is what makes edit / regenerate / replay a single code path and
 * lets the preview modal show exactly what the next send will carry.
 */
export function buildPrompt(input: PromptInput): BuiltPrompt {
  const { story, chapter, params, estimator } = input;
  const history = input.messages ?? chapter.messages;
  const draft = (input.draft ?? '').trim();

  const lore = activeLore(story, chapter, history, draft);
  const blocks = systemBlocks(story, chapter, lore, estimator);
  const system = blocks.map((b) => b.content).join('\n\n');
  const systemMessage: OutboundMessage[] = system ? [{ role: 'system', content: system }] : [];

  const systemTokens = estimator.countMessages(systemMessage);
  const draftMessage: OutboundMessage[] = draft ? [{ role: 'user', content: draft }] : [];
  const draftTokens = estimator.countMessages(draftMessage);

  const reserve = params.maxResponseTokens;
  const budget = Math.max(0, params.maxContextTokens - reserve - systemTokens - draftTokens);

  const usable = history.filter((m) => m.content.trim() && !m.meta?.error);
  const kept: OutboundMessage[] = [];
  let historyTokens = 0;
  // Oldest messages drop out first, so the newest turns always survive.
  for (let i = usable.length - 1; i >= 0; i--) {
    const message: OutboundMessage = { role: usable[i].role, content: usable[i].content };
    const cost = estimator.countMessages([message]);
    if (historyTokens + cost > budget && (kept.length || draft)) break;
    kept.unshift(message);
    historyTokens += cost;
  }

  return {
    messages: [...systemMessage, ...kept, ...draftMessage],
    blocks,
    lore,
    tokens: {
      system: systemTokens,
      history: historyTokens,
      draft: draftTokens,
      total: systemTokens + historyTokens + draftTokens,
      budget: params.maxContextTokens,
      reserve,
    },
    dropped: usable.length - kept.length,
  };
}

/**
 * The summarisation request behind "Close chapter". It carries the story so far
 * as it stands, because the answer replaces it rather than being appended to
 * it — which is what keeps the summary one readable page however long the story
 * runs.
 */
export function buildSummaryPrompt(story: Story, chapter: Chapter): OutboundMessage[] {
  const existing = story.world.storySoFar.trim();
  const title = chapter.title.trim();
  const parts: string[] = [
    existing
      ? `The story so far, as it stands:\n${existing}`
      : 'There is no summary of the story yet: this is the first chapter to fold in.',
    `Chapter ${chapter.number}${title ? `, ${title}` : ''} has just finished.`,
  ];
  if (chapter.scene.trim()) parts.push(`The scene it opened on:\n${chapter.scene.trim()}`);
  const transcript = chapter.messages
    .filter((m) => m.content.trim() && !m.meta?.error)
    .map((m) => `${m.role === 'user' ? 'Reader' : 'Story'}: ${m.content.trim()}`)
    .join('\n\n');
  parts.push(`What happened in it:\n${transcript || '(nothing was written in this chapter)'}`);

  return [
    {
      role: 'system',
      content: 'You keep the running summary of an ongoing story, accurately and plainly.',
    },
    { role: 'user', content: `${parts.join('\n\n')}\n\n${summaryInstruction(story)}` },
  ];
}

/** Ours, or the writer's own once they have overridden it. */
export function summaryInstruction(story: Story): string {
  const custom = story.world.summary.prompt.trim();
  return story.world.summary.useDefault || !custom ? DEFAULT_SUMMARY_INSTRUCTION : custom;
}

/** A chapter with no title of its own is known by its scene's first line. */
export function chapterTitle(chapter: Pick<Chapter, 'title' | 'scene'>): string {
  return chapter.title.trim() || firstLine(chapter.scene);
}

/** The scene's opening line, trimmed to something a list row can hold. */
export function firstLine(scene: string, max = 80): string {
  const line = scene.trim().split('\n')[0]?.trim() ?? '';
  if (line.length <= max) return line;
  return `${line.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

function systemBlocks(
  story: Story,
  chapter: Chapter,
  lore: readonly LoreHit[],
  estimator: TokenEstimator,
): PromptBlock[] {
  const blocks: { id: BlockId; label: string; content: string }[] = [
    {
      id: 'mode',
      label: story.mode === 'narrator' ? 'Narrator' : 'Role-play',
      content: modeBlock(story),
    },
    { id: 'persona', label: 'Persona', content: personaBlock(story) },
    { id: 'story-so-far', label: 'The story so far', content: storySoFarBlock(story) },
    { id: 'lore', label: 'World', content: loreBlock(lore) },
    { id: 'scene', label: 'This chapter', content: sceneBlock(chapter) },
    { id: 'style', label: 'Style', content: styleBlock(story) },
  ];
  return blocks
    .filter((block) => block.content.trim())
    .map((block) => ({ ...block, tokens: estimator.count(block.content) }));
}

function modeBlock(story: Story): string {
  if (story.mode === 'narrator') {
    const custom = story.narrator.prompt.trim();
    return story.narrator.useDefault || !custom ? DEFAULT_NARRATOR_PROMPT : custom;
  }

  const cast = story.characters.filter((c) => c.enabled && c.name.trim());
  if (!cast.length) {
    return 'You play every character the story needs except the one the user plays. Answer in character, in the first person.';
  }
  const lines = [
    `You are playing ${joinNames(cast.map((c) => c.name.trim()))}. Answer in character, in the first person, as they would speak and act.`,
  ];
  for (const character of cast) {
    lines.push(`${character.name.trim()}: ${character.description.trim() || '(no description)'}`);
  }
  return lines.join('\n');
}

function personaBlock(story: Story): string {
  const name = story.persona.name.trim();
  const description = story.persona.description.trim();
  if (!name && !description) return '';
  if (!description) return `The user plays ${name}.`;
  return `The user plays ${name || 'the reader'}: ${description}`;
}

function storySoFarBlock(story: Story): string {
  const text = story.world.storySoFar.trim();
  return text ? `The story so far:\n${text}` : '';
}

function loreBlock(lore: readonly LoreHit[]): string {
  if (!lore.length) return '';
  const lines = lore.map((hit) => `- ${hit.entry.title.trim()}: ${hit.entry.content.trim()}`);
  return `What is true in this world:\n${lines.join('\n')}`;
}

function sceneBlock(chapter: Chapter): string {
  const scene = chapter.scene.trim();
  if (!scene) return '';
  const title = chapter.title.trim();
  return `Chapter ${chapter.number}${title ? `, ${title}` : ''}. The scene:\n${scene}`;
}

function styleBlock(story: Story): string {
  return [
    'Write dialogue in "double quotes" and everything else as plain prose.',
    story.style.dialogueOnOwnLine ? 'Give each spoken line a paragraph of its own.' : '',
    REPLY_LENGTH_HINTS[story.style.replyLength],
    story.mode === 'roleplay'
      ? `Stay in character, and never write words, thoughts or actions for ${story.persona.name.trim() || 'the user'}.`
      : 'Stay inside the story: no notes to the reader, no asking what they would like next.',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Keyword scan over the scene, the draft and the last N messages. The scene is
 * in the window on purpose: an entry named there fires on the first message of
 * the chapter rather than only once someone mentions it again.
 */
function activeLore(
  story: Story,
  chapter: Chapter,
  history: readonly ChapterMessage[],
  draft: string,
): LoreHit[] {
  const scan = story.world.scan;
  const recent = scan.depth > 0 ? history.slice(-scan.depth) : [];
  const windows: { where: LoreHit['where']; text: string }[] = [
    { where: 'scene', text: chapter.scene },
    { where: 'message', text: recent.map((m) => m.content).join('\n') },
    { where: 'draft', text: draft },
  ];

  const hits: LoreHit[] = [];
  for (const entry of story.world.entries) {
    // An entry is the sentence it contributes, so one with no text cannot
    // fire. The World modal marks those as unfinished rather than hiding it.
    if (!entry.enabled || !entry.content.trim()) continue;
    if (entry.alwaysOn) {
      hits.push({ entry, key: '', where: 'always on' });
      continue;
    }
    const caseSensitive = entry.caseSensitive ?? scan.caseSensitive;
    const wholeWords = entry.matchWholeWords ?? scan.matchWholeWords;
    for (const window of windows) {
      const key = matchingKey(entry.keys, window.text, caseSensitive, wholeWords);
      if (key) {
        hits.push({ entry, key, where: window.where });
        break;
      }
    }
  }
  return hits;
}

function matchingKey(
  keys: readonly string[],
  text: string,
  caseSensitive: boolean,
  wholeWords: boolean,
): string {
  if (!text.trim()) return '';
  const haystack = caseSensitive ? text : text.toLowerCase();
  for (const raw of keys) {
    const key = raw.trim();
    if (!key) continue;
    const needle = caseSensitive ? key : key.toLowerCase();
    if (wholeWords ? wordPattern(needle).test(haystack) : haystack.includes(needle)) return key;
  }
  return '';
}

/** `\b` misbehaves next to punctuation, so guard both edges by hand. */
function wordPattern(needle: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(needle)}(?![\\p{L}\\p{N}_])`, 'u');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function joinNames(names: readonly string[]): string {
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
