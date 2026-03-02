import type { Page, Browser } from "puppeteer-core";
import { log } from "./log";
import { isAlive, connect, type Session } from "./browser";
import type { NetworkCapture } from "./commands/network";
import type { ConsoleCapture } from "./commands/console";
import { navigate, navigateBack, navigateForward, reload } from "./commands/navigate";
import { snapshot, screenshot } from "./commands/snapshot";
import { click, hover, fill, typeText, pressKey, drag, uploadFile } from "./commands/interact";
import { evaluate } from "./commands/evaluate";
import { listPages, newPage, closePage, selectPage } from "./commands/page";
import { emulate } from "./commands/emulate";
import { waitFor, handleDialog } from "./commands/wait";
import { startTrace, stopTrace, takeHeapSnapshot } from "./commands/performance";
import {
  startCapture as startNetworkCapture,
  listEntries as listNetworkEntries,
  stopCapture as stopNetworkCapture,
} from "./commands/network";
import {
  startCapture as startConsoleCapture,
  listEntries as listConsoleEntries,
  stopCapture as stopConsoleCapture,
} from "./commands/console";
import { launchCmd, killCmd, killAllCmd, statusCmd, shutdownCmd, type DaemonState } from "./commands/lifecycle";
import { SOCKET_PATH } from "./config";
import { unlinkSync } from "fs";

type Params = Record<string, unknown>;

type CommandDef =
  | { needs: "page"; run: (page: Page, p: Params) => Promise<string> }
  | { needs: "browser"; run: (browser: Browser, p: Params) => Promise<string> }
  | { needs: "daemon"; run: (p: Params) => Promise<string> };

const sessions = new Map<number, Session>();
const networkCaptures = new Map<number, NetworkCapture>();
const consoleCaptures = new Map<number, ConsoleCapture>();
const state: DaemonState = { sessions, networkCaptures, consoleCaptures };

const getSession = async (port: number): Promise<Session> => {
  const existing = sessions.get(port);
  if (existing) {
    if (await isAlive(port)) return existing;
    log.warn(`dead session on port ${port}, removing`);
    existing.browser.disconnect();
    sessions.delete(port);
    networkCaptures.delete(port);
    consoleCaptures.delete(port);
    throw new Error(`Chrome on port ${port} is not responding, session removed`);
  }
  const session = await connect(port, "");
  sessions.set(port, session);
  return session;
};

