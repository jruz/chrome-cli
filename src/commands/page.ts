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
): Promise<string> => {
  const page = await browser.newPage();
  if (url) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }
  return JSON.stringify({ url: page.url(), title: await page.title() });
};

export const closePage = async (
  browser: Browser,
  pageId: number,
): Promise<string> => {
  const pages = await browser.pages();
  const target = pages[pageId];
  if (!target) throw new Error(`page not found: ${pageId}`);
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
  if (!target) throw new Error(`page not found: ${pageId}`);
  await target.bringToFront();
  return target;
};
