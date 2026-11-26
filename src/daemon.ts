import type { Page, Browser } from "puppeteer-core";
import { log } from "./log";
import type { Session } from "./browser";
import { createActivity, track } from "./activity";
import type { NetworkCapture } from "./commands/network";
import type { ConsoleCapture } from "./commands/console";
import type { TraceCapture } from "./commands/performance";
import {
  navigate,
  navigateBack,
  navigateForward,
  reload,
} from "./commands/navigate";
import { snapshot, screenshot, snapshotCommand } from "./commands/snapshot.ts";
import {
  click,
  hover,
  fill,
  fillForm,
  typeText,
  pressKey,
  drag,
  uploadFile,
} from "./commands/interact";
import { evaluate } from "./commands/evaluate";
import { listPages, newPage, closePage, selectPage } from "./commands/page";
import { emulate, resizePage } from "./commands/emulate";
import { waitFor, handleDialog } from "./commands/wait";
import {
  startTrace,
  stopTrace,
  analyzeTrace,
  analyzeInsight,
  takeHeapSnapshot,
} from "./commands/performance";
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
import {
  launchCmd,
  killCmd,
  killAllCmd,
  statusCmd,
  reapIdleCmd,
  sessionFor,
  shutdownCmd,
  shutdownOnSignals,
  type DaemonState,
} from "./commands/lifecycle";
import { oneshot } from "./commands/oneshot";
import {
  ensureRuntimeDir,
  LOCK_PATH,
  IDLE_TIMEOUT_MS,
  MAX_BROWSERS,
  REAP_INTERVAL_MS,
  SOCKET_PATH,
} from "./config";
import { createCapacity } from "./capacity";
import {
  parseTarget,
  sessionTarget,
  targetFields,
  targetKey,
  type Target,
} from "./target";
import { acquireDaemonLock } from "./daemon-lock";
import { rmSync } from "node:fs";
import { z, ZodError } from "zod";

const keySchema = z.string();
const valSchema = z.unknown();
const ParamsSchema = z.record(keySchema, valSchema);

type Params = z.infer<typeof ParamsSchema>;

const toErrorMessage = (err: unknown): string => {
  if (err instanceof ZodError)
    return err.issues.map((i) => i.message).join("; ");
  if (err instanceof Error) return err.message;
  return String(err);
};

type CommandResult = Promise<string> | string;

type CommandDef =
  | { needs: "page"; run: (page: Page, p: Params) => CommandResult }
  | { needs: "page"; prepare: (p: Params) => (page: Page) => CommandResult }
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
    if (typeof item !== "string")
      throw new Error(`param '${key}[${i}]' must be a string`);
    return item;
  });
};

type Viewport = { width: number; height: number };
type Geo = { latitude: number; longitude: number };

const isViewport = (v: unknown): v is Viewport =>
  typeof v === "object" &&
  v !== null &&
  "width" in v &&
  typeof v.width === "number" &&
  "height" in v &&
  typeof v.height === "number";

const isGeo = (v: unknown): v is Geo =>
  typeof v === "object" &&
  v !== null &&
  "latitude" in v &&
  typeof v.latitude === "number" &&
  "longitude" in v &&
  typeof v.longitude === "number";

const sessions = new Map<string, Session>();
const networkCaptures = new Map<string, NetworkCapture>();
const consoleCaptures = new Map<string, ConsoleCapture>();
const traceCaptures = new Map<string, TraceCapture>();
const state: DaemonState = {
  activity: createActivity(IDLE_TIMEOUT_MS),
  capacity: createCapacity(MAX_BROWSERS),
  consoleCaptures,
  networkCaptures,
  sessions,
};

const getSession = (target: Target): Promise<Session> =>
  sessionFor(state, target);

