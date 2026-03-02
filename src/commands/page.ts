import type { Browser, Page } from "puppeteer-core";

export const listPages = async (browser: Browser): Promise<string> => {
  const pages = await browser.pages();
  const info = await Promise.all(
    pages.map(async (p, i) => ({
      id: i,
      url: p.url(),
      title: await p.title(),
    })),
  );
  return JSON.stringify(info);
};

export const newPage = async (
  browser: Browser,
  url: string,
  background: boolean,
  isolatedContext: string | undefined,
): Promise<Page> => {
  const context = isolatedContext
    ? await browser.createBrowserContext()
    : browser.defaultBrowserContext();
  const page = await context.newPage();
  if (url) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }
  if (!background) {
    await page.bringToFront();
  }
  return page;
};

export const closePage = async (
  browser: Browser,
  pageId: number,
): Promise<string> => {
  const pages = await browser.pages();
  const target = pages[pageId];
  if (!target) throw new Error(`page not found: ${String(pageId)}`);
  if (pages.length <= 1) throw new Error("cannot close the last page");
  await target.close();
  return JSON.stringify({ closed: pageId });
};

export const selectPage = async (
  browser: Browser,
  pageId: number,
): Promise<Page> => {
  const pages = await browser.pages();
  const target = pages[pageId];
  if (!target) throw new Error(`page not found: ${String(pageId)}`);
  await target.bringToFront();
  return target;
};
