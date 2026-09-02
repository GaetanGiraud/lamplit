import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ChatStore } from '../../store/chat-store';
import { SettingsStore } from '../../store/settings-store';
import { DialogsService } from '../../shared/dialogs.service';
import { Composer } from './composer';
import { MessageList } from './message-list';

@Component({
  selector: 'ms-chat-page',
  imports: [MatButtonModule, Composer, MessageList],
  template: `
    <section class="page">
      @if (chat.isEmpty()) {
        <div class="welcome">
          <div class="card">
            <h1>A blank page</h1>
            @if (settings.isConnected()) {
              <p>
                Write the first line below and the story starts. Say what you do, or set the scene —
                either works.
              </p>
              <p class="ms-hint">Answering with {{ settings.connection().model }}.</p>
            } @else {
              <p>
                MagicStories talks straight from this page to any OpenAI-compatible endpoint. Point
                it at one and start writing.
              </p>
              <button matButton="filled" (click)="dialogs.openConnection()">Connect a model</button>
            }
          </div>
        </div>
      } @else {
        <ms-message-list />
      }

      <ms-composer />
    </section>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
      min-height: 0;
    }

    .page {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }

    .welcome {
      flex: 1;
      display: grid;
      place-items: center;
      padding: 1.5rem;
      min-height: 0;
    }

    .card {
      max-width: 28rem;
      text-align: center;
    }

    h1 {
      font-family: var(--ms-serif);
      font-weight: 500;
      font-size: 1.9rem;
      margin: 0 0 0.6rem;
      color: var(--ms-ink);
    }

    p {
      font-family: var(--ms-serif);
      font-size: 1.02rem;
      line-height: 1.6;
      color: var(--ms-ink-soft);
      margin: 0 0 1rem;
    }

    p.ms-hint {
      font-family: var(--ms-sans);
      font-size: 0.78rem;
    }
  `,
})
export class ChatPage {
  protected readonly chat = inject(ChatStore);
  protected readonly settings = inject(SettingsStore);
  protected readonly dialogs = inject(DialogsService);
}
