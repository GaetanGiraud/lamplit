import { GenerationParams, Settings } from './models';

export const NANOGPT_BASE_URL = 'https://nano-gpt.com/api/v1';

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
    provider: 'nanogpt',
    baseUrl: NANOGPT_BASE_URL,
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
