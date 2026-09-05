import { Page, expect } from '@playwright/test';

/**
 * A voice that can be inspected and does not talk.
 *
 * `speechSynthesis` is real in the browser Playwright drives, but headless it
 * has no voices, says nothing, and — worse for a test — fires no `end`, so a
 * reading started in a spec would never finish. What matters here is not that
 * a machine makes a noise: it is which words were handed over, in which voice,
 * at what speed, and when the app decided to stop. So the platform is replaced
 * with something that records exactly that and speaks only when the spec says
 * to, which is also the only way to catch the app mid-reading.
 *
 * Installed before the app's own scripts, because the service asks whether
 * speech exists the moment it is built.
 */
export async function fakeVoices(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface Spoken {
      text: string;
      voice: string;
      rate: number;
    }
    const spoken: Spoken[] = [];
    let pending: { onend?: () => void } | null = null;
    let cancelled = 0;

    const voices = [
      { name: 'Test Reader', lang: 'en-GB' },
      { name: 'Autre Voix', lang: 'fr-FR' },
    ];

    class Utterance {
      text: string;
      voice: { name: string } | null = null;
      rate = 1;
      onend?: () => void;
      onerror?: () => void;
      constructor(text: string) {
        this.text = text;
      }
    }

    const synth = {
      getVoices: () => voices,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      speak(utterance: Utterance) {
        spoken.push({
          text: utterance.text,
          voice: utterance.voice?.name ?? '',
          rate: utterance.rate,
        });
        pending = utterance;
      },
      cancel() {
        cancelled++;
        pending = null;
      },
    };

    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: Utterance,
      configurable: true,
    });

    // What the spec talks to: the record, and the two verbs it needs.
    Object.defineProperty(window, 'testSpeech', {
      configurable: true,
      value: {
        spoken: () => spoken,
        cancelled: () => cancelled,
        clear: () => {
          spoken.length = 0;
          cancelled = 0;
        },
        /** Finishes everything queued, the way a voice that has read it would. */
        finish: () => {
          // The app queues one piece at a time and asks for the next when the
          // last one ends, so this walks the whole message. The cap is only so
          // that a bug cannot hang the spec.
          for (let i = 0; i < 200 && pending; i++) {
            const ending = pending;
            pending = null;
            ending.onend?.();
          }
        },
      },
    });
  });
}

/** Everything handed to the voice since the last `clearSpeech`. */
export function spoken(page: Page): Promise<{ text: string; voice: string; rate: number }[]> {
  return page.evaluate(() => window.testSpeech.spoken());
}

/** The whole of what was said, as one string. */
export async function spokenText(page: Page): Promise<string> {
  return (await spoken(page)).map((piece) => piece.text).join(' ');
}

export function clearSpeech(page: Page): Promise<void> {
  return page.evaluate(() => window.testSpeech.clear());
}

/** Lets the voice reach the end of what it was given. */
export function finishSpeaking(page: Page): Promise<void> {
  return page.evaluate(() => window.testSpeech.finish());
}

/** Waits until something has been handed to the voice, and returns all of it. */
export async function waitForSpeech(page: Page): Promise<string> {
  await expect.poll(() => spoken(page).then((pieces) => pieces.length)).toBeGreaterThan(0);
  return spokenText(page);
}

declare global {
  interface Window {
    testSpeech: {
      spoken: () => { text: string; voice: string; rate: number }[];
      cancelled: () => number;
      clear: () => void;
      finish: () => void;
    };
  }
}
