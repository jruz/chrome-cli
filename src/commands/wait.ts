import type { Page } from "puppeteer-core";

export const waitFor = async (
  page: Page,
  texts: string[],
  timeout: number,
): Promise<string> => {
  const promises = texts.map(async (text) => {
    await page.waitForFunction(
      (t: string) => document.body.innerText.includes(t),
      { timeout },
      text,
    );
    return text;
  });
  const found = await Promise.race(promises);
  return JSON.stringify({ found });
};

export const handleDialog = async (
  page: Page,
  action: "accept" | "dismiss",
  promptText: string | undefined,
): Promise<string> => {
  return new Promise((resolve) => {
    page.once("dialog", (dialog) => {
      void (async () => {
        if (action === "accept") {
          await dialog.accept(promptText);
        } else {
          await dialog.dismiss();
        }
        const dialogType = dialog.type();
        const result = JSON.stringify({ action, type: dialogType });
        resolve(result);
      })();
    });
  });
};
