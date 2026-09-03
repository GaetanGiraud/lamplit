import {
  Component,
  DestroyRef,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TextValue } from './text-value';

/**
 * A block of text that belongs to a document. The save mark appears only once
 * the text differs from what is stored; clicking it commits, and so does
 * leaving the field or closing the modal — Escape and backdrop save, never
 * discard.
 */
@Component({
  selector: 'ms-editor-field',
  imports: [MatTooltipModule, TextFieldModule, TextValue],
  template: `
    <label class="field">
      <span class="head">
        <span class="label">{{ label() }}</span>
        @if (dirty()) {
          <button
            type="button"
            class="save"
            (click)="commit()"
            matTooltip="Save this text (leaving the field saves too)"
          >
            ✓ Save
          </button>
        }
      </span>

      <textarea
        [class.serif]="serif()"
        cdkTextareaAutosize
        [cdkAutosizeMinRows]="rows()"
        [cdkAutosizeMaxRows]="rows() + 10"
        [msText]="draft()"
        [placeholder]="placeholder()"
        (input)="draft.set(text($event))"
        (blur)="commit()"
      ></textarea>

      <span class="foot">
        @if (hint()) {
          <span class="ms-hint">{{ hint() }}</span>
        }
        <span class="ms-hint count">{{ words() }} words</span>
      </span>
    </label>
  `,
  styles: `
    .field {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }

    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      min-height: 1.4rem;
    }

    .label {
      font-size: 0.82rem;
      color: var(--ms-ink);
    }

    .save {
      border: 1px solid color-mix(in srgb, var(--ms-accent) 45%, var(--ms-border));
      border-radius: 999px;
      background: color-mix(in srgb, var(--ms-accent) 12%, transparent);
      color: var(--ms-accent);
      font: inherit;
      font-size: 0.72rem;
      padding: 0.05rem 0.55rem;
      cursor: pointer;
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

    textarea.serif {
      font-family: var(--ms-serif);
      font-size: 1rem;
    }

    textarea:focus {
      outline: none;
      border-color: color-mix(in srgb, var(--ms-accent) 65%, var(--ms-border));
    }

    .foot {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
    }

    .count {
      flex: none;
      margin-left: auto;
    }
  `,
})
export class EditorField {
  readonly label = input('');
  readonly value = input('');
  readonly placeholder = input('');
  readonly hint = input('');
  readonly rows = input(4);
  readonly serif = input(false, { transform: booleanAttribute });

  readonly save = output<string>();

  protected readonly draft = signal('');

  protected readonly dirty = computed(() => this.draft() !== this.value());
  protected readonly words = computed(() => countWords(this.draft()));

  constructor() {
    // The document is the source of truth; an outside edit replaces the draft,
    // and [msText] measures the box when it lands.
    effect(() => this.draft.set(this.value()));
    inject(DestroyRef).onDestroy(() => this.commit());
  }

  protected text(event: Event): string {
    return (event.target as HTMLTextAreaElement).value;
  }

  protected commit(): void {
    if (this.dirty()) this.save.emit(this.draft());
  }
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
