import { log } from "./log";
import { launch, connect, isAlive, type Session } from "./browser";
import { navigate, navigateBack, navigateForward, reload } from "./commands/navigate";
import { snapshot, screenshot } from "./commands/snapshot";
import { click, hover, fill, typeText, pressKey, drag, uploadFile } from "./commands/interact";
import { evaluate } from "./commands/evaluate";
import { listPages, newPage, closePage, selectPage } from "./commands/page";
import { emulate } from "./commands/emulate";
import { waitFor, handleDialog } from "./commands/wait";
import { startTrace, stopTrace, takeHeapSnapshot } from "./commands/performance";
import { startCapture as startNetworkCapture, listEntries as listNetworkEntries, stopCapture as stopNetworkCapture, type NetworkCapture } from "./commands/network";
import { startCapture as startConsoleCapture, listEntries as listConsoleEntries, stopCapture as stopConsoleCapture, type ConsoleCapture } from "./commands/console";
import { unlinkSync, rmSync } from "fs";

const SOCKET_PATH = "/tmp/chrome-cli.sock";

const sessions = new Map<number, Session>();
const networkCaptures = new Map<number, NetworkCapture>();
const consoleCaptures = new Map<number, ConsoleCapture>();

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

const findChromePid = async (port: number): Promise<number | null> => {
  const proc = Bun.spawn(["lsof", "-ti", `:${port}`], { stdout: "pipe", stderr: "pipe" });
  const text = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) return null;
  const firstLine = text.trim().split("\n")[0];
  if (!firstLine) return null;
  const pid = parseInt(firstLine, 10);
  if (isNaN(pid)) return null;
  return pid;
};

type Command = {
  action: string;
  port?: number;
  [key: string]: unknown;
};

