import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { TextValue } from './text-value';

/**
 * The directive exists for one moment: a signal changing under a box somebody
 * is typing into. Writing to `.value` there would move their caret to the end
 * and throw away their undo, so it does not — unless the box is read-only,
 * where nobody is typing and the text is arriving from the model, and a box
 * that never got the streamed answer is the worse fault of the two.
 */
@Component({
  imports: [TextValue],
  template: `
    <textarea aria-label="The direction" [liText]="stored()" [readOnly]="readOnly()"></textarea>
  `,
})
class Host {
  readonly stored = signal('The keeper went up.');
  readonly readOnly = signal(false);
}

describe('TextValue', () => {
  async function open(): Promise<{
    box: HTMLTextAreaElement;
    host: Host;
    settle: () => void;
  }> {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    fixture.detectChanges();
    const box = (fixture.nativeElement as HTMLElement).querySelector('textarea')!;
    return {
      box,
      host: fixture.componentInstance,
      settle: () => fixture.detectChanges(),
    };
  }

  it('writes the value into a box nobody is holding', async () => {
    const { box, host, settle } = await open();
    expect(box.value).toBe('The keeper went up.');

    host.stored.set('The keeper went up the stairs.');
    settle();

    expect(box.value).toBe('The keeper went up the stairs.');
  });

  it('leaves the box alone while it is being typed into', async () => {
    const { box, host, settle } = await open();
    box.focus();
    box.value = 'The keeper went up the st';

    host.stored.set('An autosave coming back mid-sentence.');
    settle();

    expect(box.value).toBe('The keeper went up the st');
  });

  it('writes into a focused box that is only being read', async () => {
    const { box, host, settle } = await open();
    host.readOnly.set(true);
    settle();
    box.focus();

    host.stored.set('A summary, arriving a word at a time.');
    settle();

    expect(box.value).toBe('A summary, arriving a word at a time.');
  });

  it('takes the next change once the caret has left', async () => {
    const { box, host, settle } = await open();
    box.focus();
    host.stored.set('Written while they were typing.');
    settle();
    expect(box.value).toBe('The keeper went up.');

    // Skipping a write is not refusing every write after it: the box is
    // caught up by whatever the document says next.
    box.blur();
    host.stored.set('Written while they were typing, and once more after.');
    settle();

    expect(box.value).toBe('Written while they were typing, and once more after.');
  });
});
