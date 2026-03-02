import type { Page } from "puppeteer-core";

export const waitFor = async (
  page: Page,
  texts: string[],
  timeout: number,
): Promise<string> => {
  const found = await Promise.race(
    texts.map(async (text) => {
      await page.waitForFunction(
        (t: string) => document.body.innerText.includes(t),
        { timeout },
        text,
      );
      return text;
    }),
  );
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
        resolve(JSON.stringify({ action, type: dialog.type() }));
      })();
    });
  });
};
