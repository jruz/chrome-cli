import type { Page, Browser } from "puppeteer-core";
import type { Session } from "./browser";
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
import { launch, connect } from "./browser";
import { rmSync } from "fs";

export type Params = Record<string, unknown>;

type Flag = {
  flag: string;
  description: string;
  required: boolean;
};

export type DaemonCtx = {
  sessions: Map<number, Session>;
  networkCaptures: Map<number, NetworkCapture>;
  consoleCaptures: Map<number, ConsoleCapture>;
  getSession: (port: number) => Promise<Session>;
  findChromePid: (port: number) => Promise<number | null>;
};

type PageCommand = {
  name: string;
  description: string;
  needs: "page";
  flags: Flag[];
  toPayload: (opts: Record<string, any>) => Params;
  run: (page: Page, p: Params) => Promise<string>;
};

type BrowserCommand = {
  name: string;
  description: string;
  needs: "browser";
  flags: Flag[];
  toPayload: (opts: Record<string, any>) => Params;
  run: (browser: Browser, p: Params) => Promise<string>;
};

type DaemonCommand = {
  name: string;
  description: string;
  needs: "daemon";
  flags: Flag[];
  toPayload: (opts: Record<string, any>) => Params;
  run: (ctx: DaemonCtx, p: Params) => Promise<string>;
};

export type CommandDef = PageCommand | BrowserCommand | DaemonCommand;

const req = (flag: string, desc: string): Flag => ({ flag, description: desc, required: true });
const opt = (flag: string, desc: string): Flag => ({ flag, description: desc, required: false });

const parseViewport = (v: string) => {
  const parts = v.split("x");
  return { width: Number(parts[0]), height: Number(parts[1]) };
};

const parseGeo = (v: string) => {
  const parts = v.split(",");
  return { latitude: Number(parts[0]), longitude: Number(parts[1]) };
};

