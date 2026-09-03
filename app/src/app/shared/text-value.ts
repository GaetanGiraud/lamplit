import { Directive, ElementRef, effect, inject, input } from '@angular/core';
import { CdkTextareaAutosize } from '@angular/cdk/text-field';

type TextElement = HTMLTextAreaElement | HTMLInputElement;

/**
 * Puts text into a box without taking it away from whoever is typing.
 *
 * `[value]` writes the bound string into the DOM node whenever it changes,
 * and a write to `.value` moves the caret to the end and throws away the
 * browser's own undo stack. Most of the time the string is the one the box
 * already holds, so nothing is felt — but every field here is bound to a
 * signal that other code can change (a document loading, a summary streaming,
 * an autosave coming back), and when that lands mid-sentence the cursor
 * jumps.
 *
 * So: write only what the box does not already say, and never while it is
 * being written into — unless it is read-only, where nobody is typing and the
 * text is arriving from the model.
 *
 * Whoever writes the value is also the one who knows it changed, so this is
 * where an autosizing box gets re-measured: the CDK only listens for typing,
 * and text that arrives from code would otherwise leave the box a chunk short.
 */
@Directive({ selector: 'textarea[msText], input[msText]' })
export class TextValue {
  readonly msText = input('');

  private readonly element = inject<ElementRef<TextElement>>(ElementRef);
  private readonly autosize = inject(CdkTextareaAutosize, { optional: true, self: true });

  constructor() {
    effect(() => {
      const value = this.msText();
      const node = this.element.nativeElement;
      if (node.value === value) return;
      if (node === document.activeElement && !node.readOnly) return;
      node.value = value;
      this.autosize?.resizeToFitContent();
    });
  }
}
