import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/**
 * The width the phone layout starts at, and the touch question beside it.
 *
 * Most of the answer is CSS and belongs there — `breakpoints.scss` has the
 * mixins, and a rule that only changes how something looks should use them and
 * never come here. This is for the two things a media query cannot do: decide
 * which items a menu is built out of, and decide what a key means.
 *
 * The width is read off `<html>` rather than written down again, because
 * `styles.scss` publishes `--li-phone-width` from the one Sass variable the
 * mixins use. Two numbers that had to agree would eventually not.
 */
@Injectable({ providedIn: 'root' })
export class Layout {
  /** The phone layout: not enough room for the bar, the panel and a modal. */
  readonly phone = this.watch(`(max-width: ${phoneWidth()})`);

  /**
   * A finger rather than a pointer, which is a different question: a narrow
   * window on a laptop is the phone layout with a keyboard still attached.
   */
  readonly coarse = this.watch('(pointer: coarse)');

  private watch(query: string) {
    const media = matchMedia(query);
    const matches = signal(media.matches);
    const listen = () => matches.set(media.matches);
    media.addEventListener('change', listen);
    inject(DestroyRef).onDestroy(() => media.removeEventListener('change', listen));
    return matches.asReadonly();
  }
}

/**
 * `48rem`, from the stylesheet. The fallback is for a test running without
 * one — jsdom resolves no custom properties — and is the same number written
 * in `breakpoints.scss`, which is the only place it is ever changed.
 */
function phoneWidth(): string {
  const declared = getComputedStyle(document.documentElement)
    .getPropertyValue('--li-phone-width')
    .trim();
  return declared || '48rem';
}
