import {
  launch as launchChrome,
  connect,
  close,
  type Session,
} from "../browser.ts";
import {
  cancel,
  confirm,
  release,
  reserve,
  type Capacity,
} from "../capacity.ts";
import type { NetworkCapture } from "./network.ts";
import type { ConsoleCapture } from "./console.ts";
import { rm } from "node:fs/promises";

export type DaemonState = {
  capacity: Capacity;
  sessions: Map<number, Session>;
  networkCaptures: Map<number, NetworkCapture>;
  consoleCaptures: Map<number, ConsoleCapture>;
};

const startBrowser = async (headless: boolean, capacity: Capacity) => {
  try {
    return await launchChrome(headless);
  } catch (error) {
    cancel(capacity);
    throw error;
  }
};

export const launchSession = async (
  state: DaemonState,
  headless: boolean,
): Promise<Session> => {
  reserve(state.capacity);
  const session = await startBrowser(headless, state.capacity);
  confirm(state.capacity, session.port);
  state.sessions.set(session.port, session);
  return session;
};

export const launchCmd = async (
  state: DaemonState,
  headless: boolean,
): Promise<string> => {
  const session = await launchSession(state, headless);
  return JSON.stringify({ port: session.port });
};

const cleanupSession = async (
  state: DaemonState,
  port: number,
  session: Session,
): Promise<void> => {
  if (session.userDataDir) {
    await rm(session.userDataDir, { recursive: true });
  }
  release(state.capacity, port);
  state.sessions.delete(port);
  state.networkCaptures.delete(port);
  state.consoleCaptures.delete(port);
};

const closeSession = async (
  state: DaemonState,
  port: number,
): Promise<Readonly<{ port: number; pid: number }>> => {
  const session = state.sessions.get(port);
  const browser = session ? session.browser : (await connect(port, "")).browser;
  const pid = await close(browser, port);
  if (session) await cleanupSession(state, port, session);
  return { pid, port };
};

export const killCmd = async (
  state: DaemonState,
  port: number,
): Promise<string> => {
  const { pid } = await closeSession(state, port);
  return JSON.stringify({ killed: port, pid });
};

export const killAllCmd = async (state: DaemonState): Promise<string> => {
  const keys = state.sessions.keys();
  const ports = Array.from(keys);
  const tasks = ports.map((port) => closeSession(state, port));
  const killed = await Promise.all(tasks);
  return JSON.stringify({ killed });
};

export const statusCmd = (state: DaemonState): string => {
  const keys = state.sessions.keys();
  const ports = Array.from(keys);
  return JSON.stringify({ ports, sessions: ports.length });
};

export const shutdownCmd = async (state: DaemonState): Promise<string> => {
  await killAllCmd(state);
  setTimeout(() => process.exit(0), 100);
  return JSON.stringify({ shutdown: true });
};