const commands = new Map<string, CommandDef>([
  [
    "launch",
    {
      needs: "daemon",
      run: (p) => {
        const headless = bool(p, "headless");
        return launchCmd(state, headless);
      },
    },
  ],
  [
    "kill",
    {
      needs: "daemon",
      run: (p) => {
        const target = parseTarget(p);
        return killCmd(state, target);
      },
    },
  ],
  ["kill-all", { needs: "daemon", run: () => killAllCmd(state) }],
  ["status", { needs: "daemon", run: () => statusCmd(state) }],
  ["shutdown", { needs: "daemon", run: () => shutdownCmd(state) }],

  [
    "oneshot",
    {
      needs: "daemon",
      run: (p) => {
        const url = str(p, "url");
        const mode = z.enum(["snapshot", "screenshot"]).parse(p["mode"]);
        const timeout = optNum(p, "timeout");
        const path = optStr(p, "path");
        const verbose = bool(p, "verbose");
        const fullPage =
          p["fullPage"] !== undefined ? bool(p, "fullPage") : undefined;
        const format = optStr(p, "format");
        const quality = optNum(p, "quality");
        const width = optNum(p, "width");
        const height = optNum(p, "height");
        return oneshot(state, {
          format,
          fullPage,
          height,
          mode,
          path,
          quality,
          timeout,
          url,
          verbose,
          width,
        });
      },
    },
  ],

  [
    "navigate",
    {
      needs: "page",
      run: (page, p) => {
        const bfu =
          p["handleBeforeUnload"] !== undefined
            ? z.enum(["accept", "decline"]).parse(p["handleBeforeUnload"])
            : undefined;
        const url = str(p, "url");
        const timeout = num(p, "timeout");
        const initScript = optStr(p, "initScript");
        return navigate(page, url, timeout, initScript, bfu);
      },
    },
  ],
  ["back", { needs: "page", run: (page) => navigateBack(page) }],
  ["forward", { needs: "page", run: (page) => navigateForward(page) }],
  [
    "reload",
    {
      needs: "page",
      run: (page, p) => {
        const ignoreCache = bool(p, "ignoreCache");
        return reload(page, ignoreCache);
      },
    },
  ],

  [snapshotCommand.cli.name, snapshotCommand.daemon],
  [
    "screenshot",
    {
      needs: "page",
      run: (page, p) => {
        const path = optStr(p, "path");
        const fullPage = bool(p, "fullPage");
        const format = str(p, "format");
        const quality = optNum(p, "quality");
        const uid = optStr(p, "uid");
        return screenshot(page, path, fullPage, format, quality, uid);
      },
    },
  ],

  [
    "click",
    {
      needs: "page",
      run: (page, p) => {
        const uid = str(p, "uid");
        const dblClick = bool(p, "dblClick");
        return click(page, uid, dblClick);
      },
    },
  ],
  [
    "hover",
    {
      needs: "page",
      run: (page, p) => {
        const uid = str(p, "uid");
        return hover(page, uid);
      },
    },
  ],
  [
    "fill",
    {
      needs: "page",
      run: (page, p) => {
        const uid = str(p, "uid");
        const value = str(p, "value");
        return fill(page, uid, value);
      },
    },
  ],
  [
    "type",
    {
      needs: "page",
      run: (page, p) => {
        const text = str(p, "text");
        const submitKey = optStr(p, "submitKey");
        return typeText(page, text, submitKey);
      },
    },
  ],
  [
    "press",
    {
      needs: "page",
      run: (page, p) => {
        const key = str(p, "key");
        return pressKey(page, key);
      },
    },
  ],
  [
    "drag",
    {
      needs: "page",
      run: (page, p) => {
        const from = str(p, "from");
        const to = str(p, "to");
        return drag(page, from, to);
      },
    },
  ],
  [
    "upload",
    {
      needs: "page",
      run: (page, p) => {
        const uid = str(p, "uid");
        const file = str(p, "file");
        return uploadFile(page, uid, file);
      },
    },
  ],
  [
    "fill-form",
    {
      needs: "page",
      run: (page, p) => {
        const fields = p["fields"];
        if (!Array.isArray(fields))
          throw new Error("param 'fields' must be an array");
        return fillForm(page, fields);
      },
    },
  ],

  [
    "eval",
    {
      needs: "page",
      run: (page, p) => {
        const args = p["args"];
        if (args !== undefined && !Array.isArray(args))
          throw new Error("param 'args' must be an array");
        const expression = str(p, "expression");
        return evaluate(page, expression, args);
      },
    },
  ],

  ["pages", { needs: "browser", run: (browser) => listPages(browser) }],
  [
    "new-page",
    {
      needs: "daemon",
      run: async (p) => {
        const target = parseTarget(p);
        const session = await getSession(target);
        const bg = bool(p, "background");
        const url = str(p, "url");
        const isolatedContext = optStr(p, "isolatedContext");
        const timeout = optNum(p, "timeout");
        const page = await newPage(
          session.browser,
          url,
          bg,
          isolatedContext,
          timeout,
        );
        if (!bg) session.page = page;
        const title = await page.title();
        return JSON.stringify({ title, url: page.url() });
      },
    },
  ],
  [
    "close-page",
    {
      needs: "daemon",
      run: async (p) => {
        const target = parseTarget(p);
        const session = await getSession(target);
        const pageId = num(p, "pageId");
        const result = await closePage(session.browser, pageId);
        const pages = await session.browser.pages();
        const firstPage = pages[0];
        if (!firstPage) throw new Error("no pages remaining after close");
        session.page = firstPage;
        return result;
      },
    },
  ],
  [
    "select-page",
    {
      needs: "daemon",
      run: async (p) => {
        const target = parseTarget(p);
        const session = await getSession(target);
        const btf = p["noBringToFront"] ? false : true;
        const pageId = num(p, "pageId");
        const page = await selectPage(session.browser, pageId, btf);
        session.page = page;
        return JSON.stringify({ selected: pageId });
      },
    },
  ],

  [
    "resize",
    {
      needs: "page",
      run: (page, p) => {
        const width = num(p, "width");
        const height = num(p, "height");
        return resizePage(page, width, height);
      },
    },
  ],

  [
    "emulate",
    {
      needs: "page",
      run: (page, p) => {
        const cs =
          p["colorScheme"] !== undefined
            ? z.enum(["dark", "light", "auto"]).parse(p["colorScheme"])
            : undefined;
        const vp = p["viewport"];
        const geo = p["geolocation"];
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
      },
    },
  ],

  [
    "wait",
    {
      needs: "page",
      run: (page, p) => {
        const texts = strArr(p, "texts");
        const timeout = num(p, "timeout");
        return waitFor(page, texts, timeout);
      },
    },
  ],
  [
    "dialog",
    {
      needs: "page",
      run: (page, p) => {
        const action = z.enum(["accept", "dismiss"]).parse(p["dialogAction"]);
        const promptText = optStr(p, "promptText");
        return handleDialog(page, action, promptText);
      },
    },
  ],

  [
    "trace-start",
    {
      needs: "daemon",
      run: async (p) => {
        const target = parseTarget(p);
        const key = targetKey(target);
        if (traceCaptures.has(key))
          throw new Error(`trace already active on ${key}`);
        const session = await getSession(target);
        const path = optStr(p, "path");
        const doReload = bool(p, "reload");
        const autoStop = bool(p, "autoStop");
        const { capture, result } = await startTrace(
          session.page,
          path,
          doReload,
          autoStop,
        );
        if (!autoStop) traceCaptures.set(key, capture);
        return result;
      },
    },
  ],
  [
    "trace-stop",
    {
      needs: "daemon",
      run: async (p) => {
        const target = parseTarget(p);
        const key = targetKey(target);
        const capture = traceCaptures.get(key);
        if (!capture) throw new Error(`no active trace on ${key}`);
        const path = optStr(p, "path");
        const result = await stopTrace(capture, path);
        traceCaptures.delete(key);
        return result;
      },
    },
  ],
  [
    "trace-analyze",
    {
      needs: "daemon",
      run: (p) => {
        const path = str(p, "path");
        return analyzeTrace(path);
      },
    },
  ],
  [
    "trace-analyze-insight",
    {
      needs: "daemon",
      run: (p) => {
        const path = str(p, "path");
        const insightSetId = str(p, "insightSetId");
        const insightName = str(p, "insightName");
        return analyzeInsight(path, insightSetId, insightName);
      },
    },
  ],
  [
    "heap-snapshot",
    {
      needs: "page",
      run: (page, p) => {
        const path = str(p, "path");
        return takeHeapSnapshot(page, path);
      },
    },
  ],

  [
    "network-start",
    {
      needs: "daemon",
      run: async (p) => {
        const target = parseTarget(p);
        const key = targetKey(target);
        if (networkCaptures.has(key))
          throw new Error(`network capture already active on ${key}`);
        const session = await getSession(target);
        const capture = await startNetworkCapture(session.page);
        networkCaptures.set(key, capture);
        return JSON.stringify({ capturing: true, ...targetFields(target) });
      },
    },
  ],
  [
    "network-list",
    {
      needs: "daemon",
      run: (p) => {
        const target = parseTarget(p);
        const key = targetKey(target);
        const capture = networkCaptures.get(key);
        if (!capture) throw new Error(`no active network capture on ${key}`);
        const type = optStr(p, "type");
        const includePreserved = bool(p, "includePreserved");
        const pageIdx = optNum(p, "pageIdx");
        const pageSize = optNum(p, "pageSize");
        return listNetworkEntries(
          capture,
          type,
          includePreserved,
          pageIdx,
          pageSize,
        );
      },
    },
  ],
  [
    "network-get",
    {
      needs: "daemon",
      run: async (p) => {
        const target = parseTarget(p);
        const key = targetKey(target);
        const capture = networkCaptures.get(key);
        if (!capture) throw new Error(`no active network capture on ${key}`);
        const reqid = num(p, "reqid");
        const requestFile = optStr(p, "requestFile");
        const responseFile = optStr(p, "responseFile");
        return getNetworkEntry(capture, reqid, requestFile, responseFile);
      },
    },
  ],
  [
    "network-stop",
    {
      needs: "daemon",
      run: async (p) => {
        const target = parseTarget(p);
        const key = targetKey(target);
        const capture = networkCaptures.get(key);
        if (!capture) throw new Error(`no active network capture on ${key}`);
        const session = await getSession(target);
        const result = await stopNetworkCapture(session.page, capture);
        networkCaptures.delete(key);
        return result;
      },
    },
  ],

  [
    "console-start",
    {
      needs: "daemon",
      run: async (p) => {
        const target = parseTarget(p);
        const key = targetKey(target);
        if (consoleCaptures.has(key))
          throw new Error(`console capture already active on ${key}`);
        const session = await getSession(target);
        const capture = startConsoleCapture(session.page);
        consoleCaptures.set(key, capture);
        return JSON.stringify({ capturing: true, ...targetFields(target) });
      },
    },
  ],
  [
    "console-list",
    {
      needs: "daemon",
      run: (p) => {
        const target = parseTarget(p);
        const key = targetKey(target);
        const capture = consoleCaptures.get(key);
        if (!capture) throw new Error(`no active console capture on ${key}`);
        const type = optStr(p, "type");
        const includePreserved = bool(p, "includePreserved");
        const pageIdx = optNum(p, "pageIdx");
        const pageSize = optNum(p, "pageSize");
        return listConsoleEntries(
          capture,
          type,
          includePreserved,
          pageIdx,
          pageSize,
        );
      },
    },
  ],
  [
    "console-get",
    {
      needs: "daemon",
      run: (p) => {
        const target = parseTarget(p);
        const key = targetKey(target);
        const capture = consoleCaptures.get(key);
        if (!capture) throw new Error(`no active console capture on ${key}`);
        const msgid = num(p, "msgid");
        return getConsoleEntry(capture.entries, msgid);
      },
    },
  ],
  [
    "console-stop",
    {
      needs: "daemon",
      run: async (p) => {
        const target = parseTarget(p);
        const key = targetKey(target);
        const capture = consoleCaptures.get(key);
        if (!capture) throw new Error(`no active console capture on ${key}`);
        const session = await getSession(target);
        const result = stopConsoleCapture(session.page, capture);
        consoleCaptures.delete(key);
        return result;
      },
    },
  ],
]);

