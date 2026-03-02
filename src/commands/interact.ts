import type { Page, ElementHandle } from "puppeteer-core";

const findByUid = async (
  page: Page,
  uid: string,
): Promise<ElementHandle<Element> | null> => {
  const element = await page.$(`[data-uid="${uid}"]`);
  if (element) return element;

  const result = await page.evaluateHandle(
    (nodeId) => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_ELEMENT,
      );
      let index = 0;
      while (walker.nextNode()) {
        if (String(index) === nodeId) return walker.currentNode as Element;
        index++;
      }
      return null;
    },
    uid,
  );

  const el = result.asElement() as ElementHandle<Element> | null;
  return el;
};

export const click = async (
  page: Page,
  uid: string,
  dblClick: boolean,
): Promise<string> => {
  const el = await findByUid(page, uid);
  if (!el) throw new Error(`element not found: ${uid}`);
  if (dblClick) {
    await el.click({ count: 2 });
  } else {
    await el.click();
  }
  return JSON.stringify({ clicked: uid, dblClick });
};

export const hover = async (page: Page, uid: string): Promise<string> => {
  const el = await findByUid(page, uid);
  if (!el) throw new Error(`element not found: ${uid}`);
  await el.hover();
  return JSON.stringify({ hovered: uid });
};

export const fill = async (
  page: Page,
  uid: string,
  value: string,
): Promise<string> => {
  const el = await findByUid(page, uid);
  if (!el) throw new Error(`element not found: ${uid}`);
  await el.click({ count: 3 });
  await el.type(value);
  return JSON.stringify({ filled: uid, value });
};

export const typeText = async (
  page: Page,
  text: string,
  submitKey: string | undefined,
): Promise<string> => {
  await page.keyboard.type(text);
  if (submitKey) {
    await page.keyboard.press(submitKey as any);
  }
  return JSON.stringify({ typed: text, submitKey });
};

export const pressKey = async (
  page: Page,
  key: string,
): Promise<string> => {
  await page.keyboard.press(key as any);
  return JSON.stringify({ pressed: key });
};

export const drag = async (
  page: Page,
  fromUid: string,
  toUid: string,
): Promise<string> => {
  const from = await findByUid(page, fromUid);
  const to = await findByUid(page, toUid);
  if (!from) throw new Error(`element not found: ${fromUid}`);
  if (!to) throw new Error(`element not found: ${toUid}`);

  const fromBox = await from.boundingBox();
  const toBox = await to.boundingBox();
  if (!fromBox) throw new Error(`no bounding box for: ${fromUid}`);
  if (!toBox) throw new Error(`no bounding box for: ${toUid}`);

  await page.mouse.move(
    fromBox.x + fromBox.width / 2,
    fromBox.y + fromBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    toBox.x + toBox.width / 2,
    toBox.y + toBox.height / 2,
  );
  await page.mouse.up();

  return JSON.stringify({ dragged: { from: fromUid, to: toUid } });
};

export const uploadFile = async (
  page: Page,
  uid: string,
  filePath: string,
): Promise<string> => {
  const el = await findByUid(page, uid);
  if (!el) throw new Error(`element not found: ${uid}`);
  const input = el as ElementHandle<HTMLInputElement>;
  await input.uploadFile(filePath);
  return JSON.stringify({ uploaded: filePath, to: uid });
};