const commands = new Map<string, CommandDef>([
  ["launch", { needs: "daemon", run: (p) => launchCmd(state, !!p.headless) }],
  ["kill", { needs: "daemon", run: (p) => killCmd(state, p.port as number) }],
  ["kill-all", { needs: "daemon", run: () => killAllCmd(state) }],
  ["status", { needs: "daemon", run: () => statusCmd(state) }],
  ["shutdown", { needs: "daemon", run: () => shutdownCmd(state) }],

  ["navigate", { needs: "page", run: (page, p) => navigate(page, p.url as string, p.timeout as number) }],
  ["back", { needs: "page", run: (page) => navigateBack(page) }],
  ["forward", { needs: "page", run: (page) => navigateForward(page) }],
  ["reload", { needs: "page", run: (page) => reload(page) }],

  ["snapshot", { needs: "page", run: (page) => snapshot(page) }],
  ["screenshot", { needs: "page", run: (page, p) => screenshot(page, p.path as string | undefined, !!p.fullPage) }],

  ["click", { needs: "page", run: (page, p) => click(page, p.uid as string, !!p.dblClick) }],
  ["hover", { needs: "page", run: (page, p) => hover(page, p.uid as string) }],
  ["fill", { needs: "page", run: (page, p) => fill(page, p.uid as string, p.value as string) }],
  ["type", { needs: "page", run: (page, p) => typeText(page, p.text as string, p.submitKey as string | undefined) }],
  ["press", { needs: "page", run: (page, p) => pressKey(page, p.key as string) }],
  ["drag", { needs: "page", run: (page, p) => drag(page, p.from as string, p.to as string) }],
  ["upload", { needs: "page", run: (page, p) => uploadFile(page, p.uid as string, p.file as string) }],

  ["eval", { needs: "page", run: (page, p) => evaluate(page, p.expression as string) }],

  ["pages", { needs: "browser", run: (browser) => listPages(browser) }],
  ["new-page", { needs: "browser", run: (browser, p) => newPage(browser, p.url as string) }],
  ["close-page", { needs: "browser", run: (browser, p) => closePage(browser, p.pageId as number) }],
  ["select-page", { needs: "browser", run: async (browser, p) => {
    await selectPage(browser, p.pageId as number);
    return JSON.stringify({ selected: p.pageId });
  }}],

  ["emulate", { needs: "page", run: (page, p) => emulate(page, {
    viewport: p.viewport as { width: number; height: number } | undefined,
    userAgent: p.userAgent as string | undefined,
    geolocation: p.geolocation as { latitude: number; longitude: number } | undefined,
    colorScheme: p.colorScheme as "dark" | "light" | undefined,
  })}],

  ["wait", { needs: "page", run: (page, p) => waitFor(page, p.texts as string[], p.timeout as number) }],
  ["dialog", { needs: "page", run: (page, p) => handleDialog(page, p.dialogAction as "accept" | "dismiss", p.promptText as string | undefined) }],

  ["trace-start", { needs: "page", run: (page, p) => startTrace(page, p.path as string | undefined) }],
  ["trace-stop", { needs: "page", run: (page, p) => stopTrace(page, p.path as string | undefined) }],
  ["heap-snapshot", { needs: "page", run: (page, p) => takeHeapSnapshot(page, p.path as string) }],

  ["network-start", { needs: "daemon", run: async (p) => {
    const port = p.port as number;
    if (networkCaptures.has(port)) throw new Error(`network capture already active on port ${port}`);
    const session = await getSession(port);
    const capture = await startNetworkCapture(session.page);
    networkCaptures.set(port, capture);
    return JSON.stringify({ capturing: true, port });
  }}],
  ["network-list", { needs: "daemon", run: async (p) => {
    const capture = networkCaptures.get(p.port as number);
    if (!capture) throw new Error(`no active network capture on port ${p.port}`);
    return listNetworkEntries(capture.entries, p.type as string | undefined);
  }}],
  ["network-stop", { needs: "daemon", run: async (p) => {
    const port = p.port as number;
    const capture = networkCaptures.get(port);
    if (!capture) throw new Error(`no active network capture on port ${port}`);
    const result = await stopNetworkCapture(capture);
    networkCaptures.delete(port);
    return result;
  }}],

  ["console-start", { needs: "daemon", run: async (p) => {
    const port = p.port as number;
    if (consoleCaptures.has(port)) throw new Error(`console capture already active on port ${port}`);
    const session = await getSession(port);
    const capture = startConsoleCapture(session.page);
    consoleCaptures.set(port, capture);
    return JSON.stringify({ capturing: true, port });
  }}],
  ["console-list", { needs: "daemon", run: async (p) => {
    const capture = consoleCaptures.get(p.port as number);
    if (!capture) throw new Error(`no active console capture on port ${p.port}`);
    return listConsoleEntries(capture.entries, p.type as string | undefined);
  }}],
  ["console-stop", { needs: "daemon", run: async (p) => {
    const port = p.port as number;
    const capture = consoleCaptures.get(port);
    if (!capture) throw new Error(`no active console capture on port ${port}`);
    const session = await getSession(port);
    const result = stopConsoleCapture(session.page, capture);
    consoleCaptures.delete(port);
    return result;
  }}],
]);

const dispatch = async (params: Params): Promise<string> => {
  const def = commands.get(params.action as string);
  if (!def) throw new Error(`unknown action: ${params.action}`);

  switch (def.needs) {
    case "page": {
      const { page } = await getSession(params.port as number);
      return def.run(page, params);
    }
    case "browser": {
      const { browser } = await getSession(params.port as number);
      return def.run(browser, params);
    }
    case "daemon": {
      return def.run(params);
    }
  }
};

const start = () => {
  try {
    unlinkSync(SOCKET_PATH);
  } catch (err) {
    log.warn(`failed to unlink socket: ${err}`);
  }

  Bun.serve({
    unix: SOCKET_PATH,
    fetch: async (req) => {
      try {
        const result = await dispatch(await req.json());
        return new Response(result, { headers: { "content-type": "application/json" } });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return new Response(JSON.stringify({ error: message }), { status: 500 });
      }
    },
  });

  log.info(`daemon listening on ${SOCKET_PATH} (pid: ${process.pid})`);
};

start();
