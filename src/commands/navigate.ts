import type { Page } from "puppeteer-core";

type BeforeUnloadAction = "accept" | "decline";

export const navigate = async (
  page: Page,
  url: string,
  timeout: number,
  initScript: string | undefined,
  handleBeforeUnload: BeforeUnloadAction | undefined,
): Promise<string> => {
  if (initScript) {
    await page.evaluateOnNewDocument(initScript);
  }

  const dialogHandler = handleBeforeUnload
    ? (dialog: { type: () => string; accept: () => Promise<void>; dismiss: () => Promise<void> }) => {
        if (dialog.type() === "beforeunload") {
          if (handleBeforeUnload === "accept") void dialog.accept();
          else void dialog.dismiss();
        }
      }
    : undefined;

  if (dialogHandler) page.on("dialog", dialogHandler);

  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout,
    });
    if (!response) {
      throw new Error(`no response from ${url}`);
    }
    return JSON.stringify({
      url: page.url(),
      status: response.status(),
      title: await page.title(),
    });
  } finally {
    if (dialogHandler) page.off("dialog", dialogHandler);
  }
};

export const navigateBack = async (page: Page): Promise<string> => {
  await page.goBack({ waitUntil: "domcontentloaded" });
  return JSON.stringify({ url: page.url(), title: await page.title() });
};

export const navigateForward = async (page: Page): Promise<string> => {
  await page.goForward({ waitUntil: "domcontentloaded" });
  return JSON.stringify({ url: page.url(), title: await page.title() });
};

export const reload = async (
  page: Page,
  ignoreCache: boolean,
): Promise<string> => {
  if (ignoreCache) {
    const client = await page.createCDPSession();
    await client.send("Page.reload", { ignoreCache: true });
    await client.detach();
    await page.waitForNavigation({ waitUntil: "domcontentloaded" });
  } else {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  return JSON.stringify({ url: page.url(), title: await page.title() });
};
