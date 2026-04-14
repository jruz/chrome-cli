import { launch as launchChrome, connect, findChromePid, type Session } from "../browser";
import type { NetworkCapture } from "./network";
import type { ConsoleCapture } from "./console";
import { rmSync } from "fs";
import { log } from "../log";

export type DaemonState = {
  sessions: Map<number, Session>;
  networkCaptures: Map<number, NetworkCapture>;
  consoleCaptures: Map<number, ConsoleCapture>;
};

export const launchCmd = async (state: DaemonState, headless: boolean): Promise<string> => {
  const { port, userDataDir } = await launchChrome(headless);
  const session = await connect(port, userDataDir);
  state.sessions.set(port, session);
  return JSON.stringify({ port });
};

const cleanupSession = async (
  state: DaemonState,
  port: number,
  session: Session,
): Promise<void> => {
  await session.browser.disconnect();
  if (session.userDataDir) {
    try {
      rmSync(session.userDataDir, { recursive: true });
    } catch (err) {
      log.warn(`failed to remove user data dir: ${String(err)}`);
    }
  }
  state.sessions.delete(port);
  state.networkCaptures.delete(port);
  state.consoleCaptures.delete(port);
};

export const killCmd = async (state: DaemonState, port: number): Promise<string> => {
  const session = state.sessions.get(port);
  const pid = await findChromePid(port);
  if (!session && !pid) throw new Error(`no Chrome found on port ${port}`);

  setTimeout(() => {
    const cleanup = async () => {
      if (session) await cleanupSession(state, port, session);
      if (pid) process.kill(pid, "SIGTERM");
    };
    cleanup().catch((err: unknown) => {
      log.warn(`kill cleanup failed for port ${port}: ${String(err)}`);
    });
  }, 50);

  return JSON.stringify({ killed: port, pid });
};

export const killAllCmd = async (state: DaemonState): Promise<string> => {
  const sessionEntries = state.sessions.entries();
  const entries = Array.from(sessionEntries);
  const mapped = entries.map(async ([port, session]) => {
      const pid = await findChromePid(port);
      await cleanupSession(state, port, session);
      if (pid) process.kill(pid, "SIGTERM");
      return { port, pid };
    });
  const killed = await Promise.all(mapped);
  return JSON.stringify({ killed });
};

export const statusCmd = (state: DaemonState): string => {
  const keys = state.sessions.keys();
  const ports = Array.from(keys);
  return JSON.stringify({ sessions: ports.length, ports });
};

export const shutdownCmd = async (state: DaemonState): Promise<string> => {
  const sessionEntries = state.sessions.entries();
  const entries = Array.from(sessionEntries);
  const tasks = entries.map(async ([port, session]) => {
      await cleanupSession(state, port, session);
      const pid = await findChromePid(port);
      if (pid) process.kill(pid, "SIGTERM");
    });
  await Promise.all(tasks);
  setTimeout(() => process.exit(0), 100);
  return JSON.stringify({ shutdown: true });
};
