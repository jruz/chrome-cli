import { z } from "zod";
import {
  defineDaemonCommand,
  defineTargetCommand,
  noParams,
  opt,
  toggle,
  type CommandEntry,
} from "../command.ts";

import {
  launch as launchChrome,
  connect,
  close,
  closeOwned,
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
import { expiredKeys, forget, touch, type Activity } from "../activity.ts";
import { log } from "../log.ts";
import {
  targetFields,
  targetKey,
  type Target,
  type TargetFields,
} from "../target.ts";
import type { NetworkCapture } from "./network.ts";
import type { ConsoleCapture } from "./console.ts";
import { rm } from "node:fs/promises";

export type DaemonState = {
  activity: Activity;
  capacity: Capacity;
  sessions: Map<string, Session>;
  networkCaptures: Map<string, NetworkCapture>;
  consoleCaptures: Map<string, ConsoleCapture>;
};

type Closed = TargetFields & { readonly pid: number };

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
  const key = targetKey(session.target);
  confirm(state.capacity, key);
  touch(state.activity, key);
  state.sessions.set(key, session);
  return session;
};

export const launchCmd = async (
  state: DaemonState,
  headless: boolean,
): Promise<string> => {
  const session = await launchSession(state, headless);
  const fields = targetFields(session.target);
  return JSON.stringify(fields);
};

const cleanupSession = async (
  state: DaemonState,
  session: Session,
): Promise<void> => {
  const key = targetKey(session.target);
  if (state.capacity.owned.has(key)) {
    await rm(session.userDataDir, { recursive: true });
  }
  release(state.capacity, key);
  forget(state.activity, key);
  state.sessions.delete(key);
  state.networkCaptures.delete(key);
  state.consoleCaptures.delete(key);
};

const isResponsive = async (session: Session): Promise<boolean> => {
  if (session.target.kind === "session") return session.browser.connected;
  return isAlive(session.target.port);
};

const dropUnresponsive = async (
  state: DaemonState,
  session: Session,
): Promise<never> => {
  const key = targetKey(session.target);
  log.warn(`dead ${key}, removing`);
  if (session.target.kind === "session") await terminate(session.browser);
  else await session.browser.disconnect();
  await cleanupSession(state, session);
  throw new Error(`Chrome on ${key} is not responding, session removed`);
};

const unknownSession = (target: Target): Error =>
  new Error(`unknown ${targetKey(target)}`);

export const sessionFor = async (
  state: DaemonState,
  target: Target,
): Promise<Session> => {
  const key = targetKey(target);
  const existing = state.sessions.get(key);
  if (existing) {
    if (await isResponsive(existing)) return existing;
    return dropUnresponsive(state, existing);
  }
  if (target.kind === "session") throw unknownSession(target);
  const session = await connect(target.port, "");
  state.sessions.set(key, session);
  return session;
};

const closeBrowser = (session: Session): Promise<number> => {
  if (session.target.kind === "session") return closeOwned(session.browser);
  return close(session.browser, session.target.port);
};

const closeUnregistered = async (target: Target): Promise<number> => {
  if (target.kind === "session") throw unknownSession(target);
  const { browser } = await connect(target.port, "");
  return close(browser, target.port);
};

const closeTarget = async (
  state: DaemonState,
  target: Target,
): Promise<Closed> => {
  const key = targetKey(target);
  const session = state.sessions.get(key);
  if (!session) {
    const pid = await closeUnregistered(target);
    return { ...targetFields(target), pid };
  }
  const pid = await closeBrowser(session);
  await cleanupSession(state, session);
  return { ...targetFields(target), pid };
};

export const killCmd = async (
  state: DaemonState,
  target: Target,
): Promise<string> => {
  const killed = await closeTarget(state, target);
  return JSON.stringify({ killed });
};

const closeAll = (
  state: DaemonState,
  sessions: readonly Session[],
): Promise<Closed[]> => {
  const closing = sessions.map(({ target }) => closeTarget(state, target));
  return Promise.all(closing);
};

export const killAllCmd = async (state: DaemonState): Promise<string> => {
  const sessions = [...state.sessions.values()];
  const killed = await closeAll(state, sessions);
  return JSON.stringify({ killed });
};

const registered = (state: DaemonState) => (key: string) => {
  const session = state.sessions.get(key);
  if (!session) throw new Error(`no session registered for ${key}`);
  return session;
};

export const reapIdleCmd = async (state: DaemonState): Promise<string> => {
  const keys = expiredKeys(state.activity, state.capacity.owned);
  const lookup = registered(state);
  const sessions = keys.map(lookup);
  const reaped = await closeAll(state, sessions);
  return JSON.stringify({ reaped });
};

const statusCmd = (state: DaemonState): string => {
  const sessions = [...state.sessions.values()];
  const targets = sessions.map(({ target }) => targetFields(target));
  return JSON.stringify({ sessions: targets.length, targets });
};

const shutdownCmd = async (state: DaemonState): Promise<string> => {
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

export const lifecycleHandlers: readonly CommandEntry[] = [
  ["kill-all", ({ state }) => killAllCmd(state)],
  ["status", ({ state }) => statusCmd(state)],
  ["shutdown", ({ state }) => shutdownCmd(state)],
];

export const shutdownOnSignals = (state: DaemonState): void => {
  const handler = shutdownOnSignal(state);
  process.once("SIGTERM", handler);
  process.once("SIGINT", handler);
};

const LaunchParams = z.object({ headless: toggle }).readonly();

export const launchCommand = defineDaemonCommand(
  {
    description: "Launch a new Chrome instance",
    flags: [opt("--headed", "launch with visible window")],
    name: "launch",
    toPayload: (o) => ({ headless: !o["headed"] }),
  },
  LaunchParams,
  ({ state }, { headless }) => launchCmd(state, headless),
);

export const killCommand = defineTargetCommand(
  {
    description: "Kill a Chrome instance by session or port",
    flags: [],
    name: "kill",
    toPayload: () => ({}),
  },
  noParams,
  ({ state }, target) => killCmd(state, target),
);