const SNAPSHOT_ACTIONS = new Set([
  "click",
  "hover",
  "fill",
  "fill-form",
  "type",
  "press",
  "drag",
  "upload",
]);

const mergeWithSnapshot = (result: string, snap: string): string => {
  try {
    const parsed: unknown = JSON.parse(result);
    const parsedResult = ParamsSchema.parse(parsed);
    return JSON.stringify({ ...parsedResult, snapshot: snap });
  } catch (err) {
    throw new Error(`failed to merge snapshot into response: ${String(err)}`, {
      cause: err,
    });
  }
};

const dispatch = async (params: Params): Promise<string> => {
  const action = str(params, "action");
  const def = commands.get(action);
  if (!def) throw new Error(`unknown action: ${action}`);

  switch (def.needs) {
    case "page": {
      const run =
        "prepare" in def
          ? def.prepare(params)
          : (page: Page) => def.run(page, params);
      const target = parseTarget(params);
      const { page } = await getSession(target);
      const result = await run(page);
      if (bool(params, "includeSnapshot") && SNAPSHOT_ACTIONS.has(action)) {
        const snap = await snapshot(page, false, undefined);
        return mergeWithSnapshot(result, snap);
      }
      return result;
    }
    case "browser": {
      const target = parseTarget(params);
      const { browser } = await getSession(target);
      return def.run(browser, params);
    }
    case "daemon": {
      return def.run(params);
    }
  }
};

