import { Locator, Page, expect } from '@playwright/test';

/**
 * The few things that are reached differently on a phone.
 *
 * Everything else these specs need is in `../helpers` and is the same at any
 * width: seeding a story, writing into the composer, waiting for a turn. What
 * is here is only what the phone layout moved.
 */

/** The bar's one menu, which is where five of the six names went. */
export async function openMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
}

/**
 * The chapter panel, from that menu. There is no rail to press on a phone,
 * which is why `openPanel` in the shared helpers is the desktop's way in.
 */
export async function openPanelFromMenu(page: Page): Promise<void> {
  await openMenu(page);
  await page.getByRole('menuitem', { name: 'Chapter panel' }).click();
  await expect(page.getByRole('button', { name: 'Close the chapter panel' })).toBeVisible();
}

/**
 * A finger pulling the panel in from the right-hand side of the screen.
 *
 * Written as raw touch events rather than a drag of the mouse, because the
 * whole of what is under test is `touchstart`/`touchmove` — where the finger
 * landed and which way it went.
 */
export async function swipeInFromRightEdge(page: Page): Promise<void> {
  await page.evaluate(() => {
    const y = innerHeight / 2;
    const touch = (x: number) =>
      new Touch({ identifier: 1, target: document.body, clientX: x, clientY: y });
    const at = (type: string, x: number) =>
      document.body.dispatchEvent(
        new TouchEvent(type, { bubbles: true, touches: [touch(x)], cancelable: true }),
      );
    at('touchstart', innerWidth - 4);
    at('touchmove', innerWidth - 40);
    at('touchmove', innerWidth - 120);
    at('touchend', innerWidth - 120);
  });
}

/** Whether anything on the page is wider than the page. */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const scroller = document.querySelector('li-chapters-page .page')!;
    return Math.max(
      root.scrollWidth - root.clientWidth,
      scroller.scrollWidth - scroller.clientWidth,
    );
  });
}

/** The left and right edges of something, against the edges of the screen. */
export async function margins(what: Locator): Promise<{ left: number; right: number }> {
  const box = (await what.boundingBox())!;
  const width = (await what.page().viewportSize())!.width;
  return { left: Math.round(box.x), right: Math.round(width - (box.x + box.width)) };
}
