import { log } from "./log";
import { isAlive, connect, type Session } from "./browser";
import { commandMap, type DaemonCtx, type Params } from "./registry";
import type { NetworkCapture } from "./commands/network";
import type { ConsoleCapture } from "./commands/console";
import { unlinkSync } from "fs";

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

const ctx: DaemonCtx = {
  sessions,
  networkCaptures,
  consoleCaptures,
  getSession,
  findChromePid,
};

const dispatch = async (params: Params): Promise<string> => {
  const def = commandMap.get(params.action as string);
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
      return def.run(ctx, params);
    }
  }
};

const start = () => {
  try { unlinkSync(SOCKET_PATH); } catch {}

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
