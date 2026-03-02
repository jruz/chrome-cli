import { log } from "./log";
import { launch, connect, type Session } from "./browser";
import { navigate, navigateBack, navigateForward, reload } from "./commands/navigate";
import { snapshot, screenshot } from "./commands/snapshot";
import { click, hover, fill, typeText, pressKey, drag, uploadFile } from "./commands/interact";
import { evaluate } from "./commands/evaluate";
import { listPages, newPage, closePage, selectPage } from "./commands/page";
import { emulate } from "./commands/emulate";
import { waitFor, handleDialog } from "./commands/wait";
import { startTrace, stopTrace, takeHeapSnapshot } from "./commands/performance";
import { unlinkSync } from "fs";

const SOCKET_PATH = "/tmp/chrome-cli.sock";

const sessions = new Map<number, Session>();

const getSession = async (port: number): Promise<Session> => {
  const existing = sessions.get(port);
  if (existing) return existing;
  const session = await connect(port);
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
      const { port } = await launch(!!cmd.headless);
      const session = await connect(port);
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

    case "kill": {
      const port = cmd.port!;
      const session = sessions.get(port);
      if (session) {
        session.browser.disconnect();
        sessions.delete(port);
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
      const killed: { port: number; pid: number | null }[] = [];
      for (const [port, session] of sessions) {
        session.browser.disconnect();
        const pid = await findChromePid(port);
        if (pid) {
          process.kill(pid, "SIGTERM");
        }
        killed.push({ port, pid });
      }
      sessions.clear();
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
