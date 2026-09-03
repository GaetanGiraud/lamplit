import { GenerationParams, ReplyLength, ScanSettings, Settings, StoryStyle } from './models';
import { DEFAULT_PROVIDER_ID, providerPreset } from './providers';

export const DEFAULT_GENERATION: GenerationParams = {
  maxContextTokens: 16384,
  maxResponseTokens: 800,
  temperature: 0.9,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
  stop: [],
};

export const DEFAULT_SETTINGS: Settings = {
  connection: {
    provider: DEFAULT_PROVIDER_ID,
    baseUrl: providerPreset(DEFAULT_PROVIDER_ID).baseUrl,
    apiKey: '',
    model: '',
    modelsCache: [],
  },
  generation: { ...DEFAULT_GENERATION },
  ui: {
    theme: 'dark',
    bookStyleDialogue: true,
    fontSize: 18,
    showTokenCounts: true,
  },
  activeStoryId: null,
  acknowledgedVersion: null,
};

/** Ranges the parameters modal uses, kept next to the defaults they bound. */
export const PARAM_RANGES = {
  maxContextTokens: { min: 1024, max: 200000, step: 1024 },
  maxResponseTokens: { min: 64, max: 8192, step: 64 },
  temperature: { min: 0, max: 2, step: 0.05 },
  topP: { min: 0, max: 1, step: 0.01 },
  frequencyPenalty: { min: -2, max: 2, step: 0.05 },
  presencePenalty: { min: -2, max: 2, step: 0.05 },
  topK: { min: 0, max: 200, step: 1 },
  minP: { min: 0, max: 1, step: 0.01 },
  repetitionPenalty: { min: 0.5, max: 2, step: 0.01 },
  topA: { min: 0, max: 1, step: 0.01 },
} as const;

// ---------------------------------------------------------------------------
// Story defaults
// ---------------------------------------------------------------------------

export const DEFAULT_STORY_TITLE = 'Untitled story';

/** Shown read-only in the Story modal until the writer switches on Override. */
export const DEFAULT_NARRATOR_PROMPT = [
  'You are the narrator of an ongoing story, writing it as it happens.',
  'Write in third person, past tense, in clear literary prose. Follow the story',
  'wherever the user takes it: describe what happens, what is said, and what the',
  'world does in return. Advance the scene with every reply and end on something',
  'the user can answer. Never summarise the story back to the user, never break',
  'the frame to comment or ask what they would like, and never write for them.',
].join(' ');

export const DEFAULT_SCAN: ScanSettings = {
  depth: 4,
  caseSensitive: false,
  matchWholeWords: false,
};

export const DEFAULT_STYLE: StoryStyle = {
  dialogueOnOwnLine: true,
  replyLength: 'medium',
};

export const REPLY_LENGTH_HINTS: Record<ReplyLength, string> = {
  short: 'Keep replies short: a paragraph, two at the most.',
  medium: 'Aim for two or three paragraphs per reply.',
  long: 'Write generously: four or more paragraphs per reply.',
};

/**
 * The story so far is rewritten, not appended to, so this asks for the whole
 * thing back: the existing summary folded together with the chapter just
 * finished. Modelled on SillyTavern's memory extension default, which does the
 * same ("if a summary already exists, use that as a base and expand it").
 */
export const DEFAULT_SUMMARY_INSTRUCTION = [
  'Rewrite the story so far so that it covers this chapter as well.',
  'Start from the summary as it stands, fold in what happened in this chapter,',
  'and drop the detail that no longer matters. Keep names, places, promises,',
  'injuries and anything else it would be strange for the story to forget.',
  'Write continuous past-tense prose, at most 300 words, and respond with',
  'nothing but the new summary.',
].join(' ');
