import type { Page, ElementHandle, KeyInput } from "puppeteer-core";
import { _keyDefinitions } from "puppeteer-core/internal/common/USKeyboardLayout.js";

const isKeyInput = (key: string): key is KeyInput => key in _keyDefinitions;

const toKeyInput = (key: string): KeyInput => {
  if (!isKeyInput(key)) throw new Error(`invalid key: ${key}`);
  return key;
};

const ATTR = "data-chrome-cli-uid";

export const findByUid = async (
  page: Page,
  uid: string,
): Promise<ElementHandle | null> => {
  const cached = await page.$(`[${ATTR}="${uid}"]`);
  if (cached) return cached;

  const client = await page.createCDPSession();
  try {
    const { nodes } = await client.send("Accessibility.getFullAXTree");
    const axNode = nodes.find((n: { nodeId: string }) => n.nodeId === uid);
    if (!axNode) return null;
    const backendId = axNode.backendDOMNodeId;
    if (backendId === undefined) return null;

    const { object } = await client.send("DOM.resolveNode", {
      backendNodeId: backendId,
    });
    if (!object.objectId) return null;

    await client.send("Runtime.callFunctionOn", {
      arguments: [{ value: uid }],
      functionDeclaration: `function(uid) {
        const el = this.nodeType === 3 ? this.parentElement : this;
        if (el && el.setAttribute) el.setAttribute('${ATTR}', uid);
      }`,
      objectId: object.objectId,
    });

    await client.send("Runtime.releaseObject", { objectId: object.objectId });
  } finally {
    await client.detach();
  }

  return page.$(`[${ATTR}="${uid}"]`);
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
    const key = toKeyInput(submitKey);
    await page.keyboard.press(key);
  }
  return JSON.stringify({ submitKey, typed: text });
};

export const pressKey = async (page: Page, key: string): Promise<string> => {
  const input = toKeyInput(key);
  await page.keyboard.press(input);
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
  await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2);
  await page.mouse.up();

  return JSON.stringify({ dragged: { from: fromUid, to: toUid } });
};

type FieldEntry = { uid: string; value: string };

const isFieldEntry = (v: unknown): v is FieldEntry =>
  typeof v === "object" &&
  v !== null &&
  "uid" in v &&
  typeof v.uid === "string" &&
  "value" in v &&
  typeof v.value === "string";

const fillOne = async (page: Page, field: FieldEntry) => {
  const el = await findByUid(page, field.uid);
  if (!el) throw new Error(`element not found: ${field.uid}`);
  await el.click({ count: 3 });
  await el.type(field.value);
  return { uid: field.uid, value: field.value };
};

export const fillForm = async (
  page: Page,
  fields: unknown[],
): Promise<string> => {
  const validated = fields.map((field) => {
    if (!isFieldEntry(field))
      throw new Error(`invalid field entry: ${JSON.stringify(field)}`);
    return field;
  });

  const results = await Array.fromAsync(validated, (field) =>
    fillOne(page, field),
  );

  return JSON.stringify({ filled: results });
};

export const uploadFile = async (
  page: Page,
  uid: string,
  filePath: string,
): Promise<string> => {
  const el = await findByUid(page, uid);
  if (!el) throw new Error(`element not found: ${uid}`);
  const input = await el.toElement("input");
  await input.uploadFile(filePath);
  return JSON.stringify({ to: uid, uploaded: filePath });
};
