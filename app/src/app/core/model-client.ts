import { Injectable } from '@angular/core';
import { GenerationParams, ModelInfo, OutboundMessage, TokenUsage } from './models';
import { NANOGPT_BASE_URL } from './defaults';
import { readSseData } from './sse';
import { ModelError, errorFromResponse, errorFromThrown } from './model-errors';

export interface ChatStreamRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: readonly OutboundMessage[];
  params: GenerationParams;
}

export interface ChatStreamResult {
  content: string;
  reasoning: string;
  usage?: TokenUsage;
  finishReason?: string;
  aborted: boolean;
}

export type DeltaHandler = (delta: { content?: string; reasoning?: string }) => void;

@Injectable({ providedIn: 'root' })
export class ModelClient {
  /**
   * `GET {baseUrl}/models`. NanoGPT's `?detailed=true` adds display names and
   * context lengths; hand-typed URLs get the plain call.
   */
  async listModels(baseUrl: string, apiKey: string): Promise<ModelInfo[]> {
    const base = normaliseBaseUrl(baseUrl);
    const detailed = base === NANOGPT_BASE_URL;
    let response: Response;
    try {
      response = await fetch(`${base}/models${detailed ? '?detailed=true' : ''}`, {
        headers: authHeaders(apiKey),
      });
    } catch (e) {
      throw errorFromThrown(e);
    }
    if (!response.ok) throw errorFromResponse(response.status, await safeText(response));

    const payload: unknown = await response.json().catch(() => null);
    const models = toModelList(payload);
    if (!models.length) {
      throw new ModelError('bad-request', 'The endpoint returned no models.');
    }
    return models;
  }

  /** One short round trip, used by the Connection modal's Test button. */
  async testConnection(baseUrl: string, apiKey: string, model: string): Promise<string> {
    const result = await this.streamChat(
      {
        baseUrl,
        apiKey,
        model,
        messages: [{ role: 'user', content: 'Say OK.' }],
        params: { maxResponseTokens: 8, temperature: 0, stop: [] } as unknown as GenerationParams,
      },
      () => {},
    );
    return result.content.trim();
  }

  /**
   * `POST {baseUrl}/chat/completions` with `stream: true`, parsed as SSE.
   * Deltas arrive through `onDelta`; the resolved result carries the provider's
   * own `usage` and `finish_reason` when the final chunk includes them.
   * Aborting via `signal` resolves rather than throwing, so partial text is kept.
   */
  async streamChat(
    request: ChatStreamRequest,
    onDelta: DeltaHandler,
    signal?: AbortSignal,
  ): Promise<ChatStreamResult> {
    const url = `${normaliseBaseUrl(request.baseUrl)}/chat/completions`;

    let response = await this.post(url, request, true, signal);
    // Not every OpenAI-compatible server knows `stream_options`; one retry
    // without it costs nothing and keeps odd endpoints working.
    if (response.status === 400) {
      const body = await safeText(response);
      if (body.includes('stream_options')) {
        response = await this.post(url, request, false, signal);
      } else {
        throw errorFromResponse(400, body);
      }
    }
    if (!response.ok) throw errorFromResponse(response.status, await safeText(response));
    if (!response.body) throw new ModelError('unknown', 'The endpoint returned an empty stream.');

    const result: ChatStreamResult = { content: '', reasoning: '', aborted: false };
    try {
      for await (const payload of readSseData(response.body)) {
        if (payload === '[DONE]') break;
        const chunk = parseChunk(payload);
        if (!chunk) continue;
        if (chunk.error) throw new ModelError('unknown', chunk.error);
        if (chunk.usage) result.usage = chunk.usage;
        if (chunk.finishReason) result.finishReason = chunk.finishReason;
        if (chunk.content) {
          result.content += chunk.content;
          onDelta({ content: chunk.content });
        }
        if (chunk.reasoning) {
          result.reasoning += chunk.reasoning;
          onDelta({ reasoning: chunk.reasoning });
        }
      }
    } catch (e) {
      const error = errorFromThrown(e);
      if (error.kind !== 'aborted') throw error;
      result.aborted = true;
    }
    if (signal?.aborted) result.aborted = true;
    return result;
  }

