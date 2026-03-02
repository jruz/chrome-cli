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

const cleanupSession = (
  state: DaemonState,
  port: number,
  session: Session,
): void => {
  session.browser.disconnect();
  if (session.userDataDir) {
    try {
      rmSync(session.userDataDir, { recursive: true });
    } catch (err) {
      log.warn(`failed to remove user data dir: ${err}`);
    }
  }
  state.sessions.delete(port);
  state.networkCaptures.delete(port);
  state.consoleCaptures.delete(port);
};

export const killCmd = async (state: DaemonState, port: number): Promise<string> => {
  const session = state.sessions.get(port);
  const pid = await findChromePid(port);
  if (session) cleanupSession(state, port, session);
  if (pid) process.kill(pid, "SIGTERM");
  if (!session && !pid) throw new Error(`no Chrome found on port ${port}`);
  return JSON.stringify({ killed: port, pid });
};

export const killAllCmd = async (state: DaemonState): Promise<string> => {
  const entries = Array.from(state.sessions.entries());
  const killed = await Promise.all(
    entries.map(async ([port, session]) => {
      const pid = await findChromePid(port);
      cleanupSession(state, port, session);
      if (pid) process.kill(pid, "SIGTERM");
      return { port, pid };
    }),
  );
  return JSON.stringify({ killed });
};

export const statusCmd = async (state: DaemonState): Promise<string> => {
  const ports = Array.from(state.sessions.keys());
  return JSON.stringify({ sessions: ports.length, ports });
};

export const shutdownCmd = async (state: DaemonState): Promise<string> => {
  const entries = Array.from(state.sessions.entries());
  await Promise.all(
    entries.map(async ([port, session]) => {
      cleanupSession(state, port, session);
      const pid = await findChromePid(port);
      if (pid) process.kill(pid, "SIGTERM");
    }),
  );
  setTimeout(() => process.exit(0), 100);
  return JSON.stringify({ shutdown: true });
};
