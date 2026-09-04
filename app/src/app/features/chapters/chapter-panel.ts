import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DEFAULT_NARRATOR_PROMPT } from '../../core/defaults';
import { PanelSection } from '../../core/models';
import { firstLine } from '../../core/prompt-builder';
import { DialogsService } from '../../shared/dialogs.service';
import { EditorField } from '../../shared/editor-field';
import { TextValue } from '../../shared/text-value';
import { ChapterStore } from '../../store/chapter-store';
import { SettingsStore } from '../../store/settings-store';
import { StoryStore } from '../../store/story-store';

/**
 * Where the panel stops pushing the page and starts covering it.
 *
 * Above this the reading column still has its measure with the panel beside
 * it, so the panel takes its width out of the page and everything stays
 * visible. Below it there is nothing left to give, so it comes over the page
 * and goes away again on Escape. One number, because the layout only ever asks
 * the one question.
 */
const PANEL_PUSH_WIDTH = 1100;

/**
 * The chapter's own fields, beside the page instead of over it.
 *
 * The scene, the narrator's instructions, the persona and the cast are what
 * shape the chapter being written, and every one of them used to mean leaving
 * the story for a modal and coming back. They are all here, edited where they
 * are, saved the way every other field in the app is saved — on blur, with a
 * mark while there is something unsaved.
 *
 * Nothing about the app itself is in here. Preferences, the connection and the
 * sampling parameters are not chapter fields and stay behind their own sheets.
 */
