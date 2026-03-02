import type { Page, CDPSession } from "puppeteer-core";

const TRACE_CATEGORIES = "-*,devtools.timeline,v8.execute,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,toplevel,blink.console,blink.user_timing,latencyInfo,disabled-by-default-v8.cpu_profiler";

export type TraceCapture = {
  cdpSession: CDPSession;
};

const collectTrace = async (
  client: CDPSession,
  filePath: string | undefined,
): Promise<string> => {
  const chunks: string[] = [];
  client.on("Tracing.dataCollected", (params: { value: unknown[] }) => {
    chunks.push(JSON.stringify(params.value));
  });

  await client.send("Tracing.end");
  await new Promise<void>((resolve) => {
    client.on("Tracing.tracingComplete", () => { resolve(); });
  });

  await client.detach();

  const traceData = `[${chunks.join(",")}]`;
  if (filePath) {
    await Bun.write(filePath, traceData);
    return JSON.stringify({ saved: filePath });
  }
  return JSON.stringify({ size: traceData.length });
};

export const startTrace = async (
  page: Page,
  filePath: string | undefined,
  doReload: boolean,
  autoStop: boolean,
): Promise<{ capture: TraceCapture; result: string }> => {
  const client = await page.createCDPSession();
  await client.send("Tracing.start", {
    categories: TRACE_CATEGORIES,
    options: "sampling-frequency=10000",
  });

  if (doReload) {
    await page.reload({ waitUntil: "domcontentloaded" });
  }

  if (autoStop) {
    const result = await collectTrace(client, filePath);
    return { capture: { cdpSession: client }, result };
  }

  return { capture: { cdpSession: client }, result: JSON.stringify({ tracing: true, filePath }) };
};

export const stopTrace = async (
  capture: TraceCapture,
  filePath: string | undefined,
): Promise<string> => collectTrace(capture.cdpSession, filePath);

type TraceEvent = {
  name: string;
  cat: string;
  ph: string;
  ts: number;
  dur?: number;
  args?: Record<string, unknown>;
};

const isTraceEvent = (v: unknown): v is TraceEvent =>
  typeof v === "object" && v !== null &&
  "name" in v && typeof v.name === "string" &&
  "ts" in v && typeof v.ts === "number";

const shiftScore = (args: Record<string, unknown> | undefined): number => {
  const data = args?.['data'];
  if (typeof data !== "object" || data === null) return 0;
  if (!("score" in data)) return 0;
  const record: Record<string, unknown> = Object.fromEntries(Object.entries(data));
  const s = record['score'];
  if (typeof s !== "number") return 0;
  return s;
};

const extractInsights = (events: TraceEvent[]): Record<string, unknown> => {
  const navEvent = events.find((e) => e.name === "navigationStart");
  if (!navEvent) throw new Error("no navigationStart event found in trace");
  const toMs = (ts: number) => Math.round((ts - navEvent.ts) / 1000 * 100) / 100;

  const fcp = events.find((e) => e.name === "firstContentfulPaint");
  const lcp = events.filter((e) => e.name === "largestContentfulPaint::Candidate").pop();
  const shifts = events.filter((e) => e.name === "LayoutShift");
  const cls = shifts.reduce((sum, e) => sum + shiftScore(e.args), 0);
  const longTasks = events.filter((e) => e.name === "RunTask" && e.dur !== undefined && e.dur > 50000);

  return {
    firstContentfulPaint: fcp ? { ms: toMs(fcp.ts) } : null,
    largestContentfulPaint: lcp ? { ms: toMs(lcp.ts) } : null,
    cumulativeLayoutShift: { score: Math.round(cls * 10000) / 10000 },
    longTasks: { count: longTasks.length },
  };
};

export const analyzeTrace = async (
  filePath: string,
): Promise<string> => {
  const raw = await Bun.file(filePath).text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`failed to parse trace file: ${String(err)}`, { cause: err });
  }

  const events = (Array.isArray(parsed) ? parsed.flat() : []).filter(isTraceEvent);
  if (events.length === 0) throw new Error("no trace events found in file");

  return JSON.stringify(extractInsights(events));
};

export const takeHeapSnapshot = async (
  page: Page,
  filePath: string,
): Promise<string> => {
  const client = await page.createCDPSession();

  const chunks: string[] = [];
  client.on("HeapProfiler.addHeapSnapshotChunk", (params: { chunk: string }) => {
    chunks.push(params.chunk);
  });

  await client.send("HeapProfiler.takeHeapSnapshot", {
    reportProgress: false,
  });

  await Bun.write(filePath, chunks.join(""));
  await client.detach();

  return JSON.stringify({ saved: filePath });
};
