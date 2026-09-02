import { Component, effect, inject } from '@angular/core';
import { ChatPage } from './features/chat/chat-page';
import { TopBar } from './shared/top-bar';
import { SettingsStore } from './store/settings-store';
import { ChatStore } from './store/chat-store';
import { DialogsService } from './shared/dialogs.service';

@Component({
  selector: 'app-root',
  imports: [TopBar, ChatPage],
  template: `
    <ms-top-bar />
    <ms-chat-page />
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }

    ms-chat-page {
      flex: 1;
      min-height: 0;
    }
  `,
  host: {
    '(document:keydown)': 'onKey($event)',
  },
})
export class App {
  private readonly settings = inject(SettingsStore);
  private readonly chat = inject(ChatStore);
  private readonly dialogs = inject(DialogsService);

  constructor() {
    // The whole palette hangs off `color-scheme`, so this one line is the theme.
    effect(() => {
      document.documentElement.style.colorScheme = this.settings.ui().theme;
    });
  }

  protected onKey(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      void this.chat.retryLast();
    } else if (event.key.toLowerCase() === 'k') {
      event.preventDefault();
      void this.dialogs.openConnection();
    }
  }
}