  private async post(
    url: string,
    request: ChatStreamRequest,
    withStreamOptions: boolean,
    signal?: AbortSignal,
  ): Promise<Response> {
    try {
      return await fetch(url, {
        method: 'POST',
        headers: { ...authHeaders(request.apiKey), 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(request, withStreamOptions)),
        signal,
      });
    } catch (e) {
      throw errorFromThrown(e);
    }
  }
}

/** The whole request body, rebuilt from parameters every time. */
export function buildBody(
  request: ChatStreamRequest,
  withStreamOptions = true,
): Record<string, unknown> {
  const p = request.params;
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    stream: true,
    max_tokens: p.maxResponseTokens,
  };
  if (withStreamOptions) body['stream_options'] = { include_usage: true };

  // Defined-only, so an endpoint never sees a parameter the user did not set.
  setIfNumber(body, 'temperature', p.temperature);
  setIfNumber(body, 'top_p', p.topP);
  setIfNumber(body, 'frequency_penalty', p.frequencyPenalty);
  setIfNumber(body, 'presence_penalty', p.presencePenalty);
  setIfNumber(body, 'seed', p.seed);
  setIfNumber(body, 'top_k', p.topK);
  setIfNumber(body, 'min_p', p.minP);
  setIfNumber(body, 'repetition_penalty', p.repetitionPenalty);
  setIfNumber(body, 'top_a', p.topA);
  if (p.stop?.length) body['stop'] = p.stop;
  if (p.reasoningEffort && p.reasoningEffort !== 'none') {
    body['reasoning_effort'] = p.reasoningEffort;
  }
  return body;
}

interface ParsedChunk {
  content?: string;
  reasoning?: string;
  finishReason?: string;
  usage?: TokenUsage;
  error?: string;
}

/** One SSE `data:` payload of a chat-completions stream. */
export function parseChunk(payload: string): ParsedChunk | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null; // keep-alive noise or a line we can safely skip
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const root = parsed as Record<string, any>;

  if (root['error']) {
    const message = typeof root['error'] === 'string' ? root['error'] : root['error']?.message;
    return { error: message || 'The provider reported an error mid-stream.' };
  }

  const chunk: ParsedChunk = {};
  const choice = Array.isArray(root['choices']) ? root['choices'][0] : undefined;
  const delta = choice?.delta ?? {};
  if (typeof delta.content === 'string') chunk.content = delta.content;
  // `reasoning_content` (DeepSeek-style) and `reasoning` (OpenRouter-style).
  const reasoning = delta.reasoning_content ?? delta.reasoning;
  if (typeof reasoning === 'string') chunk.reasoning = reasoning;
  if (typeof choice?.finish_reason === 'string') chunk.finishReason = choice.finish_reason;

  const usage = root['usage'];
  if (usage && typeof usage === 'object') {
    chunk.usage = {
      promptTokens: numberOrUndefined(usage.prompt_tokens),
      completionTokens: numberOrUndefined(usage.completion_tokens),
      totalTokens: numberOrUndefined(usage.total_tokens),
    };
  }
  return chunk;
}

/** Trims trailing slashes and a trailing `/chat/completions` a user may paste. */
export function normaliseBaseUrl(baseUrl: string): string {
  return baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/, '');
}

function authHeaders(apiKey: string): Record<string, string> {
  const key = apiKey.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function toModelList(payload: unknown): ModelInfo[] {
  const root = payload as Record<string, any> | null;
  const raw = Array.isArray(root) ? root : Array.isArray(root?.['data']) ? root['data'] : [];
  const models: ModelInfo[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const id = typeof entry.id === 'string' ? entry.id : undefined;
    if (!id) continue;
    models.push({
      id,
      name: typeof entry.name === 'string' && entry.name !== id ? entry.name : undefined,
      ownedBy: typeof entry.owned_by === 'string' ? entry.owned_by : undefined,
      created: numberOrUndefined(entry.created),
      contextLength: numberOrUndefined(entry.context_length ?? entry.context_window),
    });
  }
  models.sort((a, b) => a.id.localeCompare(b.id));
  return models;
}

function setIfNumber(body: Record<string, unknown>, key: string, value: unknown): void {
  if (typeof value === 'number' && Number.isFinite(value)) body[key] = value;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
