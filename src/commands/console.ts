import type { Page, ConsoleMessage } from "puppeteer-core";

const MAX_PRESERVED = 3;

export type ConsoleEntry = {
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

export const startCapture = (page: Page): ConsoleCapture => {
  const entries: ConsoleEntry[] = [];
  const preserved: ConsoleEntry[][] = [];

  const consoleListener = (msg: ConsoleMessage) => {
    const location = msg.location();
    entries.push({
      type: msg.type(),
      text: msg.text(),
      url: location.url,
      lineNumber: location.lineNumber,
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

  return { consoleListener, frameListener, entries, preserved };
};

export const getEntry = (
  entries: ConsoleEntry[],
  msgid: number,
): string => {
  const entry = entries[msgid];
  if (!entry) throw new Error(`console message not found: ${msgid}`);
  return JSON.stringify(entry);
};

export const listEntries = (
  capture: ConsoleCapture,
  typeFilter: string | undefined,
  includePreserved: boolean,
  pageIdx: number | undefined,
  pageSize: number | undefined,
): string => {
  const all = includePreserved
    ? [...capture.preserved.flat(), ...capture.entries]
    : capture.entries;

  const filtered = typeFilter
    ? all.filter((e) => e.type === typeFilter)
    : all;

  if (pageSize === undefined) return JSON.stringify(filtered);
  if (pageIdx === undefined) throw new Error("pageIdx is required when pageSize is set");

  const start = pageIdx * pageSize;
  const page = filtered.slice(start, start + pageSize);
  return JSON.stringify({ entries: page, total: filtered.length, pageIdx, pageSize });
};

export const stopCapture = (page: Page, capture: ConsoleCapture): string => {
  page.off("console", capture.consoleListener);
  page.off("framenavigated", capture.frameListener);
  return JSON.stringify({ stopped: true, totalEntries: capture.entries.length });
};
