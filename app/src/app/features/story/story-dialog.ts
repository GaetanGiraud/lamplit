import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { DEFAULT_NARRATOR_PROMPT } from '../../core/defaults';
import { ReplyLength, StoryMode } from '../../core/models';
import { StoryStore } from '../../store/story-store';
import { EditorField } from '../../shared/editor-field';

/** Who is telling the story, who the reader is, and how it should read. */
@Component({
  selector: 'ms-story-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSlideToggleModule,
    MatTabsModule,
    EditorField,
  ],
  template: `
    <h2 mat-dialog-title class="ms-dialog-title">{{ story().title }}</h2>

    <mat-dialog-content>
      <mat-tab-group>
        <mat-tab label="Mode">
          <div class="tab">
            <div class="ms-choices">
              <button
                type="button"
                class="ms-choice"
                [class.on]="story().mode === 'narrator'"
                (click)="setMode('narrator')"
              >
                <span class="name">Narrator</span>
                <span class="ms-hint">
                  One voice tells the whole story. You say what you do; it writes what happens.
                </span>
              </button>
              <button
                type="button"
                class="ms-choice"
                [class.on]="story().mode === 'roleplay'"
                (click)="setMode('roleplay')"
              >
                <span class="name">Role-play</span>
                <span class="ms-hint">
                  The model plays the other characters and answers in their own words.
                </span>
              </button>
            </div>

            @if (story().mode === 'narrator') {
              <mat-slide-toggle
                [checked]="!story().narrator.useDefault"
                (change)="setOverride($event.checked)"
              >
                Write my own narrator instructions
              </mat-slide-toggle>

              @if (story().narrator.useDefault) {
                <p class="preset">{{ defaultPrompt }}</p>
              } @else {
                <ms-editor-field
                  label="Narrator instructions"
                  [rows]="7"
                  [value]="story().narrator.prompt"
                  (save)="setNarratorPrompt($event)"
                />
              }
            } @else {
              <div class="cast">
                @for (character of story().characters; track character.id) {
                  <section class="character">
                    <header>
                      <mat-form-field appearance="outline" class="name-field">
                        <mat-label>Name</mat-label>
                        <input
                          matInput
                          [value]="character.name"
                          (change)="stories.patchCharacter(character.id, { name: value($event) })"
                        />
                      </mat-form-field>
                      <mat-slide-toggle
                        [checked]="character.enabled"
                        (change)="stories.patchCharacter(character.id, { enabled: $event.checked })"
                      >
                        In the story
                      </mat-slide-toggle>
                      <button matButton (click)="stories.removeCharacter(character.id)">
                        Remove
                      </button>
                    </header>
                    <ms-editor-field
                      label="Who they are"
                      [rows]="4"
                      [value]="character.description"
                      placeholder="How they speak, what they want, what they will not do."
                      (save)="stories.patchCharacter(character.id, { description: $event })"
                    />
                  </section>
                }
                @if (!story().characters.length) {
                  <p class="ms-hint">
                    No characters yet. Without them the model plays whoever the scene needs.
                  </p>
                }
                <button matButton="outlined" (click)="stories.addCharacter()">
                  Add a character
                </button>
              </div>
            }
          </div>
        </mat-tab>

        <mat-tab label="Persona">
          <div class="tab">
            <p class="ms-hint">Who the reader is in this story. Always sent, in both modes.</p>
            <mat-form-field appearance="outline">
              <mat-label>Name</mat-label>
              <input
                matInput
                [value]="story().persona.name"
                (change)="setPersona({ name: value($event) })"
              />
            </mat-form-field>
            <ms-editor-field
              label="Description"
              [rows]="6"
              [value]="story().persona.description"
              placeholder="Mara, a marine biologist, thirty-one, back on the island after nine years."
              (save)="setPersona({ description: $event })"
            />
          </div>
        </mat-tab>

        <mat-tab label="Style">
          <div class="tab">
            <mat-slide-toggle
              [checked]="story().style.dialogueOnOwnLine"
              (change)="setStyle({ dialogueOnOwnLine: $event.checked })"
            >
              Ask for each spoken line on its own paragraph
            </mat-slide-toggle>

            <div class="lengths">
              <span class="ms-hint">Reply length</span>
              @for (option of lengths; track option.value) {
                <button
                  type="button"
                  class="length"
                  [class.on]="story().style.replyLength === option.value"
                  (click)="setStyle({ replyLength: option.value })"
                >
                  {{ option.label }}
                </button>
              }
            </div>

            <p class="ms-hint">
              Both become a sentence in the style rules the model is sent. The reading settings in
              the Reading menu only change how answers are drawn here.
            </p>
          </div>
        </mat-tab>
      </mat-tab-group>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton="filled" mat-dialog-close>Done</button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content {
      max-height: min(74vh, 44rem) !important;
      padding-top: 0 !important;
    }

    .tab {
      display: flex;
      flex-direction: column;
      gap: 0.9rem;
      padding: 1rem 0.15rem 0.35rem;
    }

    .tab > * {
      flex: none;
    }

    .preset {
      margin: 0;
      padding: 0.7rem 0.85rem;
      border: 1px dashed var(--ms-border);
      border-radius: 10px;
      font-family: var(--ms-serif);
      font-size: 0.92rem;
      line-height: 1.6;
      color: var(--ms-ink-soft);
    }

    .cast {
      display: flex;
      flex-direction: column;
      gap: 0.8rem;
    }

    .character {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      padding: 0.7rem 0.8rem;
      border: 1px solid var(--ms-border);
      border-radius: 12px;
    }

    .character header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .name-field {
      flex: 1;
      margin-bottom: -1.25em;
    }

    mat-form-field {
      width: 100%;
    }

    .lengths {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }

    .lengths .ms-hint {
      margin-right: 0.4rem;
    }

    .length {
      padding: 0.25rem 0.8rem;
      border: 1px solid var(--ms-border);
      border-radius: 999px;
      background: var(--ms-surface-raised);
      color: var(--ms-ink-soft);
      font: inherit;
      font-size: 0.82rem;
      cursor: pointer;
    }

    .length.on {
      border-color: color-mix(in srgb, var(--ms-accent) 70%, var(--ms-border));
      background: color-mix(in srgb, var(--ms-accent) 12%, transparent);
      color: var(--ms-ink);
    }
  `,
})
export class StoryDialog {
  protected readonly stories = inject(StoryStore);
  protected readonly story = this.stories.story;
  protected readonly defaultPrompt = DEFAULT_NARRATOR_PROMPT;

  protected readonly lengths: { value: ReplyLength; label: string }[] = [
    { value: 'short', label: 'Short' },
    { value: 'medium', label: 'Medium' },
    { value: 'long', label: 'Long' },
  ];

  protected readonly persona = computed(() => this.story().persona);

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected setMode(mode: StoryMode): void {
    this.stories.patch({ mode });
  }

  protected setOverride(override: boolean): void {
    const narrator = this.story().narrator;
    this.stories.patch({
      narrator: {
        useDefault: !override,
        // Starting from the default beats starting from an empty box.
        prompt: narrator.prompt || (override ? DEFAULT_NARRATOR_PROMPT : ''),
      },
    });
  }

  protected setNarratorPrompt(prompt: string): void {
    this.stories.patch({ narrator: { ...this.story().narrator, prompt } });
  }

  protected setPersona(patch: Partial<{ name: string; description: string }>): void {
    this.stories.patch({ persona: { ...this.story().persona, ...patch } });
  }

  protected setStyle(
    patch: Partial<{ dialogueOnOwnLine: boolean; replyLength: ReplyLength }>,
  ): void {
    this.stories.patch({ style: { ...this.story().style, ...patch } });
  }
}
