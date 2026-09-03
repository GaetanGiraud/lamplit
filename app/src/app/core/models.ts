/**
 * Persisted document shapes. Everything in here is written to storage as-is,
 * so treat these as a file format: add fields, never repurpose them.
 */

/**
 * The id of a row in `providers.ts`, or `custom` for a hand-typed URL. A plain
 * string on purpose: a settings file may name a provider a later version added
 * or an earlier one has dropped, and neither should stop it loading.
 */
export type Provider = string;

export interface ModelInfo {
  id: string;
  /** Friendly name when the endpoint offers one (NanoGPT's `?detailed=true`). */
  name?: string;
  ownedBy?: string;
  created?: number;
  contextLength?: number;
}

export interface ConnectionSettings {
  provider: Provider;
  baseUrl: string;
  /** Plain text on purpose: single user, local machine. See README. */
  apiKey: string;
  model: string;
  modelsCache: ModelInfo[];
  modelsFetchedAt?: string;
}

export interface GenerationParams {
  maxContextTokens: number;
  maxResponseTokens: number;
  temperature: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  stop: string[];
  seed?: number;
  // Advanced. Sent only when defined; NanoGPT and friends accept them.
  topK?: number;
  minP?: number;
  repetitionPenalty?: number;
  topA?: number;
  reasoningEffort?: ReasoningEffort;
}

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high';

export interface UiSettings {
  theme: 'dark' | 'light';
  bookStyleDialogue: boolean;
  fontSize: number;
  showTokenCounts: boolean;
}

export interface Settings {
  connection: ConnectionSettings;
  generation: GenerationParams;
  ui: UiSettings;
  activeStoryId: string | null;
  /**
   * The version whose upgrade notice has been seen. Written when the notice is
   * dismissed, so the same one never appears twice.
   */
  acknowledgedVersion: string | null;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface MessageMeta {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  finishReason?: string;
  aborted?: boolean;
  /** Set when the turn failed; the bubble renders as an error with a retry. */
  error?: string;
}

export interface ChapterMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Chain-of-thought text some endpoints stream separately. Never sent back. */
  reasoning?: string;
  createdAt: string;
  editedAt?: string;
  meta?: MessageMeta;
}

// ---------------------------------------------------------------------------
// A story and its world
// ---------------------------------------------------------------------------

export type StoryMode = 'narrator' | 'roleplay';
export type ReplyLength = 'short' | 'medium' | 'long';
export type LoreCategory = 'fact' | 'person' | 'place' | 'other';

export interface Character {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

export interface LoreEntry {
  id: string;
  title: string;
  category: LoreCategory;
  keys: string[];
  content: string;
  enabled: boolean;
  /** Skips the keyword scan: this entry is in every request. */
  alwaysOn: boolean;
  /** Both fall back to the story's scan settings when left undefined. */
  caseSensitive?: boolean;
  matchWholeWords?: boolean;
}

/** Global defaults for the keyword scan, overridable per entry. */
export interface ScanSettings {
  /** How many of the most recent messages join the scan window. */
  depth: number;
  caseSensitive: boolean;
  matchWholeWords: boolean;
}

export interface StoryWorld {
  /**
   * Compulsory, always injected. Closing a chapter rewrites it rather than
   * appending to it, so it stays the same size however long the story runs.
   */
  storySoFar: string;
  /** How "close chapter" is asked to rewrite it; `useDefault` keeps ours. */
  summary: { useDefault: boolean; prompt: string };
  entries: LoreEntry[];
  scan: ScanSettings;
}

export interface StoryStyle {
  /** A prompt instruction, not a rendering choice: see UiSettings for that. */
  dialogueOnOwnLine: boolean;
  replyLength: ReplyLength;
}

export interface Story {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  mode: StoryMode;
  /** Narrator mode only; `useDefault` keeps the built-in preamble. */
  narrator: { useDefault: boolean; prompt: string };
  characters: Character[];
  persona: { name: string; description: string };
  style: StoryStyle;
  world: StoryWorld;
  activeChapterId: string;
  /** Only ever increases: chapter 3 stays chapter 3 after a deletion. */
  chapterCounter: number;
}

/**
 * One file per chapter. There is no separate "chat" document: a chapter *is*
 * the conversation, plus the scene it opens on and the summary it closes with.
 */
export interface Chapter {
  id: string;
  storyId: string;
  number: number;
  title: string;
  /** Written before the first message, injected verbatim, never parsed. */
  scene: string;
  status: 'writing' | 'closed';
  summary: string;
  createdAt: string;
  updatedAt: string;
  messages: ChapterMessage[];
}

/** What actually goes over the wire to the endpoint. */
export interface OutboundMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
