import {
  launch as launchChrome,
  connect,
  close,
  isAlive,
  terminate,
  type Session,
} from "../browser.ts";
import {
  cancel,
  confirm,
  release,
  reserve,
  type Capacity,
} from "../capacity.ts";
import { expiredPorts, forget, touch, type Activity } from "../activity.ts";
import { log } from "../log.ts";
import type { NetworkCapture } from "./network.ts";
import type { ConsoleCapture } from "./console.ts";
import { rm } from "node:fs/promises";

export type DaemonState = {
  activity: Activity;
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
  touch(state.activity, session.port);
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
  if (state.capacity.owned.has(port)) {
    await rm(session.userDataDir, { recursive: true });
  }
  release(state.capacity, port);
  forget(state.activity, port);
  state.sessions.delete(port);
  state.networkCaptures.delete(port);
  state.consoleCaptures.delete(port);
};

const dropUnresponsive = async (
  state: DaemonState,
  port: number,
  session: Session,
): Promise<never> => {
  log.warn(`dead session on port ${port}, removing`);
  if (state.capacity.owned.has(port)) await terminate(session.browser);
  else await session.browser.disconnect();
  await cleanupSession(state, port, session);
  throw new Error(`Chrome on port ${port} is not responding, session removed`);
};

export const sessionFor = async (
  state: DaemonState,
  port: number,
): Promise<Session> => {
  const existing = state.sessions.get(port);
  if (existing) {
    if (await isAlive(port)) return existing;
    return dropUnresponsive(state, port, existing);
  }
  const session = await connect(port, "");
  state.sessions.set(port, session);
  return session;
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

export const reapIdleCmd = async (state: DaemonState): Promise<string> => {
  const ports = expiredPorts(state.activity, state.capacity.owned);
  const tasks = ports.map((port) => closeSession(state, port));
  const reaped = await Promise.all(tasks);
  return JSON.stringify({ reaped });
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

const shutdownOnSignal = (state: DaemonState) => (signal: NodeJS.Signals) => {
  log.info(`received ${signal}, shutting down`);
  shutdownCmd(state).catch((error: unknown) => {
    log.error(`shutdown after ${signal} failed: ${String(error)}`);
    process.exit(1);
  });
};

export const shutdownOnSignals = (state: DaemonState): void => {
  const handler = shutdownOnSignal(state);
  process.once("SIGTERM", handler);
  process.once("SIGINT", handler);
};
