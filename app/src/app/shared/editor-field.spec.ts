import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { EditorField, countWords } from './editor-field';

/**
 * The field's whole promise is that leaving saves: the save mark, the blur,
 * and the sheet closing all mean the same thing, and Escape is safe because of
 * it. The last of those is the one nothing could see going wrong — Chrome
 * fires `blur` when a focused box is removed and so did the saving, by
 * accident, in the browser this was developed in.
 */
@Component({
  imports: [EditorField],
  template: `
    @if (shown()) {
      <ms-editor-field [value]="stored()" [readOnly]="readOnly()" (save)="saved.push($event)" />
    }
  `,
})
class Host {
  readonly shown = signal(true);
  readonly stored = signal('The lighthouse keeper, missing since spring.');
  readonly readOnly = signal(false);
  readonly saved: string[] = [];
}

type Fixture = ReturnType<typeof TestBed.createComponent<Host>>;

/** Types into the box the way a person does, without any focus involved. */
function type(fixture: Fixture, text: string): void {
  const host = fixture.nativeElement as HTMLElement;
  const box = host.querySelector('textarea')!;
  box.value = text;
  box.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

describe('EditorField', () => {
  async function open(): Promise<Fixture> {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('hands the draft to the document when it is taken off the page', async () => {
    const fixture = await open();
    type(fixture, 'Missing since the spring gales.');

    // The sheet closing, with no blur first: jsdom does not fire one on
    // removal, and neither does Firefox.
    fixture.componentInstance.shown.set(false);
    fixture.detectChanges();

    expect(fixture.componentInstance.saved).toEqual(['Missing since the spring gales.']);
  });

  it('says nothing when nothing was written', async () => {
    const fixture = await open();
    fixture.componentInstance.shown.set(false);
    fixture.detectChanges();

    expect(fixture.componentInstance.saved).toEqual([]);
  });

  it('never writes back a box that was only ever shown', async () => {
    const fixture = await open();
    fixture.componentInstance.readOnly.set(true);
    fixture.detectChanges();
    type(fixture, 'Typed into a closed chapter.');

    fixture.componentInstance.shown.set(false);
    fixture.detectChanges();

    expect(fixture.componentInstance.saved).toEqual([]);
  });
});

describe('countWords', () => {
  it('counts words, not spaces', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n  ')).toBe(0);
    expect(countWords('one')).toBe(1);
    expect(countWords(' two  words \n here ')).toBe(3);
  });
});
