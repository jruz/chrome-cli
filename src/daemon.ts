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
import { SOCKET_PATH } from "./config";
import { unlinkSync } from "fs";
import { z } from "zod";

const ParamsSchema = z.record(z.string(), z.unknown());

type Params = z.infer<typeof ParamsSchema>;

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
  ["launch", { needs: "daemon", run: (p) => launchCmd(state, bool(p, "headless")) }],
  ["kill", { needs: "daemon", run: (p) => killCmd(state, num(p, "port")) }],
  ["kill-all", { needs: "daemon", run: () => killAllCmd(state) }],
  ["status", { needs: "daemon", run: () => statusCmd(state) }],
  ["shutdown", { needs: "daemon", run: () => shutdownCmd(state) }],

  ["navigate", { needs: "page", run: (page, p) => {
    const bfu = optStr(p, "handleBeforeUnload");
    if (bfu !== undefined && bfu !== "accept" && bfu !== "decline") throw new Error(`invalid handleBeforeUnload: ${bfu}`);
    return navigate(page, str(p, "url"), num(p, "timeout"), optStr(p, "initScript"), bfu);
  }}],
  ["back", { needs: "page", run: (page) => navigateBack(page) }],
  ["forward", { needs: "page", run: (page) => navigateForward(page) }],
  ["reload", { needs: "page", run: (page, p) => reload(page, bool(p, "ignoreCache")) }],

  ["snapshot", { needs: "page", run: (page, p) => snapshot(page, bool(p, "verbose"), optStr(p, "filePath")) }],
  ["screenshot", { needs: "page", run: (page, p) => screenshot(page, optStr(p, "path"), bool(p, "fullPage"), str(p, "format"), optNum(p, "quality"), optStr(p, "uid")) }],

  ["click", { needs: "page", run: (page, p) => click(page, str(p, "uid"), bool(p, "dblClick")) }],
  ["hover", { needs: "page", run: (page, p) => hover(page, str(p, "uid")) }],
  ["fill", { needs: "page", run: (page, p) => fill(page, str(p, "uid"), str(p, "value")) }],
  ["type", { needs: "page", run: (page, p) => typeText(page, str(p, "text"), optStr(p, "submitKey")) }],
  ["press", { needs: "page", run: (page, p) => pressKey(page, str(p, "key")) }],
  ["drag", { needs: "page", run: (page, p) => drag(page, str(p, "from"), str(p, "to")) }],
  ["upload", { needs: "page", run: (page, p) => uploadFile(page, str(p, "uid"), str(p, "file")) }],
  ["fill-form", { needs: "page", run: (page, p) => {
    const fields = p['fields'];
    if (!Array.isArray(fields)) throw new Error("param 'fields' must be an array");
    return fillForm(page, fields);
  }}],

  ["eval", { needs: "page", run: (page, p) => {
    const args = p['args'];
    if (args !== undefined && !Array.isArray(args)) throw new Error("param 'args' must be an array");
    return evaluate(page, str(p, "expression"), args);
  }}],

  ["pages", { needs: "browser", run: (browser) => listPages(browser) }],
  ["new-page", { needs: "daemon", run: async (p) => {
    const session = await getSession(num(p, "port"));
    const bg = bool(p, "background");
    const page = await newPage(session.browser, str(p, "url"), bg, optStr(p, "isolatedContext"), optNum(p, "timeout"));
    if (!bg) session.page = page;
    return JSON.stringify({ url: page.url(), title: await page.title() });
  }}],
  ["close-page", { needs: "daemon", run: async (p) => {
    const session = await getSession(num(p, "port"));
    const result = await closePage(session.browser, num(p, "pageId"));
    const pages = await session.browser.pages();
    const firstPage = pages[0];
    if (!firstPage) throw new Error("no pages remaining after close");
    session.page = firstPage;
    return result;
  }}],
  ["select-page", { needs: "daemon", run: async (p) => {
    const session = await getSession(num(p, "port"));
    const btf = p['noBringToFront'] ? false : true;
    const page = await selectPage(session.browser, num(p, "pageId"), btf);
    session.page = page;
    return JSON.stringify({ selected: num(p, "pageId") });
  }}],

  ["resize", { needs: "page", run: (page, p) => resizePage(page, num(p, "width"), num(p, "height")) }],

  ["emulate", { needs: "page", run: (page, p) => {
    const cs = optStr(p, "colorScheme");
    if (cs !== undefined && cs !== "dark" && cs !== "light" && cs !== "auto") throw new Error(`invalid colorScheme: ${cs}`);
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

  ["wait", { needs: "page", run: (page, p) => waitFor(page, strArr(p, "texts"), num(p, "timeout")) }],
  ["dialog", { needs: "page", run: (page, p) => {
    const action = str(p, "dialogAction");
    if (action !== "accept" && action !== "dismiss") throw new Error(`invalid dialogAction: ${action}`);
    return handleDialog(page, action, optStr(p, "promptText"));
  }}],

  ["trace-start", { needs: "daemon", run: async (p) => {
    const port = num(p, "port");
    if (traceCaptures.has(port)) throw new Error(`trace already active on port ${port}`);
    const session = await getSession(port);
    const { capture, result } = await startTrace(session.page, optStr(p, "path"), bool(p, "reload"), bool(p, "autoStop"));
    if (!bool(p, "autoStop")) traceCaptures.set(port, capture);
    return result;
  }}],
  ["trace-stop", { needs: "daemon", run: async (p) => {
    const port = num(p, "port");
    const capture = traceCaptures.get(port);
    if (!capture) throw new Error(`no active trace on port ${port}`);
    const result = await stopTrace(capture, optStr(p, "path"));
    traceCaptures.delete(port);
    return result;
  }}],
  ["trace-analyze", { needs: "daemon", run: (p) => analyzeTrace(str(p, "path")) }],
  ["trace-analyze-insight", { needs: "daemon", run: (p) => analyzeInsight(str(p, "path"), str(p, "insightSetId"), str(p, "insightName")) }],
  ["heap-snapshot", { needs: "page", run: (page, p) => takeHeapSnapshot(page, str(p, "path")) }],

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
    return listNetworkEntries(capture, optStr(p, "type"), bool(p, "includePreserved"), optNum(p, "pageIdx"), optNum(p, "pageSize"));
  }}],
  ["network-get", { needs: "daemon", run: async (p) => {
    const port = num(p, "port");
    const capture = networkCaptures.get(port);
    if (!capture) throw new Error(`no active network capture on port ${port}`);
    return getNetworkEntry(capture, num(p, "reqid"), optStr(p, "requestFile"), optStr(p, "responseFile"));
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
    return listConsoleEntries(capture, optStr(p, "type"), bool(p, "includePreserved"), optNum(p, "pageIdx"), optNum(p, "pageSize"));
  }}],
  ["console-get", { needs: "daemon", run: (p) => {
    const port = num(p, "port");
    const capture = consoleCaptures.get(port);
    if (!capture) throw new Error(`no active console capture on port ${port}`);
    return getConsoleEntry(capture.entries, num(p, "msgid"));
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
    const parsedResult = ParamsSchema.parse(JSON.parse(result));
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
      const { page } = await getSession(num(params, "port"));
      const result = await def.run(page, params);
      if (bool(params, "includeSnapshot") && SNAPSHOT_ACTIONS.has(action)) {
        const snap = await snapshot(page, false, undefined);
        return mergeWithSnapshot(result, snap);
      }
      return result;
    }
    case "browser": {
      const { browser } = await getSession(num(params, "port"));
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
        const body = ParamsSchema.parse(await req.json());
        const result = await dispatch(body);
        return new Response(result, { headers: { "content-type": "application/json" } });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return new Response(JSON.stringify({ error: message }), { status: 500 });
      }
    },
  });

  log.info(`daemon listening on ${SOCKET_PATH} (pid: ${process.pid})`);
};

export { start };
