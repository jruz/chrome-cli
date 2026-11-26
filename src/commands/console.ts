import { z } from "zod";
import {
  defineTargetCommand,
  noParams,
  numberParam,
  opt,
  req,
  textParam,
  toggle,
} from "../command.ts";
import { targetFields, targetKey } from "../target.ts";
import type { Page, ConsoleMessage } from "puppeteer-core";

const MAX_PRESERVED = 3;

type ConsoleEntry = {
  type: string;
  text: string;
  url: string | undefined;
  lineNumber: number | undefined;
};

export type ConsoleCapture = {
  consoleListener: (msg: ConsoleMessage) => void;
  frameListener: () => void;
  entries: ConsoleEntry[];
  preserved: ConsoleEntry[][];
};

const startCapture = (page: Page): ConsoleCapture => {
  const entries: ConsoleEntry[] = [];
  const preserved: ConsoleEntry[][] = [];

  const consoleListener = (msg: ConsoleMessage) => {
    const location = msg.location();
    entries.push({
      lineNumber: location.lineNumber,
      text: msg.text(),
      type: msg.type(),
      url: location.url,
    });
  };

  const frameListener = () => {
    if (entries.length > 0) {
      preserved.push([...entries]);
      entries.length = 0;
      if (preserved.length > MAX_PRESERVED) {
        preserved.shift();
      }
    }
  };

  page.on("console", consoleListener);
  page.on("framenavigated", frameListener);

  return { consoleListener, entries, frameListener, preserved };
};

const getEntry = (entries: ConsoleEntry[], msgid: number): string => {
  const entry = entries[msgid];
  if (!entry) throw new Error(`console message not found: ${msgid}`);
  return JSON.stringify(entry);
};

const listEntries = (
  capture: ConsoleCapture,
  typeFilter: string | undefined,
  includePreserved: boolean,
  pageIdx: number | undefined,
  pageSize: number | undefined,
): string => {
  const all = includePreserved
    ? [...capture.preserved.flat(), ...capture.entries]
    : capture.entries;

  const filtered = typeFilter ? all.filter((e) => e.type === typeFilter) : all;

  if (pageSize === undefined) return JSON.stringify(filtered);
  if (pageIdx === undefined)
    throw new Error("pageIdx is required when pageSize is set");

  const start = pageIdx * pageSize;
  const page = filtered.slice(start, start + pageSize);
  return JSON.stringify({
    entries: page,
    pageIdx,
    pageSize,
    total: filtered.length,
  });
};

const stopCapture = (page: Page, capture: ConsoleCapture): string => {
  page.off("console", capture.consoleListener);
  page.off("framenavigated", capture.frameListener);
  return JSON.stringify({
    stopped: true,
    totalEntries: capture.entries.length,
  });
};

const ConsoleStartParams = z
  .object({
    includePreserved: toggle,
    pageIdx: numberParam("pageIdx").optional(),
    pageSize: numberParam("pageSize").optional(),
    type: textParam("type").optional(),
  })
  .readonly();

export const consoleStartCommand = defineTargetCommand(
  {
    description: "Start capturing console messages",
    flags: [],
    name: "console-start",
    toPayload: () => ({}),
  },
  noParams,
  async ({ getSession, state }, target) => {
    const key = targetKey(target);
    if (state.consoleCaptures.has(key))
      throw new Error(`console capture already active on ${key}`);
    const { page } = await getSession(target);
    const capture = startCapture(page);
    state.consoleCaptures.set(key, capture);
    return JSON.stringify({ capturing: true, ...targetFields(target) });
  },
);

export const consoleListCommand = defineTargetCommand(
  {
    description: "List captured console messages",
    flags: [
      opt("--type <type>", "filter by message type"),
      opt("--include-preserved", "include messages from last 3 navigations"),
      opt("--page-size <n>", "results per page"),
      opt("--page-idx <n>", "page number (0-based)"),
    ],
    name: "console-list",
    toPayload: (o) => ({
      includePreserved: !!o["includePreserved"],
      pageIdx: o["pageIdx"] ? Number(o["pageIdx"]) : undefined,
      pageSize: o["pageSize"] ? Number(o["pageSize"]) : undefined,
      type: o["type"],
    }),
  },
  ConsoleStartParams,
  ({ state }, target, { includePreserved, pageIdx, pageSize, type }) => {
    const key = targetKey(target);
    const capture = state.consoleCaptures.get(key);
    if (!capture) throw new Error(`no active console capture on ${key}`);
    return listEntries(capture, type, includePreserved, pageIdx, pageSize);
  },
);

const ConsoleGetParams = z.object({ msgid: numberParam("msgid") }).readonly();

export const consoleGetCommand = defineTargetCommand(
  {
    description: "Get a single console message by index",
    flags: [req("--msgid <id>", "message index")],
    name: "console-get",
    toPayload: (o) => ({ msgid: Number(o["msgid"]) }),
  },
  ConsoleGetParams,
  ({ state }, target, { msgid }) => {
    const key = targetKey(target);
    const capture = state.consoleCaptures.get(key);
    if (!capture) throw new Error(`no active console capture on ${key}`);
    return getEntry(capture.entries, msgid);
  },
);

export const consoleStopCommand = defineTargetCommand(
  {
    description: "Stop capturing console messages",
    flags: [],
    name: "console-stop",
    toPayload: () => ({}),
  },
  noParams,
  async ({ getSession, state }, target) => {
    const key = targetKey(target);
    const capture = state.consoleCaptures.get(key);
    if (!capture) throw new Error(`no active console capture on ${key}`);
    const { page } = await getSession(target);
    const result = stopCapture(page, capture);
    state.consoleCaptures.delete(key);
    return result;
  },
);
