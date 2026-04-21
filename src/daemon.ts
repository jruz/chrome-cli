import type { Page, Browser } from "puppeteer-core";
import { log } from "./log";
import { isAlive, connect, type Session } from "./browser";
import type { NetworkCapture } from "./commands/network";
import type { ConsoleCapture } from "./commands/console";
import type { TraceCapture } from "./commands/performance";
import { navigate, navigateBack, navigateForward, reload } from "./commands/navigate";
import { snapshot, screenshot } from "./commands/snapshot";
import { click, hover, fill, fillForm, typeText, pressKey, drag, uploadFile } from "./commands/interact";
import { evaluate } from "./commands/evaluate";
import { listPages, newPage, closePage, selectPage } from "./commands/page";
import { emulate, resizePage } from "./commands/emulate";
import { waitFor, handleDialog } from "./commands/wait";
import { startTrace, stopTrace, analyzeTrace, analyzeInsight, takeHeapSnapshot } from "./commands/performance";
import {
  startCapture as startNetworkCapture,
  listEntries as listNetworkEntries,
  getEntry as getNetworkEntry,
  stopCapture as stopNetworkCapture,
} from "./commands/network";
import {
  startCapture as startConsoleCapture,
  getEntry as getConsoleEntry,
  listEntries as listConsoleEntries,
  stopCapture as stopConsoleCapture,
} from "./commands/console";
import { launchCmd, killCmd, killAllCmd, statusCmd, shutdownCmd, type DaemonState } from "./commands/lifecycle";
import { oneshot } from "./commands/oneshot";
import { SOCKET_PATH } from "./config";
import { unlinkSync } from "fs";
import { z, ZodError } from "zod";

const keySchema = z.string();
const valSchema = z.unknown();
const ParamsSchema = z.record(keySchema, valSchema);

type Params = z.infer<typeof ParamsSchema>;

const toErrorMessage = (err: unknown): string => {
  if (err instanceof ZodError) return err.issues.map((i) => i.message).join("; ");
  if (err instanceof Error) return err.message;
  return String(err);
};

type CommandResult = Promise<string> | string;

type CommandDef =
  | { needs: "page"; run: (page: Page, p: Params) => CommandResult }
  | { needs: "browser"; run: (browser: Browser, p: Params) => CommandResult }
  | { needs: "daemon"; run: (p: Params) => CommandResult };

const str = (p: Params, key: string): string => {
  const v = p[key];
  if (typeof v !== "string") throw new Error(`param '${key}' must be a string`);
  return v;
};

const num = (p: Params, key: string): number => {
  const v = p[key];
  if (typeof v !== "number") throw new Error(`param '${key}' must be a number`);
  return v;
};

const bool = (p: Params, key: string): boolean => !!p[key];

const optNum = (p: Params, key: string): number | undefined => {
  const v = p[key];
  if (v === undefined) return undefined;
  if (typeof v !== "number") throw new Error(`param '${key}' must be a number`);
  return v;
};

