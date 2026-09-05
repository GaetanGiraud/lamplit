import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DEFAULT_NARRATOR_PROMPT } from '../../core/defaults';
import { characterColour } from '../../core/character-colours';
import { Character, PanelSection } from '../../core/models';
import { firstLine, isOneAtATime } from '../../core/prompt-builder';
import { DialogsService } from '../../shared/dialogs.service';
import { CharacterSwatch } from '../../shared/character-swatch';
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
  selector: 'li-chapter-panel',
  imports: [MatTooltipModule, CharacterSwatch, EditorField, TextValue],
  template: `
    @if (open()) {
      <!-- Only when it is covering the page: something has to say the page is
           behind it, and be the click that gives the page back. -->
      @if (overlay()) {
        <div class="scrim" aria-hidden="true" (click)="close()"></div>
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
                <li-editor-field
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
                  <li-editor-field
                    ariaLabel="Narrator instructions"
                    [rows]="7"
                    [value]="narratorText()"
                    [dimmed]="story().narrator.useDefault"
                    (save)="setNarrator($event)"
                  />
                  @if (story().narrator.useDefault) {
                    <p class="li-hint">
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
                  [liText]="story().persona.name"
                  (change)="setPersona({ name: value($event) })"
                />
                <li-editor-field
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
                    <div
                      class="cast-row"
                      [class.off]="!character.enabled"
                      [class.playing]="isPlaying(character.id)"
                      [style.--li-cast-colour]="colourOf(character)"
                    >
                      <li-character-swatch
                        [character]="character"
                        (pick)="stories.setCharacterColour(character.id, $event)"
                      />

                      <!-- Playing one at a time, the row is the switch: click
                           it and the model is that character from here on. -->
                      @if (switching()) {
                        <button
                          type="button"
                          class="who"
                          [disabled]="!character.enabled || isPlaying(character.id)"
                          [attr.aria-label]="'Play ' + (character.name || 'this character')"
                          [matTooltip]="playTooltip(character.enabled)"
                          (click)="play(character.id)"
                        >
                          <span class="cast-name">
                            {{ character.name || 'Unnamed' }}
                            @if (isPlaying(character.id)) {
                              <span class="tag">playing</span>
                            }
                          </span>
                          <span class="cast-line">{{ describe(character.description) }}</span>
                        </button>
                      } @else {
                        <span class="who">
                          <span class="cast-name">{{ character.name || 'Unnamed' }}</span>
                          <span class="cast-line">{{ describe(character.description) }}</span>
                        </span>
                      }

                      <button
                        type="button"
                        class="in-scene"
                        role="switch"
                        [attr.aria-checked]="character.enabled"
                        [attr.aria-label]="
                          (character.name || 'This character') + ' is in the scene'
                        "
                        [matTooltip]="
                          character.enabled ? 'In the scene — take them out' : 'Bring them in'
                        "
                        (click)="setInScene(character.id, !character.enabled)"
                      >
                        <span class="knob"></span>
                      </button>

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
                    <p class="li-hint">
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
      border-left: 1px solid var(--li-border);
      background: color-mix(in srgb, var(--li-surface) 55%, transparent);
      color: var(--li-muted);
      font: inherit;
      cursor: pointer;
    }

    .handle:hover {
      color: var(--li-ink-soft);
      background: color-mix(in srgb, var(--li-surface) 90%, transparent);
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
      border-left: 1px solid var(--li-border);
      background: var(--li-surface);
    }

    /* Over the page rather than beside it, with the scrim between: at this
       width the panel is the thing being used, and the page under it — the
       composer at the end of it included — waits until the scrim is clicked. */
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
      border-bottom: 1px solid var(--li-border);
    }

    .what {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      font-family: var(--li-serif);
      font-size: 0.95rem;
      color: var(--li-ink);
    }

    .scroll {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 0.2rem 0 1.5rem;
    }

    .block {
      border-bottom: 1px solid color-mix(in srgb, var(--li-border) 70%, transparent);
    }

    .head {
      display: flex;
      align-items: baseline;
      gap: 0.45rem;
      width: 100%;
      padding: 0.6rem 0.85rem;
      border: 0;
      background: none;
      color: var(--li-ink);
      font: inherit;
      font-size: 0.82rem;
      text-align: left;
      cursor: pointer;
    }

    .head:hover {
      background: color-mix(in srgb, var(--li-accent) 7%, transparent);
    }

    .mark {
      flex: none;
      color: var(--li-muted);
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
      color: var(--li-muted);
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
      border: 1px solid var(--li-border);
      border-radius: 8px;
      background: var(--li-surface-raised);
      color: var(--li-ink);
      font: inherit;
      font-size: 0.9rem;
    }

    .line-field:focus {
      outline: none;
      border-color: color-mix(in srgb, var(--li-accent) 65%, var(--li-border));
    }

    .link,
    .add {
      align-self: flex-start;
      padding: 0;
      border: 0;
      background: none;
      color: var(--li-accent);
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
      border-color: var(--li-border);
      background: var(--li-surface-raised);
    }

    /* In the cast but out of the scene. Still listed, because it is a door
       back in rather than a deletion. */
    .cast-row.off .who {
      opacity: 0.45;
    }

    /* Who the model is being, when it is being one of them — in their own
       colour, so the row and the dot on it are saying the same thing. */
    .cast-row.playing {
      border-color: color-mix(in srgb, var(--li-cast-colour) 45%, var(--li-border));
      background: color-mix(in srgb, var(--li-cast-colour) 14%, transparent);
    }

    .tag {
      margin-left: 0.35rem;
      padding: 0 0.3rem;
      border-radius: 999px;
      background: color-mix(in srgb, var(--li-cast-colour) 24%, transparent);
      color: var(--li-cast-colour);
      font-size: 0.6rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      vertical-align: 1px;
    }

    /* A switch small enough to live on a row: track, knob, nothing written. */
    .in-scene {
      flex: none;
      width: 1.55rem;
      height: 0.85rem;
      padding: 0;
      border: 1px solid var(--li-border);
      border-radius: 999px;
      background: var(--li-surface);
      cursor: pointer;
    }

    .in-scene[aria-checked='true'] {
      border-color: color-mix(in srgb, var(--li-accent) 55%, var(--li-border));
      background: color-mix(in srgb, var(--li-accent) 30%, transparent);
    }

    .knob {
      display: block;
      width: 0.5rem;
      height: 0.5rem;
      margin-left: 0.1rem;
      border-radius: 50%;
      background: var(--li-muted);
      transition: transform 120ms ease;
    }

    .in-scene[aria-checked='true'] .knob {
      transform: translateX(0.62rem);
      background: var(--li-accent);
    }

    .who {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      padding: 0;
      border: 0;
      background: none;
      font: inherit;
      text-align: left;
    }

    button.who:not(:disabled) {
      cursor: pointer;
    }

    .cast-name {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      font-size: 0.85rem;
      color: var(--li-ink);
    }

    .cast-line {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      font-size: 0.74rem;
      color: var(--li-muted);
    }

    .icon {
      flex: none;
      width: 1.6rem;
      height: 1.6rem;
      border: 0;
      border-radius: 50%;
      background: none;
      color: var(--li-muted);
      font: inherit;
      font-size: 0.9rem;
      line-height: 1;
      cursor: pointer;
    }

    .icon:hover {
      color: var(--li-ink);
      background: color-mix(in srgb, var(--li-accent) 14%, transparent);
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

  /** Whether a row is a switch: only one casting has anything to switch. */
  protected readonly switching = computed(() => isOneAtATime(this.story()));

  protected readonly castLabel = computed(() => {
    const playing = this.chapters.playing();
    if (playing) return `playing ${playing.name.trim() || 'Unnamed'}`;
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
   * the panel, so it answers first; a menu opened from inside the panel — a
   * character's colours — is over it too, and closing the menu is the whole
   * of what the key meant. A panel that is pushing the page rather than
   * covering it is part of the page, with nothing to dismiss.
   *
   * Nothing keeps a register of open menus, the way the dialogs service can be
   * asked what is open over the page, so the overlay container is looked at
   * directly. What cannot be asked is whether the event was handled: the prose
   * editor marks Escape handled whenever it has the focus, which is most of
   * the time.
   */
  protected onEscape(): void {
    if (this.dialogs.anyOpen()) return;
    if (document.querySelector('.cdk-overlay-container .mat-mdc-menu-panel')) return;
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

  protected colourOf(character: Character): string {
    return characterColour(character, this.settings.ui().theme);
  }

  protected isPlaying(characterId: string): boolean {
    return this.chapters.playing()?.id === characterId;
  }

  protected playTooltip(enabled: boolean): string {
    return enabled
      ? 'Play this character from here on'
      : 'Bring them into the scene before playing them';
  }

  protected play(characterId: string): void {
    this.chapters.setActiveCharacter(characterId);
  }

  protected setInScene(characterId: string, inScene: boolean): void {
    this.chapters.setCharacterEnabled(characterId, inScene);
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