const ownedKey = (params: Params): string | undefined => {
  const session = params["session"];
  if (typeof session !== "string") return undefined;
  const target = sessionTarget(session);
  const key = targetKey(target);
  return state.capacity.owned.has(key) ? key : undefined;
};

const execute = (params: Params): Promise<string> => {
  const key = ownedKey(params);
  if (key === undefined) return dispatch(params);
  return track(state.activity, key, () => dispatch(params));
};

const reapIdle = (): void => {
  reapIdleCmd(state)
    .then(log.info)
    .catch((error: unknown) => {
      log.error(`idle reaping failed: ${toErrorMessage(error)}`);
    });
};

const removeStaleSocket = (): void => {
  try {
    rmSync(SOCKET_PATH, { force: true });
  } catch (error) {
    throw new Error(`Could not remove ${SOCKET_PATH}: ${String(error)}`, {
      cause: error,
    });
  }
};

const start = () => {
  ensureRuntimeDir();
  if (!acquireDaemonLock(LOCK_PATH)) {
    log.info(`another daemon owns ${LOCK_PATH} (pid: ${process.pid} exiting)`);
    return;
  }
  removeStaleSocket();

  Bun.serve({
    fetch: async (req) => {
      try {
        const rawBody: unknown = await req.json();
        const body = ParamsSchema.parse(rawBody);
        const result = await execute(body);
        return new Response(result, {
          headers: { "content-type": "application/json" },
        });
      } catch (err) {
        const message = toErrorMessage(err);
        return new Response(JSON.stringify({ error: message }), {
          status: 500,
        });
      }
    },
    unix: SOCKET_PATH,
  });
  shutdownOnSignals(state);
  setInterval(reapIdle, REAP_INTERVAL_MS);

  log.info(`daemon listening on ${SOCKET_PATH} (pid: ${process.pid})`);
};

export { start };