const optStr = (p: Params, key: string): string | undefined => {
  const v = p[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new Error(`param '${key}' must be a string`);
  return v;
};

const strArr = (p: Params, key: string): string[] => {
  const v = p[key];
  if (!Array.isArray(v)) throw new Error(`param '${key}' must be an array`);
  return v.map((item: unknown, i: number) => {
    if (typeof item !== "string") throw new Error(`param '${key}[${i}]' must be a string`);
    return item;
  });
};

type Viewport = { width: number; height: number };
type Geo = { latitude: number; longitude: number };

const isViewport = (v: unknown): v is Viewport =>
  typeof v === "object" && v !== null &&
  "width" in v && typeof v.width === "number" &&
  "height" in v && typeof v.height === "number";

const isGeo = (v: unknown): v is Geo =>
  typeof v === "object" && v !== null &&
  "latitude" in v && typeof v.latitude === "number" &&
  "longitude" in v && typeof v.longitude === "number";

const sessions = new Map<number, Session>();
const networkCaptures = new Map<number, NetworkCapture>();
const consoleCaptures = new Map<number, ConsoleCapture>();
const traceCaptures = new Map<number, TraceCapture>();
const state: DaemonState = { sessions, networkCaptures, consoleCaptures };

const getSession = async (port: number): Promise<Session> => {
  const existing = sessions.get(port);
  if (existing) {
    if (await isAlive(port)) return existing;
    log.warn(`dead session on port ${port}, removing`);
    await existing.browser.disconnect();
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
  ["launch", { needs: "daemon", run: (p) => {
    const headless = bool(p, "headless");
    return launchCmd(state, headless);
  }}],
  ["kill", { needs: "daemon", run: (p) => {
    const port = num(p, "port");
    return killCmd(state, port);
  }}],
  ["kill-all", { needs: "daemon", run: () => killAllCmd(state) }],
  ["status", { needs: "daemon", run: () => statusCmd(state) }],
  ["shutdown", { needs: "daemon", run: () => shutdownCmd(state) }],

  ["oneshot", { needs: "daemon", run: (p) => {
    const url = str(p, "url");
    const mode = z.enum(["snapshot", "screenshot"]).parse(p["mode"]);
    const timeout = optNum(p, "timeout");
    const path = optStr(p, "path");
    const verbose = bool(p, "verbose");
    const fullPage = p["fullPage"] !== undefined ? bool(p, "fullPage") : undefined;
    const format = optStr(p, "format");
    const quality = optNum(p, "quality");
    const width = optNum(p, "width");
    const height = optNum(p, "height");
    return oneshot(state, { url, mode, timeout, path, verbose, fullPage, format, quality, width, height });
  }}],

  ["navigate", { needs: "page", run: (page, p) => {
    const bfu = p["handleBeforeUnload"] !== undefined
      ? z.enum(["accept", "decline"]).parse(p["handleBeforeUnload"])
      : undefined;
    const url = str(p, "url");
    const timeout = num(p, "timeout");
    const initScript = optStr(p, "initScript");
    return navigate(page, url, timeout, initScript, bfu);
  }}],
  ["back", { needs: "page", run: (page) => navigateBack(page) }],
  ["forward", { needs: "page", run: (page) => navigateForward(page) }],
  ["reload", { needs: "page", run: (page, p) => {
    const ignoreCache = bool(p, "ignoreCache");
    return reload(page, ignoreCache);
  }}],

  ["snapshot", { needs: "page", run: (page, p) => {
    const verbose = bool(p, "verbose");
    const filePath = optStr(p, "filePath");
    return snapshot(page, verbose, filePath);
  }}],
  ["screenshot", { needs: "page", run: (page, p) => {
    const path = optStr(p, "path");
    const fullPage = bool(p, "fullPage");
    const format = str(p, "format");
    const quality = optNum(p, "quality");
    const uid = optStr(p, "uid");
    return screenshot(page, path, fullPage, format, quality, uid);
  }}],

  ["click", { needs: "page", run: (page, p) => {
    const uid = str(p, "uid");
    const dblClick = bool(p, "dblClick");
    return click(page, uid, dblClick);
  }}],
  ["hover", { needs: "page", run: (page, p) => {
    const uid = str(p, "uid");
    return hover(page, uid);
  }}],
  ["fill", { needs: "page", run: (page, p) => {
    const uid = str(p, "uid");
    const value = str(p, "value");
    return fill(page, uid, value);
  }}],
  ["type", { needs: "page", run: (page, p) => {
    const text = str(p, "text");
    const submitKey = optStr(p, "submitKey");
    return typeText(page, text, submitKey);
  }}],
  ["press", { needs: "page", run: (page, p) => {
    const key = str(p, "key");
    return pressKey(page, key);
  }}],
  ["drag", { needs: "page", run: (page, p) => {
    const from = str(p, "from");
    const to = str(p, "to");
    return drag(page, from, to);
  }}],
  ["upload", { needs: "page", run: (page, p) => {
    const uid = str(p, "uid");
    const file = str(p, "file");
    return uploadFile(page, uid, file);
  }}],
  ["fill-form", { needs: "page", run: (page, p) => {
    const fields = p['fields'];
    if (!Array.isArray(fields)) throw new Error("param 'fields' must be an array");
    return fillForm(page, fields);
  }}],

  ["eval", { needs: "page", run: (page, p) => {
    const args = p['args'];
    if (args !== undefined && !Array.isArray(args)) throw new Error("param 'args' must be an array");
    const expression = str(p, "expression");
    return evaluate(page, expression, args);
  }}],

  ["pages", { needs: "browser", run: (browser) => listPages(browser) }],
  ["new-page", { needs: "daemon", run: async (p) => {
    const port = num(p, "port");
    const session = await getSession(port);
    const bg = bool(p, "background");
    const url = str(p, "url");
    const isolatedContext = optStr(p, "isolatedContext");
    const timeout = optNum(p, "timeout");
    const page = await newPage(session.browser, url, bg, isolatedContext, timeout);
    if (!bg) session.page = page;
    const title = await page.title();
    return JSON.stringify({ url: page.url(), title });
  }}],
  ["close-page", { needs: "daemon", run: async (p) => {
    const port = num(p, "port");
    const session = await getSession(port);
    const pageId = num(p, "pageId");
    const result = await closePage(session.browser, pageId);
    const pages = await session.browser.pages();
    const firstPage = pages[0];
    if (!firstPage) throw new Error("no pages remaining after close");
    session.page = firstPage;
    return result;
  }}],
  ["select-page", { needs: "daemon", run: async (p) => {
    const port = num(p, "port");
    const session = await getSession(port);
    const btf = p['noBringToFront'] ? false : true;
    const pageId = num(p, "pageId");
    const page = await selectPage(session.browser, pageId, btf);
    session.page = page;
    return JSON.stringify({ selected: pageId });
  }}],

  ["resize", { needs: "page", run: (page, p) => {
    const width = num(p, "width");
    const height = num(p, "height");
    return resizePage(page, width, height);
  }}],

  ["emulate", { needs: "page", run: (page, p) => {
    const cs = p["colorScheme"] !== undefined
      ? z.enum(["dark", "light", "auto"]).parse(p["colorScheme"])
      : undefined;
    const vp = p['viewport'];
    const geo = p['geolocation'];
    const ua = optStr(p, "userAgent");
    const cpu = optNum(p, "cpuThrottlingRate");
    const net = optStr(p, "networkConditions");

    const resolveViewport = () => {
      if (vp === "reset") return { viewport: "reset" as const };
      if (isViewport(vp)) return { viewport: vp };
      return {};
    };

    const resolveGeo = () => {
      if (geo === "reset") return { geolocation: "reset" as const };
      if (isGeo(geo)) return { geolocation: geo };
      return {};
    };

    return emulate(page, {
      ...resolveViewport(),
      ...(ua !== undefined ? { userAgent: ua } : {}),
      ...resolveGeo(),
      ...(cs !== undefined ? { colorScheme: cs } : {}),
      ...(cpu !== undefined ? { cpuThrottlingRate: cpu } : {}),
      ...(net !== undefined ? { networkConditions: net } : {}),
    });
  }}],

  ["wait", { needs: "page", run: (page, p) => {
    const texts = strArr(p, "texts");
    const timeout = num(p, "timeout");
    return waitFor(page, texts, timeout);
  }}],
  ["dialog", { needs: "page", run: (page, p) => {
    const action = z.enum(["accept", "dismiss"]).parse(p["dialogAction"]);
    const promptText = optStr(p, "promptText");
    return handleDialog(page, action, promptText);
  }}],

  ["trace-start", { needs: "daemon", run: async (p) => {
    const port = num(p, "port");
    if (traceCaptures.has(port)) throw new Error(`trace already active on port ${port}`);
    const session = await getSession(port);
    const path = optStr(p, "path");
    const doReload = bool(p, "reload");
    const autoStop = bool(p, "autoStop");
    const { capture, result } = await startTrace(session.page, path, doReload, autoStop);
    if (!autoStop) traceCaptures.set(port, capture);
    return result;
  }}],
  ["trace-stop", { needs: "daemon", run: async (p) => {
    const port = num(p, "port");
    const capture = traceCaptures.get(port);
    if (!capture) throw new Error(`no active trace on port ${port}`);
    const path = optStr(p, "path");
    const result = await stopTrace(capture, path);
    traceCaptures.delete(port);
    return result;
  }}],
  ["trace-analyze", { needs: "daemon", run: (p) => {
    const path = str(p, "path");
    return analyzeTrace(path);
  }}],
  ["trace-analyze-insight", { needs: "daemon", run: (p) => {
    const path = str(p, "path");
    const insightSetId = str(p, "insightSetId");
    const insightName = str(p, "insightName");
    return analyzeInsight(path, insightSetId, insightName);
  }}],
  ["heap-snapshot", { needs: "page", run: (page, p) => {
    const path = str(p, "path");
    return takeHeapSnapshot(page, path);
  }}],

  ["network-start", { needs: "daemon", run: async (p) => {
    const port = num(p, "port");
    if (networkCaptures.has(port)) throw new Error(`network capture already active on port ${port}`);
    const session = await getSession(port);
    const capture = await startNetworkCapture(session.page);
    networkCaptures.set(port, capture);
    return JSON.stringify({ capturing: true, port });
  }}],
  ["network-list", { needs: "daemon", run: (p) => {
    const port = num(p, "port");
    const capture = networkCaptures.get(port);
    if (!capture) throw new Error(`no active network capture on port ${port}`);
    const type = optStr(p, "type");
    const includePreserved = bool(p, "includePreserved");
    const pageIdx = optNum(p, "pageIdx");
    const pageSize = optNum(p, "pageSize");
    return listNetworkEntries(capture, type, includePreserved, pageIdx, pageSize);
  }}],
  ["network-get", { needs: "daemon", run: async (p) => {
    const port = num(p, "port");
    const capture = networkCaptures.get(port);
    if (!capture) throw new Error(`no active network capture on port ${port}`);
    const reqid = num(p, "reqid");
    const requestFile = optStr(p, "requestFile");
    const responseFile = optStr(p, "responseFile");
    return getNetworkEntry(capture, reqid, requestFile, responseFile);
  }}],
  ["network-stop", { needs: "daemon", run: async (p) => {
    const port = num(p, "port");
    const capture = networkCaptures.get(port);
    if (!capture) throw new Error(`no active network capture on port ${port}`);
    const session = await getSession(port);
    const result = await stopNetworkCapture(session.page, capture);
    networkCaptures.delete(port);
    return result;
  }}],

  ["console-start", { needs: "daemon", run: async (p) => {
    const port = num(p, "port");
    if (consoleCaptures.has(port)) throw new Error(`console capture already active on port ${port}`);
    const session = await getSession(port);
    const capture = startConsoleCapture(session.page);
    consoleCaptures.set(port, capture);
    return JSON.stringify({ capturing: true, port });
  }}],
  ["console-list", { needs: "daemon", run: (p) => {
    const port = num(p, "port");
    const capture = consoleCaptures.get(port);
    if (!capture) throw new Error(`no active console capture on port ${port}`);
    const type = optStr(p, "type");
    const includePreserved = bool(p, "includePreserved");
    const pageIdx = optNum(p, "pageIdx");
    const pageSize = optNum(p, "pageSize");
    return listConsoleEntries(capture, type, includePreserved, pageIdx, pageSize);
  }}],
  ["console-get", { needs: "daemon", run: (p) => {
    const port = num(p, "port");
    const capture = consoleCaptures.get(port);
    if (!capture) throw new Error(`no active console capture on port ${port}`);
    const msgid = num(p, "msgid");
    return getConsoleEntry(capture.entries, msgid);
  }}],
  ["console-stop", { needs: "daemon", run: async (p) => {
    const port = num(p, "port");
    const capture = consoleCaptures.get(port);
    if (!capture) throw new Error(`no active console capture on port ${port}`);
    const session = await getSession(port);
    const result = stopConsoleCapture(session.page, capture);
    consoleCaptures.delete(port);
    return result;
  }}],
]);

const SNAPSHOT_ACTIONS = new Set([
  "click", "hover", "fill", "fill-form", "type", "press", "drag", "upload",
]);

const mergeWithSnapshot = (result: string, snap: string): string => {
  try {
    const parsed: unknown = JSON.parse(result);
    const parsedResult = ParamsSchema.parse(parsed);
    return JSON.stringify({ ...parsedResult, snapshot: snap });
  } catch (err) {
    throw new Error(`failed to merge snapshot into response: ${String(err)}`, { cause: err });
  }
};

const dispatch = async (params: Params): Promise<string> => {
  const action = str(params, "action");
  const def = commands.get(action);
  if (!def) throw new Error(`unknown action: ${action}`);

  switch (def.needs) {
    case "page": {
      const port = num(params, "port");
      const { page } = await getSession(port);
      const result = await def.run(page, params);
      if (bool(params, "includeSnapshot") && SNAPSHOT_ACTIONS.has(action)) {
        const snap = await snapshot(page, false, undefined);
        return mergeWithSnapshot(result, snap);
      }
      return result;
    }
    case "browser": {
      const browserPort = num(params, "port");
      const { browser } = await getSession(browserPort);
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
    log.warn(`failed to unlink socket: ${String(err)}`);
  }

  Bun.serve({
    unix: SOCKET_PATH,
    fetch: async (req) => {
      try {
        const rawBody: unknown = await req.json();
        const body = ParamsSchema.parse(rawBody);
        const result = await dispatch(body);
        return new Response(result, { headers: { "content-type": "application/json" } });
      } catch (err) {
        const message = toErrorMessage(err);
        return new Response(JSON.stringify({ error: message }), { status: 500 });
      }
    },
  });

  log.info(`daemon listening on ${SOCKET_PATH} (pid: ${process.pid})`);
};

export { start };