export const commands: CommandDef[] = [
  // --- Lifecycle ---

  {
    name: "launch",
    description: "Launch a new Chrome instance",
    needs: "daemon",
    flags: [opt("--headed", "launch with visible window")],
    toPayload: (o) => ({ headless: !o.headed }),
    run: async (ctx, p) => {
      const { port, userDataDir } = await launch(!!p.headless);
      const session = await connect(port, userDataDir);
      ctx.sessions.set(port, session);
      return JSON.stringify({ port });
    },
  },
  {
    name: "kill",
    description: "Kill a Chrome instance by port",
    needs: "daemon",
    flags: [req("--port <port>", "Chrome debug port")],
    toPayload: (o) => ({ port: Number(o.port) }),
    run: async (ctx, p) => {
      const port = p.port as number;
      const session = ctx.sessions.get(port);
      if (session) {
        session.browser.disconnect();
        if (session.userDataDir) {
          try { rmSync(session.userDataDir, { recursive: true }); } catch {}
        }
        ctx.sessions.delete(port);
        ctx.networkCaptures.delete(port);
        ctx.consoleCaptures.delete(port);
      }
      const pid = await ctx.findChromePid(port);
      if (pid) process.kill(pid, "SIGTERM");
      if (!session && !pid) throw new Error(`no Chrome found on port ${port}`);
      return JSON.stringify({ killed: port, pid });
    },
  },
  {
    name: "kill-all",
    description: "Kill all tracked Chrome instances",
    needs: "daemon",
    flags: [],
    toPayload: () => ({}),
    run: async (ctx) => {
      const killed: { port: number; pid: number | null }[] = [];
      for (const [port, session] of ctx.sessions) {
        session.browser.disconnect();
        if (session.userDataDir) {
          try { rmSync(session.userDataDir, { recursive: true }); } catch {}
        }
        const pid = await ctx.findChromePid(port);
        if (pid) process.kill(pid, "SIGTERM");
        killed.push({ port, pid });
      }
      ctx.sessions.clear();
      ctx.networkCaptures.clear();
      ctx.consoleCaptures.clear();
      return JSON.stringify({ killed });
    },
  },
  {
    name: "status",
    description: "Show daemon status",
    needs: "daemon",
    flags: [],
    toPayload: () => ({}),
    run: async (ctx) => {
      const ports = Array.from(ctx.sessions.keys());
      return JSON.stringify({ sessions: ports.length, ports });
    },
  },
  {
    name: "shutdown",
    description: "Shutdown daemon",
    needs: "daemon",
    flags: [],
    toPayload: () => ({}),
    run: async (ctx) => {
      ctx.sessions.forEach((s) => s.browser.disconnect());
      ctx.sessions.clear();
      setTimeout(() => process.exit(0), 100);
      return JSON.stringify({ shutdown: true });
    },
  },

  // --- Navigation ---

  {
    name: "navigate",
    description: "Navigate the current page to a URL",
    needs: "page",
    flags: [req("--url <url>", "target URL"), req("--timeout <ms>", "navigation timeout")],
    toPayload: (o) => ({ url: o.url, timeout: Number(o.timeout) }),
    run: (page, p) => navigate(page, p.url as string, p.timeout as number),
  },
  {
    name: "back",
    description: "Navigate back in browser history",
    needs: "page",
    flags: [],
    toPayload: () => ({}),
    run: (page) => navigateBack(page),
  },
  {
    name: "forward",
    description: "Navigate forward in browser history",
    needs: "page",
    flags: [],
    toPayload: () => ({}),
    run: (page) => navigateForward(page),
  },
  {
    name: "reload",
    description: "Reload the current page",
    needs: "page",
    flags: [],
    toPayload: () => ({}),
    run: (page) => reload(page),
  },

  // --- Inspection ---

  {
    name: "snapshot",
    description: "Take an accessibility tree snapshot",
    needs: "page",
    flags: [],
    toPayload: () => ({}),
    run: (page) => snapshot(page),
  },
  {
    name: "screenshot",
    description: "Take a screenshot (PNG)",
    needs: "page",
    flags: [opt("--path <path>", "save to file"), opt("--full-page", "capture full page")],
    toPayload: (o) => ({ path: o.path, fullPage: !!o.fullPage }),
    run: (page, p) => screenshot(page, p.path as string | undefined, !!p.fullPage),
  },

  // --- Interaction ---

  {
    name: "click",
    description: "Click an element by uid",
    needs: "page",
    flags: [req("--uid <uid>", "element uid from snapshot"), opt("--dbl-click", "double click")],
    toPayload: (o) => ({ uid: o.uid, dblClick: !!o.dblClick }),
    run: (page, p) => click(page, p.uid as string, !!p.dblClick),
  },
  {
    name: "hover",
    description: "Hover over an element by uid",
    needs: "page",
    flags: [req("--uid <uid>", "element uid from snapshot")],
    toPayload: (o) => ({ uid: o.uid }),
    run: (page, p) => hover(page, p.uid as string),
  },
  {
    name: "fill",
    description: "Clear and type a value into an input",
    needs: "page",
    flags: [req("--uid <uid>", "element uid"), req("--value <value>", "text to type")],
    toPayload: (o) => ({ uid: o.uid, value: o.value }),
    run: (page, p) => fill(page, p.uid as string, p.value as string),
  },
  {
    name: "type",
    description: "Type text into the focused element",
    needs: "page",
    flags: [req("--text <text>", "text to type"), opt("--submit-key <key>", "key to press after")],
    toPayload: (o) => ({ text: o.text, submitKey: o.submitKey }),
    run: (page, p) => typeText(page, p.text as string, p.submitKey as string | undefined),
  },
  {
    name: "press",
    description: "Press a key or combination",
    needs: "page",
    flags: [req("--key <key>", "key or combination")],
    toPayload: (o) => ({ key: o.key }),
    run: (page, p) => pressKey(page, p.key as string),
  },
  {
    name: "drag",
    description: "Drag an element onto another",
    needs: "page",
    flags: [req("--from <uid>", "element to drag"), req("--to <uid>", "drop target")],
    toPayload: (o) => ({ from: o.from, to: o.to }),
    run: (page, p) => drag(page, p.from as string, p.to as string),
  },
  {
    name: "upload",
    description: "Upload a file through a file input",
    needs: "page",
    flags: [req("--uid <uid>", "file input uid"), req("--file <path>", "local file path")],
    toPayload: (o) => ({ uid: o.uid, file: o.file }),
    run: (page, p) => uploadFile(page, p.uid as string, p.file as string),
  },

  // --- Evaluate ---

  {
    name: "eval",
    description: "Evaluate JavaScript in page context",
    needs: "page",
    flags: [req("--expression <code>", "JavaScript expression")],
    toPayload: (o) => ({ expression: o.expression }),
    run: (page, p) => evaluate(page, p.expression as string),
  },

  // --- Pages ---

  {
    name: "pages",
    description: "List all open pages/tabs",
    needs: "browser",
    flags: [],
    toPayload: () => ({}),
    run: (browser) => listPages(browser),
  },
  {
    name: "new-page",
    description: "Open a new page/tab",
    needs: "browser",
    flags: [req("--url <url>", "URL to load")],
    toPayload: (o) => ({ url: o.url }),
    run: (browser, p) => newPage(browser, p.url as string),
  },
  {
    name: "close-page",
    description: "Close a page/tab by index",
    needs: "browser",
    flags: [req("--page-id <id>", "page index")],
    toPayload: (o) => ({ pageId: Number(o.pageId) }),
    run: (browser, p) => closePage(browser, p.pageId as number),
  },
  {
    name: "select-page",
    description: "Switch focus to a page/tab",
    needs: "browser",
    flags: [req("--page-id <id>", "page index")],
    toPayload: (o) => ({ pageId: Number(o.pageId) }),
    run: async (browser, p) => {
      await selectPage(browser, p.pageId as number);
      return JSON.stringify({ selected: p.pageId });
    },
  },

  // --- Emulation ---

  {
    name: "emulate",
    description: "Emulate device features",
    needs: "page",
    flags: [
      opt("--viewport <WxH>", "viewport size"),
      opt("--user-agent <string>", "user agent string"),
      opt("--geolocation <lat,lng>", "geolocation"),
      opt("--color-scheme <scheme>", "dark or light"),
    ],
    toPayload: (o) => ({
      viewport: o.viewport ? parseViewport(o.viewport) : undefined,
      userAgent: o.userAgent,
      geolocation: o.geolocation ? parseGeo(o.geolocation) : undefined,
      colorScheme: o.colorScheme,
    }),
    run: (page, p) => emulate(page, {
      viewport: p.viewport as { width: number; height: number } | undefined,
      userAgent: p.userAgent as string | undefined,
      geolocation: p.geolocation as { latitude: number; longitude: number } | undefined,
      colorScheme: p.colorScheme as "dark" | "light" | undefined,
    }),
  },

  // --- Wait ---

  {
    name: "wait",
    description: "Wait for text to appear on the page",
    needs: "page",
    flags: [req("--text <texts>", "comma-separated texts"), req("--timeout <ms>", "max wait time")],
    toPayload: (o) => ({ texts: (o.text as string).split(","), timeout: Number(o.timeout) }),
    run: (page, p) => waitFor(page, p.texts as string[], p.timeout as number),
  },
  {
    name: "dialog",
    description: "Handle a browser dialog",
    needs: "page",
    flags: [req("--action <action>", "accept or dismiss"), opt("--prompt-text <text>", "prompt input")],
    toPayload: (o) => ({ dialogAction: o.action, promptText: o.promptText }),
    run: (page, p) => handleDialog(page, p.dialogAction as "accept" | "dismiss", p.promptText as string | undefined),
  },

  // --- Performance ---

  {
    name: "trace-start",
    description: "Start a performance trace",
    needs: "page",
    flags: [opt("--path <path>", "save trace to file")],
    toPayload: (o) => ({ path: o.path }),
    run: (page, p) => startTrace(page, p.path as string | undefined),
  },
  {
    name: "trace-stop",
    description: "Stop the performance trace",
    needs: "page",
    flags: [opt("--path <path>", "save trace to file")],
    toPayload: (o) => ({ path: o.path }),
    run: (page, p) => stopTrace(page, p.path as string | undefined),
  },
  {
    name: "heap-snapshot",
    description: "Capture a heap memory snapshot",
    needs: "page",
    flags: [req("--path <path>", "save .heapsnapshot to file")],
    toPayload: (o) => ({ path: o.path }),
    run: (page, p) => takeHeapSnapshot(page, p.path as string),
  },

  // --- Network capture ---

  {
    name: "network-start",
    description: "Start capturing network requests",
    needs: "daemon",
    flags: [req("--port <port>", "Chrome debug port")],
    toPayload: (o) => ({ port: Number(o.port) }),
    run: async (ctx, p) => {
      const port = p.port as number;
      if (ctx.networkCaptures.has(port)) throw new Error(`network capture already active on port ${port}`);
      const session = await ctx.getSession(port);
      const capture = await startNetworkCapture(session.page);
      ctx.networkCaptures.set(port, capture);
      return JSON.stringify({ capturing: true, port });
    },
  },
  {
    name: "network-list",
    description: "List captured network requests",
    needs: "daemon",
    flags: [req("--port <port>", "Chrome debug port"), opt("--type <type>", "filter by resource type")],
    toPayload: (o) => ({ port: Number(o.port), type: o.type }),
    run: async (ctx, p) => {
      const capture = ctx.networkCaptures.get(p.port as number);
      if (!capture) throw new Error(`no active network capture on port ${p.port}`);
      return listNetworkEntries(capture.entries, p.type as string | undefined);
    },
  },
  {
    name: "network-stop",
    description: "Stop capturing network requests",
    needs: "daemon",
    flags: [req("--port <port>", "Chrome debug port")],
    toPayload: (o) => ({ port: Number(o.port) }),
    run: async (ctx, p) => {
      const port = p.port as number;
      const capture = ctx.networkCaptures.get(port);
      if (!capture) throw new Error(`no active network capture on port ${port}`);
      const result = await stopNetworkCapture(capture);
      ctx.networkCaptures.delete(port);
      return result;
    },
  },

  // --- Console capture ---

  {
    name: "console-start",
    description: "Start capturing console messages",
    needs: "daemon",
    flags: [req("--port <port>", "Chrome debug port")],
    toPayload: (o) => ({ port: Number(o.port) }),
    run: async (ctx, p) => {
      const port = p.port as number;
      if (ctx.consoleCaptures.has(port)) throw new Error(`console capture already active on port ${port}`);
      const session = await ctx.getSession(port);
      const capture = startConsoleCapture(session.page);
      ctx.consoleCaptures.set(port, capture);
      return JSON.stringify({ capturing: true, port });
    },
  },
  {
    name: "console-list",
    description: "List captured console messages",
    needs: "daemon",
    flags: [req("--port <port>", "Chrome debug port"), opt("--type <type>", "filter by message type")],
    toPayload: (o) => ({ port: Number(o.port), type: o.type }),
    run: async (ctx, p) => {
      const capture = ctx.consoleCaptures.get(p.port as number);
      if (!capture) throw new Error(`no active console capture on port ${p.port}`);
      return listConsoleEntries(capture.entries, p.type as string | undefined);
    },
  },
  {
    name: "console-stop",
    description: "Stop capturing console messages",
    needs: "daemon",
    flags: [req("--port <port>", "Chrome debug port")],
    toPayload: (o) => ({ port: Number(o.port) }),
    run: async (ctx, p) => {
      const port = p.port as number;
      const capture = ctx.consoleCaptures.get(port);
      if (!capture) throw new Error(`no active console capture on port ${port}`);
      const session = await ctx.getSession(port);
      const result = stopConsoleCapture(session.page, capture);
      ctx.consoleCaptures.delete(port);
      return result;
    },
  },
];

export const commandMap = new Map(commands.map((c) => [c.name, c]));
