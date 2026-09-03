import { Component, inject, signal } from '@angular/core';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { StoryMode } from '../../core/models';
import { TextValue } from '../../shared/text-value';

export interface StorySetup {
  title: string;
  mode: StoryMode;
  persona: { name: string; description: string };
}

export interface NewStoryData extends StorySetup {
  /** First run seeds this sheet from the story the app made on its own. */
  heading: string;
  confirm: string;
}

/**
 * The three things worth deciding before the first scene: what the story is
 * called, who is telling it, and who the reader plays. They shape every
 * request, so they come first — and every one of them can be changed later in
 * Story, which is why nothing here is required.
 */
@Component({
  selector: 'ms-new-story-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    TextFieldModule,
    TextValue,
  ],
  template: `
    <h2 mat-dialog-title class="ms-dialog-title">{{ data.heading }}</h2>

    <mat-dialog-content>
      <mat-form-field appearance="outline">
        <mat-label>Title</mat-label>
        <input
          matInput
          cdkFocusInitial
          [value]="title()"
          (input)="title.set(text($event))"
          placeholder="Untitled story"
        />
      </mat-form-field>

      <span class="label">Who tells it</span>
      <div class="ms-choices">
        <button
          type="button"
          class="ms-choice"
          [class.on]="mode() === 'narrator'"
          (click)="mode.set('narrator')"
        >
          <span class="name">Narrator</span>
          <span class="ms-hint">
            One voice tells the whole story. You say what you do; it writes what happens.
          </span>
        </button>
        <button
          type="button"
          class="ms-choice"
          [class.on]="mode() === 'roleplay'"
          (click)="mode.set('roleplay')"
        >
          <span class="name">Role-play</span>
          <span class="ms-hint">
            The model plays the other characters and answers in their own words.
          </span>
        </button>
      </div>

      <span class="label">Who you play</span>
      <mat-form-field appearance="outline">
        <mat-label>Name</mat-label>
        <input matInput [value]="name()" (input)="name.set(text($event))" placeholder="Mara" />
      </mat-form-field>

      <textarea
        cdkTextareaAutosize
        cdkAutosizeMinRows="3"
        cdkAutosizeMaxRows="12"
        [msText]="description()"
        (input)="description.set(text($event))"
        placeholder="A marine biologist, thirty-one, back on the island after nine years."
      ></textarea>

      <p class="ms-hint">
        All of it can be changed later in Story, and in Role-play you add the cast there too. Next
        comes the scene the first chapter opens on.
      </p>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton mat-dialog-close>Cancel</button>
      <button matButton="filled" (click)="confirm()">{{ data.confirm }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      padding-top: 0.5rem !important;
    }

    /* A scrolling column, not a squashing one: without this the children are
       shrunk to fit instead of the content scrolling, and an autosizing
       textarea is drawn shorter than the height it asked for. */
    mat-dialog-content > * {
      flex: none;
    }

    mat-form-field {
      width: 100%;
    }

    .label {
      margin-top: 0.35rem;
      font-size: 0.82rem;
      color: var(--ms-ink);
    }

    textarea {
      width: 100%;
      padding: 0.6rem 0.75rem;
      border: 1px solid var(--ms-border);
      border-radius: 10px;
      background: var(--ms-surface-raised);
      color: var(--ms-ink);
      font: inherit;
      font-size: 0.9rem;
      line-height: 1.55;
      resize: none;
    }

    textarea:focus {
      outline: none;
      border-color: color-mix(in srgb, var(--ms-accent) 65%, var(--ms-border));
    }
  `,
})
export class NewStoryDialog {
  protected readonly data = inject<NewStoryData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<NewStoryDialog, StorySetup | undefined>);

  protected readonly title = signal(this.data.title);
  protected readonly mode = signal<StoryMode>(this.data.mode);
  protected readonly name = signal(this.data.persona.name);
  protected readonly description = signal(this.data.persona.description);

  protected text(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  /** Cancel and Escape both mean "not this way": nothing is created, or kept. */
  protected confirm(): void {
    this.ref.close({
      title: this.title().trim(),
      mode: this.mode(),
      persona: { name: this.name().trim(), description: this.description().trim() },
    });
  }
}
