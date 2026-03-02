import type { Page, ConsoleMessage } from "puppeteer-core";

export type ConsoleEntry = {
  type: string;
  text: string;
  url: string | null;
  lineNumber: number | null;
};

export type ConsoleCapture = {
  listener: (msg: ConsoleMessage) => void;
  entries: ConsoleEntry[];
};

export const startCapture = (page: Page): ConsoleCapture => {
  const entries: ConsoleEntry[] = [];

  const listener = (msg: ConsoleMessage) => {
    const location = msg.location();
    entries.push({
      type: msg.type(),
      text: msg.text(),
      url: location.url ?? null,
      lineNumber: location.lineNumber ?? null,
    });
  };

  page.on("console", listener);

  return { listener, entries };
};

export const listEntries = (
  entries: ConsoleEntry[],
  typeFilter: string | undefined,
): string => {
  const filtered = typeFilter
    ? entries.filter((e) => e.type === typeFilter)
    : entries;
  return JSON.stringify(filtered);
};

export const stopCapture = (page: Page, capture: ConsoleCapture): string => {
  page.off("console", capture.listener);
  return JSON.stringify({ stopped: true, totalEntries: capture.entries.length });
};
