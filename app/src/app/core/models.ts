/**
 * Persisted document shapes. Everything in here is written to storage as-is,
 * so treat these as a file format: add fields, never repurpose them.
 */

export type Provider = 'nanogpt' | 'custom';

export interface ModelInfo {
  id: string;
  /** Friendly name when the endpoint offers one (NanoGPT `?detailed=true`). */
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

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Chain-of-thought text some endpoints stream separately. Never sent back. */
  reasoning?: string;
  createdAt: string;
  editedAt?: string;
  meta?: MessageMeta;
}

export interface Chat {
  id: string;
  storyId: string | null;
  title: string;
  chapterNumber: number;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  messages: ChatMessage[];
}

/** What actually goes over the wire to the endpoint. */
export interface OutboundMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
