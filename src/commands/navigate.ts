import { z } from "zod";
import {
  definePageCommand,
  noParams,
  numberParam,
  opt,
  req,
  textParam,
  toggle,
} from "../command.ts";

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

const navigateBack = async (page: Page): Promise<string> => {
  await page.goBack({ waitUntil: "domcontentloaded" });
  return JSON.stringify({ title: await page.title(), url: page.url() });
};

const navigateForward = async (page: Page): Promise<string> => {
  await page.goForward({ waitUntil: "domcontentloaded" });
  return JSON.stringify({ title: await page.title(), url: page.url() });
};

const reload = async (page: Page, ignoreCache: boolean): Promise<string> => {
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

const NavigateParams = z
  .object({
    handleBeforeUnload: z.enum(["accept", "decline"]).optional(),
    initScript: textParam("initScript").optional(),
    timeout: numberParam("timeout"),
    url: textParam("url"),
  })
  .readonly();

export const navigateCommand = definePageCommand(
  {
    description: "Navigate the current page to a URL",
    flags: [
      req("--url <url>", "target URL"),
      req("--timeout <ms>", "navigation timeout"),
      opt("--init-script <code>", "JavaScript to inject before load"),
      opt(
        "--handle-before-unload <action>",
        "auto-handle beforeunload dialog (accept or decline)",
      ),
    ],
    name: "navigate",
    toPayload: (o) => ({
      handleBeforeUnload: o["handleBeforeUnload"],
      initScript: o["initScript"],
      timeout: Number(o["timeout"]),
      url: o["url"],
    }),
  },
  NavigateParams,
  (page, { url, timeout, initScript, handleBeforeUnload }) =>
    navigate(page, url, timeout, initScript, handleBeforeUnload),
);

const BackParams = z.object({ ignoreCache: toggle }).readonly();

export const backCommand = definePageCommand(
  {
    description: "Navigate back in browser history",
    flags: [],
    name: "back",
    toPayload: () => ({}),
  },
  noParams,
  navigateBack,
);

export const forwardCommand = definePageCommand(
  {
    description: "Navigate forward in browser history",
    flags: [],
    name: "forward",
    toPayload: () => ({}),
  },
  noParams,
  navigateForward,
);

export const reloadCommand = definePageCommand(
  {
    description: "Reload the current page",
    flags: [opt("--ignore-cache", "bypass cache on reload")],
    name: "reload",
    toPayload: (o) => ({ ignoreCache: !!o["ignoreCache"] }),
  },
  BackParams,
  (page, { ignoreCache }) => reload(page, ignoreCache),
);
