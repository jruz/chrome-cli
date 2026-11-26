import { z } from "zod";
import {
  defineTargetCommand,
  noParams,
  numberParam,
  opt,
  req,
  textParam,
  toggle,
} from "../command.ts";

import type { Browser, Page } from "puppeteer-core";

const listPages = async (browser: Browser): Promise<string> => {
  const pages = await browser.pages();
  const mapped = pages.map(async (p, i) => ({
    id: i,
    title: await p.title(),
    url: p.url(),
  }));
  const info = await Promise.all(mapped);
  return JSON.stringify(info);
};

const newPage = async (
  browser: Browser,
  url: string,
  background: boolean,
  isolatedContext: string | undefined,
  timeout: number | undefined,
): Promise<Page> => {
  const context = isolatedContext
    ? await browser.createBrowserContext()
    : browser.defaultBrowserContext();
  const page = await context.newPage();
  if (url) {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      ...(timeout !== undefined ? { timeout } : {}),
    });
  }
  if (!background) {
    await page.bringToFront();
  }
  return page;
};

const closePage = async (browser: Browser, pageId: number): Promise<string> => {
  const pages = await browser.pages();
  const target = pages[pageId];
  if (!target) throw new Error(`page not found: ${String(pageId)}`);
  if (pages.length <= 1) throw new Error("cannot close the last page");
  await target.close();
  return JSON.stringify({ closed: pageId });
};

const selectPage = async (
  browser: Browser,
  pageId: number,
  bringToFront: boolean,
): Promise<Page> => {
  const pages = await browser.pages();
  const target = pages[pageId];
  if (!target) throw new Error(`page not found: ${String(pageId)}`);
  if (bringToFront) await target.bringToFront();
  return target;
};

const PagesParams = z
  .object({
    background: toggle,
    isolatedContext: textParam("isolatedContext").optional(),
    timeout: numberParam("timeout").optional(),
    url: textParam("url"),
  })
  .readonly();

export const pagesCommand = defineTargetCommand(
  {
    description: "List all open pages/tabs",
    flags: [],
    name: "pages",
    toPayload: () => ({}),
  },
  noParams,
  async ({ getSession }, target) => {
    const { browser } = await getSession(target);
    return listPages(browser);
  },
);

export const newPageCommand = defineTargetCommand(
  {
    description: "Open a new page/tab",
    flags: [
      req("--url <url>", "URL to load"),
      opt("--background", "open without focusing"),
      opt(
        "--isolated-context <name>",
        "create page in isolated browser context",
      ),
      opt("--timeout <ms>", "navigation timeout"),
    ],
    name: "new-page",
    toPayload: (o) => ({
      background: !!o["background"],
      isolatedContext: o["isolatedContext"],
      timeout: o["timeout"] ? Number(o["timeout"]) : undefined,
      url: o["url"],
    }),
  },
  PagesParams,
  async (
    { getSession },
    target,
    { background, isolatedContext, timeout, url },
  ) => {
    const session = await getSession(target);
    const page = await newPage(
      session.browser,
      url,
      background,
      isolatedContext,
      timeout,
    );
    if (!background) session.page = page;
    const title = await page.title();
    return JSON.stringify({ title, url: page.url() });
  },
);

const ClosePageParams = z.object({ pageId: numberParam("pageId") }).readonly();

export const closePageCommand = defineTargetCommand(
  {
    description: "Close a page/tab by index",
    flags: [req("--page-id <id>", "page index")],
    name: "close-page",
    toPayload: (o) => ({ pageId: Number(o["pageId"]) }),
  },
  ClosePageParams,
  async ({ getSession }, target, { pageId }) => {
    const session = await getSession(target);
    const result = await closePage(session.browser, pageId);
    const [firstPage] = await session.browser.pages();
    if (!firstPage) throw new Error("no pages remaining after close");
    session.page = firstPage;
    return result;
  },
);

const SelectPageParams = z
  .object({ noBringToFront: toggle, pageId: numberParam("pageId") })
  .readonly();

export const selectPageCommand = defineTargetCommand(
  {
    description: "Switch focus to a page/tab",
    flags: [
      req("--page-id <id>", "page index"),
      opt("--no-bring-to-front", "select without focusing"),
    ],
    name: "select-page",
    toPayload: (o) => ({
      noBringToFront: !!o["noBringToFront"],
      pageId: Number(o["pageId"]),
    }),
  },
  SelectPageParams,
  async ({ getSession }, target, { noBringToFront, pageId }) => {
    const session = await getSession(target);
    session.page = await selectPage(session.browser, pageId, !noBringToFront);
    return JSON.stringify({ selected: pageId });
  },
);
