import { InjectionToken } from '@angular/core';
import { OutboundMessage } from './models';

/**
 * Token counting is an estimate on purpose: exact counts are provider-specific
 * and the context budget is a budget, not a guarantee. `gpt-tokenizer` can be
 * dropped in behind this interface later without touching callers.
 */
export interface TokenEstimator {
  count(text: string): number;
  countMessages(messages: readonly OutboundMessage[]): number;
}

/** Roughly 3.6 characters per token across English prose and markdown. */
const CHARS_PER_TOKEN = 3.6;
/** Role/separator overhead each message costs in the chat-completions format. */
const PER_MESSAGE_OVERHEAD = 4;

export const heuristicEstimator: TokenEstimator = {
  count(text) {
    if (!text) return 0;
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  },
  countMessages(messages) {
    return messages.reduce(
      (total, m) => total + PER_MESSAGE_OVERHEAD + heuristicEstimator.count(m.content),
      0,
    );
  },
};

export const TOKEN_ESTIMATOR = new InjectionToken<TokenEstimator>('TokenEstimator', {
  providedIn: 'root',
  factory: () => heuristicEstimator,
});

/**
 * "3.2k" / "812" — for the pills and message footers.
 *
 * Rounded before the shape is chosen, not after: 9,999 rounds to ten thousand
 * and is written `10k`, where deciding on the raw number first wrote `10.0k`,
 * and a million was `1000k`.
 */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  const thousands = Math.round(n / 100) / 10;
  if (thousands < 10) return `${thousands.toFixed(1)}k`;
  const rounded = Math.round(n / 1000);
  return rounded < 1000 ? `${rounded}k` : `${(Math.round(n / 100_000) / 10).toFixed(1)}M`;
}