const handleCommand = async (cmd: Command): Promise<string> => {
  switch (cmd.action) {
    case "launch": {
      const { port, userDataDir } = await launch(!!cmd.headless);
      const session = await connect(port, userDataDir);
      sessions.set(port, session);
      return JSON.stringify({ port });
    }

    case "navigate": {
      const session = await getSession(cmd.port!);
      return navigate(session.page, cmd.url as string, cmd.timeout as number);
    }

    case "back": {
      const session = await getSession(cmd.port!);
      return navigateBack(session.page);
    }

    case "forward": {
      const session = await getSession(cmd.port!);
      return navigateForward(session.page);
    }

    case "reload": {
      const session = await getSession(cmd.port!);
      return reload(session.page);
    }

    case "snapshot": {
      const session = await getSession(cmd.port!);
      return snapshot(session.page);
    }

    case "screenshot": {
      const session = await getSession(cmd.port!);
      return screenshot(session.page, cmd.path as string | undefined, !!cmd.fullPage);
    }

    case "click": {
      const session = await getSession(cmd.port!);
      return click(session.page, cmd.uid as string, !!cmd.dblClick);
    }

    case "hover": {
      const session = await getSession(cmd.port!);
      return hover(session.page, cmd.uid as string);
    }

    case "fill": {
      const session = await getSession(cmd.port!);
      return fill(session.page, cmd.uid as string, cmd.value as string);
    }

    case "type": {
      const session = await getSession(cmd.port!);
      return typeText(session.page, cmd.text as string, cmd.submitKey as string | undefined);
    }

    case "press": {
      const session = await getSession(cmd.port!);
      return pressKey(session.page, cmd.key as string);
    }

    case "drag": {
      const session = await getSession(cmd.port!);
      return drag(session.page, cmd.from as string, cmd.to as string);
    }

    case "upload": {
      const session = await getSession(cmd.port!);
      return uploadFile(session.page, cmd.uid as string, cmd.file as string);
    }

    case "eval": {
      const session = await getSession(cmd.port!);
      return evaluate(session.page, cmd.expression as string);
    }

    case "pages": {
      const session = await getSession(cmd.port!);
      return listPages(session.browser);
    }

    case "new-page": {
      const session = await getSession(cmd.port!);
      return newPage(session.browser, cmd.url as string);
    }

    case "close-page": {
      const session = await getSession(cmd.port!);
      return closePage(session.browser, cmd.pageId as number);
    }

    case "select-page": {
      const session = await getSession(cmd.port!);
      await selectPage(session.browser, cmd.pageId as number);
      return JSON.stringify({ selected: cmd.pageId });
    }

    case "emulate": {
      const session = await getSession(cmd.port!);
      return emulate(session.page, {
        viewport: cmd.viewport as { width: number; height: number } | undefined,
        userAgent: cmd.userAgent as string | undefined,
        geolocation: cmd.geolocation as { latitude: number; longitude: number } | undefined,
        colorScheme: cmd.colorScheme as "dark" | "light" | undefined,
      });
    }

    case "wait": {
      const session = await getSession(cmd.port!);
      return waitFor(session.page, cmd.texts as string[], cmd.timeout as number);
    }

    case "dialog": {
      const session = await getSession(cmd.port!);
      return handleDialog(session.page, cmd.dialogAction as "accept" | "dismiss", cmd.promptText as string | undefined);
    }

    case "trace-start": {
      const session = await getSession(cmd.port!);
      return startTrace(session.page, cmd.path as string | undefined);
    }

    case "trace-stop": {
      const session = await getSession(cmd.port!);
      return stopTrace(session.page, cmd.path as string | undefined);
    }

    case "heap-snapshot": {
      const session = await getSession(cmd.port!);
      return takeHeapSnapshot(session.page, cmd.path as string);
    }

    case "network-start": {
      const port = cmd.port!;
      if (networkCaptures.has(port)) {
        throw new Error(`network capture already active on port ${port}`);
      }
      const session = await getSession(port);
      const capture = await startNetworkCapture(session.page);
      networkCaptures.set(port, capture);
      return JSON.stringify({ capturing: true, port });
    }

    case "network-list": {
      const port = cmd.port!;
      const capture = networkCaptures.get(port);
      if (!capture) {
        throw new Error(`no active network capture on port ${port}`);
      }
      return listNetworkEntries(capture.entries, cmd.type as string | undefined);
    }

    case "network-stop": {
      const port = cmd.port!;
      const capture = networkCaptures.get(port);
      if (!capture) {
        throw new Error(`no active network capture on port ${port}`);
      }
      const result = await stopNetworkCapture(capture);
      networkCaptures.delete(port);
      return result;
    }

    case "console-start": {
      const port = cmd.port!;
      if (consoleCaptures.has(port)) {
        throw new Error(`console capture already active on port ${port}`);
      }
      const session = await getSession(port);
      const capture = startConsoleCapture(session.page);
      consoleCaptures.set(port, capture);
      return JSON.stringify({ capturing: true, port });
    }

    case "console-list": {
      const port = cmd.port!;
      const capture = consoleCaptures.get(port);
      if (!capture) {
        throw new Error(`no active console capture on port ${port}`);
      }
      return listConsoleEntries(capture.entries, cmd.type as string | undefined);
    }

    case "console-stop": {
      const port = cmd.port!;
      const capture = consoleCaptures.get(port);
      if (!capture) {
        throw new Error(`no active console capture on port ${port}`);
      }
      const session = await getSession(port);
      const result = stopConsoleCapture(session.page, capture);
      consoleCaptures.delete(port);
      return result;
    }

    case "kill": {
      const port = cmd.port!;
      const session = sessions.get(port);
      if (session) {
        session.browser.disconnect();
        if (session.userDataDir) {
          try { rmSync(session.userDataDir, { recursive: true }); } catch { /* already gone */ }
        }
        sessions.delete(port);
        networkCaptures.delete(port);
        consoleCaptures.delete(port);
      }
      const pid = await findChromePid(port);
      if (pid) {
        process.kill(pid, "SIGTERM");
      }
      if (!session && !pid) {
        throw new Error(`no Chrome found on port ${port}`);
      }
      return JSON.stringify({ killed: port, pid });
    }

    case "kill-all": {
      const entries = Array.from(sessions.entries());
      const killed = await Promise.all(
        entries.map(async ([port, session]) => {
          session.browser.disconnect();
          if (session.userDataDir) {
            try { rmSync(session.userDataDir, { recursive: true }); } catch { /* already gone */ }
          }
          const pid = await findChromePid(port);
          if (pid) {
            process.kill(pid, "SIGTERM");
          }
          return { port, pid };
        }),
      );
      sessions.clear();
      networkCaptures.clear();
      consoleCaptures.clear();
      return JSON.stringify({ killed });
    }

    case "status": {
      const ports = Array.from(sessions.keys());
      return JSON.stringify({ sessions: ports.length, ports });
    }

    case "shutdown": {
      sessions.forEach((s) => s.browser.disconnect());
      sessions.clear();
      setTimeout(() => process.exit(0), 100);
      return JSON.stringify({ shutdown: true });
    }

    default:
      throw new Error(`unknown action: ${cmd.action}`);
  }
};

const start = () => {
  try {
    unlinkSync(SOCKET_PATH);
  } catch {
    // socket doesn't exist yet
  }

  const server = Bun.serve({
    unix: SOCKET_PATH,
    fetch: async (req) => {
      try {
        const cmd = (await req.json()) as Command;
        const result = await handleCommand(cmd);
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
