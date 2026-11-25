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

  const dialogFailure = Promise.withResolvers<never>();
  const dialogHandler = handleBeforeUnload
    ? (dialog: {
        type: () => string;
        accept: () => Promise<void>;
        dismiss: () => Promise<void>;
      }) => {
        if (dialog.type() === "beforeunload") {
          const handling =
            handleBeforeUnload === "accept"
              ? dialog.accept()
              : dialog.dismiss();
          handling.catch(dialogFailure.reject);
        }
      }
    : undefined;

  if (dialogHandler) page.on("dialog", dialogHandler);

  try {
    const response = await Promise.race([
      page.goto(url, { timeout, waitUntil: "domcontentloaded" }),
      dialogFailure.promise,
    ]);
    if (!response) {
      throw new Error(`no response from ${url}`);
    }
    return JSON.stringify({
      status: response.status(),
      title: await page.title(),
      url: page.url(),
    });
  } finally {
    if (dialogHandler) page.off("dialog", dialogHandler);
  }
};

export const navigateBack = async (page: Page): Promise<string> => {
  await page.goBack({ waitUntil: "domcontentloaded" });
  return JSON.stringify({ title: await page.title(), url: page.url() });
};

export const navigateForward = async (page: Page): Promise<string> => {
  await page.goForward({ waitUntil: "domcontentloaded" });
  return JSON.stringify({ title: await page.title(), url: page.url() });
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
  return JSON.stringify({ title: await page.title(), url: page.url() });
};