@Component({
  selector: 'ms-chapter-panel',
  imports: [MatTooltipModule, EditorField, TextValue],
  template: `
    @if (open()) {
      <!-- Only when it is covering the page: something has to say the page is
           behind it, and be the click that gives the page back. -->
      @if (overlay()) {
        <div class="scrim" (click)="close()"></div>
      }

      <aside class="panel" aria-label="This chapter">
        <header class="top">
          <span class="what">This chapter</span>
          <button
            type="button"
            class="icon"
            aria-label="Close the chapter panel"
            matTooltip="Close it (Ctrl+.)"
            (click)="close()"
          >
            ›
          </button>
        </header>

        <div class="scroll">
          <section class="block" data-section="scene">
            <button
              type="button"
              class="head"
              [attr.aria-expanded]="isOpen('scene')"
              (click)="toggleSection('scene')"
            >
              <span class="mark">{{ isOpen('scene') ? '▾' : '▸' }}</span>
              <span class="name">Scene</span>
              <span class="aside">{{ sceneLabel() }}</span>
            </button>
            @if (isOpen('scene')) {
              <div class="body">
                <ms-editor-field
                  serif
                  ariaLabel="The scene"
                  [rows]="6"
                  [value]="chapters.chapter().scene"
                  [readOnly]="chapters.isClosed()"
                  [hint]="sceneHint()"
                  placeholder="A lighthouse gallery. Dusk, the first night of autumn."
                  (save)="setScene($event)"
                />
              </div>
            }
          </section>

          @if (story().mode === 'narrator') {
            <section class="block" data-section="narrator">
              <button
                type="button"
                class="head"
                [attr.aria-expanded]="isOpen('narrator')"
                (click)="toggleSection('narrator')"
              >
                <span class="mark">{{ isOpen('narrator') ? '▾' : '▸' }}</span>
                <span class="name">Narrator</span>
                <span class="aside">{{
                  story().narrator.useDefault ? 'default' : 'your own'
                }}</span>
              </button>
              @if (isOpen('narrator')) {
                <div class="body">
                  <!-- The default sits in the box it would be edited in, greyed
                       until it is written over. Typing is what adopts it. -->
                  <ms-editor-field
                    ariaLabel="Narrator instructions"
                    [rows]="7"
                    [value]="narratorText()"
                    [dimmed]="story().narrator.useDefault"
                    (save)="setNarrator($event)"
                  />
                  @if (story().narrator.useDefault) {
                    <p class="ms-hint">
                      The instructions Lamplit ships with. Write into them and they become yours.
                    </p>
                  } @else {
                    <button type="button" class="link" (click)="backToDefault()">
                      Back to the default
                    </button>
                  }
                </div>
              }
            </section>
          }

          <section class="block" data-section="persona">
            <button
              type="button"
              class="head"
              [attr.aria-expanded]="isOpen('persona')"
              (click)="toggleSection('persona')"
            >
              <span class="mark">{{ isOpen('persona') ? '▾' : '▸' }}</span>
              <span class="name">Persona</span>
              <span class="aside">{{ story().persona.name }}</span>
            </button>
            @if (isOpen('persona')) {
              <div class="body">
                <input
                  class="line-field"
                  aria-label="Persona name"
                  placeholder="Who you are in this story"
                  [msText]="story().persona.name"
                  (change)="setPersona({ name: value($event) })"
                />
                <ms-editor-field
                  ariaLabel="Persona description"
                  [rows]="4"
                  [value]="story().persona.description"
                  placeholder="Mara, a marine biologist, thirty-one, back on the island after nine years."
                  (save)="setPersona({ description: $event })"
                />
              </div>
            }
          </section>

          @if (story().mode === 'roleplay') {
            <section class="block" data-section="cast">
              <button
                type="button"
                class="head"
                [attr.aria-expanded]="isOpen('cast')"
                (click)="toggleSection('cast')"
              >
                <span class="mark">{{ isOpen('cast') ? '▾' : '▸' }}</span>
                <span class="name">Cast</span>
                <span class="aside">{{ castLabel() }}</span>
              </button>
              @if (isOpen('cast')) {
                <div class="body">
                  <!-- A character is a name and a paragraph, which is more than
                       a row can hold: these are read here, edited in the sheet. -->
                  @for (character of story().characters; track character.id) {
                    <div class="cast-row" [class.off]="!character.enabled">
                      <span class="swatch"></span>
                      <span class="who">
                        <span class="cast-name">{{ character.name || 'Unnamed' }}</span>
                        <span class="cast-line">{{ describe(character.description) }}</span>
                      </span>
                      <button
                        type="button"
                        class="icon"
                        [attr.aria-label]="'Edit ' + (character.name || 'this character')"
                        matTooltip="Open this character in the Story sheet"
                        (click)="edit(character.id)"
                      >
                        ✎
                      </button>
                    </div>
                  } @empty {
                    <p class="ms-hint">
                      No characters yet. Without them the model plays whoever the scene needs.
                    </p>
                  }
                  <button type="button" class="add" (click)="add()">Add a character</button>
                </div>
              }
            </section>
          }
        </div>
      </aside>
    } @else {
      <button
        type="button"
        class="handle"
        aria-label="Open the chapter panel"
        matTooltip="The scene, the narrator, your persona and the cast (Ctrl+.)"
        (click)="setOpen(true)"
      >
        <span class="mark">‹</span>
        <span class="edge">This chapter</span>
      </button>
    }
  `,
  styles: `
    /* The host is the thin edge — and it stays the thin edge in the covering
       layout too, where the panel is lifted out of the flow and the page keeps
       every pixel it had. */
    :host {
      flex: none;
      display: block;
      width: 1.9rem;
      height: 100%;
      min-height: 0;
    }

    :host(.open) {
      width: min(21rem, 40vw);
    }

    :host(.open.overlay) {
      width: 1.9rem;
    }

    .handle {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      width: 100%;
      height: 100%;
      padding: 0.7rem 0;
      border: 0;
      border-left: 1px solid var(--ms-border);
      background: color-mix(in srgb, var(--ms-surface) 55%, transparent);
      color: var(--ms-muted);
      font: inherit;
      cursor: pointer;
    }

    .handle:hover {
      color: var(--ms-ink-soft);
      background: color-mix(in srgb, var(--ms-surface) 90%, transparent);
    }

    .edge {
      writing-mode: vertical-rl;
      font-size: 0.72rem;
      letter-spacing: 0.06em;
    }

    .scrim {
      position: absolute;
      inset: 0;
      z-index: 1;
      background: light-dark(rgb(30 26 20 / 24%), rgb(6 7 10 / 46%));
    }

    .panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      border-left: 1px solid var(--ms-border);
      background: var(--ms-surface);
    }

    /* Over the page rather than beside it. The composer keeps a z-index of its
       own and stays above the scrim, so the chapter can still be written into
       with the panel open. */
    :host(.overlay) .panel {
      position: absolute;
      inset-block: 0;
      right: 0;
      z-index: 3;
      width: min(21rem, 88vw);
      box-shadow: -18px 0 48px light-dark(rgb(0 0 0 / 12%), rgb(0 0 0 / 45%));
    }

    .top {
      flex: none;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.4rem 0.5rem 0.85rem;
      border-bottom: 1px solid var(--ms-border);
    }

    .what {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      font-family: var(--ms-serif);
      font-size: 0.95rem;
      color: var(--ms-ink);
    }

    .scroll {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 0.2rem 0 1.5rem;
    }

    .block {
      border-bottom: 1px solid color-mix(in srgb, var(--ms-border) 70%, transparent);
    }

    .head {
      display: flex;
      align-items: baseline;
      gap: 0.45rem;
      width: 100%;
      padding: 0.6rem 0.85rem;
      border: 0;
      background: none;
      color: var(--ms-ink);
      font: inherit;
      font-size: 0.82rem;
      text-align: left;
      cursor: pointer;
    }

    .head:hover {
      background: color-mix(in srgb, var(--ms-accent) 7%, transparent);
    }

    .mark {
      flex: none;
      color: var(--ms-muted);
      font-size: 0.7rem;
    }

    .head .name {
      flex: none;
      letter-spacing: 0.02em;
    }

    /* What the section says with nothing unfolded. */
    .aside {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      text-align: right;
      color: var(--ms-muted);
      font-size: 0.74rem;
    }

    .body {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0 0.85rem 0.9rem;
    }

    .line-field {
      width: 100%;
      padding: 0.45rem 0.6rem;
      border: 1px solid var(--ms-border);
      border-radius: 8px;
      background: var(--ms-surface-raised);
      color: var(--ms-ink);
      font: inherit;
      font-size: 0.9rem;
    }

    .line-field:focus {
      outline: none;
      border-color: color-mix(in srgb, var(--ms-accent) 65%, var(--ms-border));
    }

    .link,
    .add {
      align-self: flex-start;
      padding: 0;
      border: 0;
      background: none;
      color: var(--ms-accent);
      font: inherit;
      font-size: 0.78rem;
      cursor: pointer;
    }

    .link:hover,
    .add:hover {
      text-decoration: underline;
    }

    .add {
      margin-top: 0.15rem;
    }

    .cast-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0.4rem;
      border: 1px solid transparent;
      border-radius: 9px;
    }

    .cast-row:hover {
      border-color: var(--ms-border);
      background: var(--ms-surface-raised);
    }

    /* In the cast but not in the story: the sheet's own switch is off. */
    .cast-row.off {
      opacity: 0.5;
    }

    .swatch {
      flex: none;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--ms-muted);
    }

    .who {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }

    .cast-name {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      font-size: 0.85rem;
      color: var(--ms-ink);
    }

    .cast-line {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      font-size: 0.74rem;
      color: var(--ms-muted);
    }

    .icon {
      flex: none;
      width: 1.6rem;
      height: 1.6rem;
      border: 0;
      border-radius: 50%;
      background: none;
      color: var(--ms-muted);
      font: inherit;
      font-size: 0.9rem;
      line-height: 1;
      cursor: pointer;
    }

    .icon:hover {
      color: var(--ms-ink);
      background: color-mix(in srgb, var(--ms-accent) 14%, transparent);
    }
  `,
  host: {
    '[class.open]': 'open()',
    '[class.overlay]': 'overlay()',
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class ChapterPanel {
  protected readonly chapters = inject(ChapterStore);
  protected readonly stories = inject(StoryStore);
  protected readonly story = this.stories.story;
  private readonly settings = inject(SettingsStore);
  private readonly dialogs = inject(DialogsService);
  private readonly dialog = inject(MatDialog);

  protected readonly open = computed(() => this.settings.ui().sidebarOpen);

  private readonly wide = signal(true);
  /** No room left to push the page aside, so it goes over it instead. */
  protected readonly overlay = computed(() => !this.wide());

  protected readonly narratorText = computed(() => {
    const narrator = this.story().narrator;
    return narrator.useDefault ? DEFAULT_NARRATOR_PROMPT : narrator.prompt;
  });

  protected readonly sceneLabel = computed(() =>
    this.chapters.isClosed() ? 'closed' : firstLine(this.chapters.chapter().scene, 34),
  );

  protected readonly sceneHint = computed(() =>
    this.chapters.isClosed()
      ? 'This chapter is closed; its scene is what it was written on.'
      : 'Sent with every request of this chapter.',
  );

  protected readonly castLabel = computed(() => {
    const count = this.story().characters.length;
    return count === 1 ? '1 character' : `${count} characters`;
  });

  constructor() {
    const query = matchMedia(`(min-width: ${PANEL_PUSH_WIDTH}px)`);
    const listen = () => this.wide.set(query.matches);
    listen();
    query.addEventListener('change', listen);
    inject(DestroyRef).onDestroy(() => query.removeEventListener('change', listen));
  }

  protected isOpen(section: PanelSection): boolean {
    return this.settings.ui().sidebarSections[section] !== false;
  }

  protected toggleSection(section: PanelSection): void {
    this.settings.setPanelSection(section, !this.isOpen(section));
  }

  protected setOpen(open: boolean): void {
    this.settings.setSidebarOpen(open);
  }

  protected close(): void {
    this.setOpen(false);
  }

  /**
   * Escape belongs to whatever is on top of everything else. A sheet is over
   * the panel, so it answers first; and a panel that is pushing the page is
   * part of the page, with nothing to dismiss.
   */
  protected onEscape(): void {
    if (this.dialog.openDialogs.length) return;
    if (this.open() && this.overlay()) this.close();
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected describe(description: string): string {
    return firstLine(description, 60) || 'No description yet';
  }

  protected setScene(scene: string): void {
    this.chapters.update(this.chapters.chapter().id, { scene });
  }

  /** Writing over the default is what adopts it; the text is kept as written. */
  protected setNarrator(prompt: string): void {
    this.stories.patch({ narrator: { useDefault: false, prompt } });
  }

  /** The custom text stays in the document, so switching back finds it again. */
  protected backToDefault(): void {
    this.stories.patch({ narrator: { ...this.story().narrator, useDefault: true } });
  }

  protected setPersona(patch: Partial<{ name: string; description: string }>): void {
    this.stories.patch({ persona: { ...this.story().persona, ...patch } });
  }

  protected edit(characterId: string): void {
    void this.dialogs.openStory(characterId);
  }

  /** A blank row says nothing, so the sheet opens on it with the name waiting. */
  protected add(): void {
    const character = this.stories.addCharacter();
    void this.dialogs.openStory(character.id);
  }
}
