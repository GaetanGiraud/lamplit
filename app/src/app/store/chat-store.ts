import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Chat, ChatMessage, OutboundMessage } from '../core/models';
import { ModelClient } from '../core/model-client';
import { ModelError, errorFromThrown } from '../core/model-errors';
import { TOKEN_ESTIMATOR } from '../core/tokens';
import { SettingsStore } from './settings-store';
import { STORAGE_BACKEND, STORAGE_KEYS } from './storage';

export interface ContextReport {
  used: number;
  budget: number;
  /** History messages the budget forced out of this request. */
  dropped: number;
}

/**
 * The active chat: messages plus the streaming turn.
 *
 * Every request is rebuilt from the message list — nothing about a turn is
 * remembered between requests, so edit / regenerate / replay all go through
 * the same path as a fresh send.
 */
@Injectable({ providedIn: 'root' })
export class ChatStore {
  private readonly storage = inject(STORAGE_BACKEND);
  private readonly settings = inject(SettingsStore);
  private readonly client = inject(ModelClient);
  private readonly estimator = inject(TOKEN_ESTIMATOR);

  private readonly state = signal<Chat>(this.load());
  private readonly streamingIdState = signal<string | null>(null);
  private controller: AbortController | null = null;

  /** Deltas land here and are flushed to the signal once per frame. */
  private pendingContent = '';
  private pendingReasoning = '';
  private frame: number | null = null;

  readonly chat = this.state.asReadonly();
  readonly messages = computed(() => this.state().messages);
  readonly streamingId = this.streamingIdState.asReadonly();
  readonly isStreaming = computed(() => this.streamingIdState() !== null);
  readonly isEmpty = computed(() => this.state().messages.length === 0);

  constructor() {
    effect(() => {
      const chat = this.state();
      this.storage.write(STORAGE_KEYS.chat(chat.id), chat);
      this.storage.write(STORAGE_KEYS.activeChat, chat.id);
    });
  }

  /** What the pill under the composer shows for the message being typed. */
  contextReport(draft: string): ContextReport {
    const budget = this.settings.generation().maxContextTokens;
    const messages = draft.trim()
      ? [...this.state().messages, this.userMessage(draft)]
      : this.state().messages;
    const { outbound, dropped } = this.assemble(messages);
    return { used: this.estimator.countMessages(outbound), budget, dropped };
  }

  async send(text: string): Promise<void> {
    const content = text.trim();
    if (!content || this.isStreaming()) return;
    this.appendMessage(this.userMessage(content));
    await this.runTurn();
  }

  stop(): void {
    this.controller?.abort();
  }

  editMessage(id: string, content: string): void {
    this.state.update((chat) => ({
      ...chat,
      updatedAt: now(),
      messages: chat.messages.map((m) => (m.id === id ? { ...m, content, editedAt: now() } : m)),
    }));
  }

  deleteMessage(id: string): void {
    if (this.streamingIdState() === id) this.stop();
    this.state.update((chat) => ({
      ...chat,
      updatedAt: now(),
      messages: chat.messages.filter((m) => m.id !== id),
    }));
  }

  /** Drops this assistant answer (and anything after it) and asks again. */
  async regenerate(id: string): Promise<void> {
    if (this.isStreaming()) return;
    const index = this.indexOf(id);
    if (index < 0) return;
    this.truncateTo(index);
    await this.runTurn();
  }

  /** Keeps this user message, drops every later message, sends it again. */
  async replayFrom(id: string): Promise<void> {
    if (this.isStreaming()) return;
    const index = this.indexOf(id);
    if (index < 0) return;
    this.truncateTo(index + 1);
    await this.runTurn();
  }

  /** Retry for the inline error bubble. */
  async retryLast(): Promise<void> {
    const messages = this.state().messages;
    const last = messages[messages.length - 1];
    if (!last) return;
    await (last.role === 'assistant' ? this.regenerate(last.id) : this.replayFrom(last.id));
  }

  clear(): void {
    this.stop();
    this.storage.remove(STORAGE_KEYS.chat(this.state().id));
    this.state.set(newChat());
  }

  private async runTurn(): Promise<void> {
    const connection = this.settings.connection();
    if (!this.settings.isConnected()) return;

    const placeholder: ChatMessage = {
      id: newId(),
      role: 'assistant',
      content: '',
      createdAt: now(),
      meta: { model: connection.model },
    };
    this.appendMessage(placeholder);
    this.streamingIdState.set(placeholder.id);

    const { outbound } = this.assemble(
      this.state().messages.filter((m) => m.id !== placeholder.id),
    );
    this.controller = new AbortController();

    try {
      const result = await this.client.streamChat(
        {
          baseUrl: connection.baseUrl,
          apiKey: connection.apiKey,
          model: connection.model,
          messages: outbound,
          params: this.settings.generation(),
        },
        (delta) => {
          if (delta.content) this.pendingContent += delta.content;
          if (delta.reasoning) this.pendingReasoning += delta.reasoning;
          this.queueFlush();
        },
        this.controller.signal,
      );
      this.flush();
      this.patchMessage(placeholder.id, {
        content: result.content,
        reasoning: result.reasoning || undefined,
        meta: {
          model: connection.model,
          promptTokens: result.usage?.promptTokens ?? this.estimator.countMessages(outbound),
          completionTokens: result.usage?.completionTokens ?? this.estimator.count(result.content),
          finishReason: result.finishReason,
          aborted: result.aborted || undefined,
        },
      });
    } catch (e) {
      this.flush();
      const error: ModelError = errorFromThrown(e);
      this.patchMessage(placeholder.id, {
        meta: { model: connection.model, error: error.message },
      });
    } finally {
      this.cancelFlush();
      this.controller = null;
      this.streamingIdState.set(null);
      this.touch();
    }
  }

  /**
   * Step 1 sends the bare history. The system blocks (mode, persona, world,
   * lore) arrive with the prompt builder in step 2; the budget trimming here
   * moves there with them.
   */
  private assemble(messages: readonly ChatMessage[]): {
    outbound: OutboundMessage[];
    dropped: number;
  } {
    const params = this.settings.generation();
    const reserve = params.maxResponseTokens;
    const budget = Math.max(0, params.maxContextTokens - reserve);

    const usable = messages.filter((m) => m.content.trim() && !m.meta?.error);
    const kept: OutboundMessage[] = [];
    let used = 0;
    // Oldest messages drop out first, so the newest turns always survive.
    for (let i = usable.length - 1; i >= 0; i--) {
      const message: OutboundMessage = { role: usable[i].role, content: usable[i].content };
      const cost = this.estimator.countMessages([message]);
      if (used + cost > budget && kept.length) break;
      kept.unshift(message);
      used += cost;
    }
    return { outbound: kept, dropped: usable.length - kept.length };
  }

  private queueFlush(): void {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.flush();
    });
  }

  private flush(): void {
    const id = this.streamingIdState();
    if (!id || (!this.pendingContent && !this.pendingReasoning)) return;
    const content = this.pendingContent;
    const reasoning = this.pendingReasoning;
    this.pendingContent = '';
    this.pendingReasoning = '';
    this.state.update((chat) => ({
      ...chat,
      messages: chat.messages.map((m) =>
        m.id === id
          ? {
              ...m,
              content: m.content + content,
              reasoning: reasoning ? (m.reasoning ?? '') + reasoning : m.reasoning,
            }
          : m,
      ),
    }));
  }

  private cancelFlush(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.pendingContent = '';
    this.pendingReasoning = '';
  }

  private appendMessage(message: ChatMessage): void {
    this.state.update((chat) => ({
      ...chat,
      updatedAt: now(),
      messages: [...chat.messages, message],
    }));
  }

  private patchMessage(id: string, patch: Partial<ChatMessage>): void {
    this.state.update((chat) => ({
      ...chat,
      messages: chat.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }));
  }

  private truncateTo(length: number): void {
    this.state.update((chat) => ({
      ...chat,
      updatedAt: now(),
      messages: chat.messages.slice(0, length),
    }));
  }

  private touch(): void {
    this.state.update((chat) => ({ ...chat, updatedAt: now() }));
  }

  private indexOf(id: string): number {
    return this.state().messages.findIndex((m) => m.id === id);
  }

  private userMessage(content: string): ChatMessage {
    return { id: newId(), role: 'user', content, createdAt: now() };
  }

  private load(): Chat {
    const id = this.storage.read<string>(STORAGE_KEYS.activeChat);
    const stored = id ? this.storage.read<Chat>(STORAGE_KEYS.chat(id)) : null;
    if (!stored || !Array.isArray(stored.messages)) return newChat();
    // A reload mid-stream would otherwise restore a message stuck at "typing".
    return { ...stored, messages: stored.messages.filter((m) => m.content || m.meta?.error) };
  }
}

function newChat(): Chat {
  return {
    id: newId(),
    storyId: null,
    title: 'Chapter 1',
    chapterNumber: 1,
    createdAt: now(),
    updatedAt: now(),
    archived: false,
    messages: [],
  };
}

function now(): string {
  return new Date().toISOString();
}

function newId(): string {
  return crypto.randomUUID();
}
