import { z } from "zod";
import {
  defineDaemonCommand,
  definePageCommand,
  defineTargetCommand,
  opt,
  req,
  textParam,
  toggle,
} from "../command.ts";
import { targetKey } from "../target.ts";
import type { Page, CDPSession } from "puppeteer-core";

const TRACE_CATEGORIES = [
  "devtools.timeline",
  "v8.execute",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "toplevel",
  "blink.console",
  "blink.user_timing",
  "latencyInfo",
  "disabled-by-default-v8.cpu_profiler",
];

export type TraceCapture = {
  cdpSession: CDPSession;
};

const collectTrace = async (
  client: CDPSession,
  filePath: string | undefined,
): Promise<string> => {
  const chunks: string[] = [];
  client.on("Tracing.dataCollected", (params: { value: unknown[] }) => {
    const serialized = JSON.stringify(params.value);
    chunks.push(serialized);
  });

  await client.send("Tracing.end");
  await new Promise<void>((resolve) => {
    client.on("Tracing.tracingComplete", () => {
      resolve();
    });
  });

  await client.detach();

  const joined = chunks.join(",");
  const traceData = `[${joined}]`;
  if (filePath) {
    await Bun.write(filePath, traceData);
    return JSON.stringify({ saved: filePath });
  }
  return JSON.stringify({ size: traceData.length });
};

const startTrace = async (
  page: Page,
  filePath: string | undefined,
  doReload: boolean,
  autoStop: boolean,
): Promise<{ capture: TraceCapture; result: string }> => {
  const client = await page.createCDPSession();
  await client.send("Tracing.start", {
    traceConfig: {
      enableSampling: true,
      excludedCategories: ["*"],
      includedCategories: TRACE_CATEGORIES,
    },
  });

  if (doReload) {
    await page.reload({ waitUntil: "domcontentloaded" });
  }

  if (autoStop) {
    const result = await collectTrace(client, filePath);
    return { capture: { cdpSession: client }, result };
  }

  return {
    capture: { cdpSession: client },
    result: JSON.stringify({ filePath, tracing: true }),
  };
};

const stopTrace = async (
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
  typeof v === "object" &&
  v !== null &&
  "name" in v &&
  typeof v.name === "string" &&
  "ts" in v &&
  typeof v.ts === "number";

const shiftScore = (args: Record<string, unknown> | undefined): number => {
  const data = args?.["data"];
  if (typeof data !== "object" || data === null) return 0;
  if (!("score" in data)) return 0;
  const dataEntries = Object.entries(data);
  const record: Record<string, unknown> = Object.fromEntries(dataEntries);
  const s = record["score"];
  if (typeof s !== "number") return 0;
  return s;
};

const sumShiftScores = (
  shifts: readonly TraceEvent[],
  start: number,
  end: number,
  total: number,
): number => {
  if (start === end) return total;
  if (end - start === 1) return total + shiftScore(shifts[start]?.args);
  const midpoint = start + Math.floor((end - start) / 2);
  const subtotal = sumShiftScores(shifts, start, midpoint, total);
  return sumShiftScores(shifts, midpoint, end, subtotal);
};

const totalShiftScore = (shifts: readonly TraceEvent[]): number =>
  Math.round(sumShiftScores(shifts, 0, shifts.length, 0) * 10000) / 10000;

const extractInsights = (events: TraceEvent[]): Record<string, unknown> => {
  const navEvent = events.find((e) => e.name === "navigationStart");
  if (!navEvent) throw new Error("no navigationStart event found in trace");
  const toMs = (ts: number) =>
    Math.round(((ts - navEvent.ts) / 1000) * 100) / 100;

  const fcp = events.find((e) => e.name === "firstContentfulPaint");
  const lcp = events
    .filter((e) => e.name === "largestContentfulPaint::Candidate")
    .pop();
  const shifts = events.filter((e) => e.name === "LayoutShift");
  const longTasks = events.filter(
    (e) => e.name === "RunTask" && e.dur !== undefined && e.dur > 50000,
  );

  return {
    cumulativeLayoutShift: { score: totalShiftScore(shifts) },
    firstContentfulPaint: fcp ? { ms: toMs(fcp.ts) } : null,
    largestContentfulPaint: lcp ? { ms: toMs(lcp.ts) } : null,
    longTasks: { count: longTasks.length },
  };
};

const parseTraceEvents = async (filePath: string): Promise<TraceEvent[]> => {
  const raw = await Bun.file(filePath).text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`failed to parse trace file: ${String(err)}`, {
      cause: err,
    });
  }

  const events = (Array.isArray(parsed) ? parsed.flat() : []).filter(
    isTraceEvent,
  );
  if (events.length === 0) throw new Error("no trace events found in file");
  return events;
};

type InsightSet = {
  id: string;
  url: string;
  events: TraceEvent[];
  navTs: number;
};

type InsightName =
  | "DocumentLatency"
  | "LCPBreakdown"
  | "RenderBlocking"
  | "CLSCulprits"
  | "LongTasks";

const AVAILABLE_INSIGHTS: InsightName[] = [
  "DocumentLatency",
  "LCPBreakdown",
  "RenderBlocking",
  "CLSCulprits",
  "LongTasks",
];

const groupByNavigation = (events: TraceEvent[]): InsightSet[] => {
  const navStarts = events
    .map((e, i) => ({ event: e, idx: i }))
    .filter(({ event }) => event.name === "navigationStart");

  return navStarts.map(({ event, idx }, setIdx) => {
    const nextNav = navStarts[setIdx + 1];
    const nextNavIdx = nextNav ? nextNav.idx : events.length;
    const url =
      typeof event.args?.["data"] === "object" &&
      event.args["data"] !== null &&
      "documentLoaderURL" in event.args["data"] &&
      typeof event.args["data"].documentLoaderURL === "string"
        ? event.args["data"].documentLoaderURL
        : "unknown";

    return {
      events: events.slice(idx, nextNavIdx),
      id: `nav-${setIdx}`,
      navTs: event.ts,
      url,
    };
  });
};

const extractDocumentLatency = (
  events: TraceEvent[],
  navTs: number,
): unknown => {
  const toMs = (ts: number) => Math.round(((ts - navTs) / 1000) * 100) / 100;
  const resourceEvents = events.filter(
    (e) =>
      e.name === "ResourceSendRequest" ||
      e.name === "ResourceReceiveResponse" ||
      e.name === "ResourceFinish",
  );

  const docSend = resourceEvents.find(
    (e) =>
      e.name === "ResourceSendRequest" &&
      typeof e.args?.["data"] === "object" &&
      e.args["data"] !== null &&
      "requestMethod" in e.args["data"] &&
      e.args["data"].requestMethod === "GET",
  );
  if (!docSend) return { error: "no document request found" };

  const docReceive = resourceEvents.find(
    (e) => e.name === "ResourceReceiveResponse" && e.ts > docSend.ts,
  );
  const docFinish = resourceEvents.find(
    (e) => e.name === "ResourceFinish" && e.ts > docSend.ts,
  );

  return {
    requestStart: { ms: toMs(docSend.ts) },
    responseComplete: docFinish ? { ms: toMs(docFinish.ts) } : null,
    responseReceived: docReceive ? { ms: toMs(docReceive.ts) } : null,
  };
};

const extractLCPBreakdown = (events: TraceEvent[], navTs: number): unknown => {
  const toMs = (ts: number) => Math.round(((ts - navTs) / 1000) * 100) / 100;

  const fcp = events.find((e) => e.name === "firstContentfulPaint");
  const lcp = events
    .filter((e) => e.name === "largestContentfulPaint::Candidate")
    .pop();
  if (!lcp) return { error: "no LCP event found" };

  const docReceive = events.find((e) => e.name === "ResourceReceiveResponse");
  const ttfb = docReceive ? toMs(docReceive.ts) : null;

  return {
    firstContentfulPaint: fcp ? { ms: toMs(fcp.ts) } : null,
    largestContentfulPaint: { ms: toMs(lcp.ts) },
    ttfb: ttfb !== null ? { ms: ttfb } : null,
  };
};

const extractRenderBlocking = (events: TraceEvent[]): unknown => {
  const blocking = events.filter((e) => {
    if (e.name !== "ResourceSendRequest") return false;
    const data = e.args?.["data"];
    if (typeof data !== "object" || data === null) return false;
    return "renderBlocking" in data && data.renderBlocking === "blocking";
  });

  return {
    count: blocking.length,
    resources: blocking.map((e) => {
      const data = e.args?.["data"];
      const url =
        typeof data === "object" &&
        data !== null &&
        "url" in data &&
        typeof data.url === "string"
          ? data.url
          : "unknown";
      return { url };
    }),
  };
};

const extractCLSCulprits = (events: TraceEvent[], navTs: number): unknown => {
  const toMs = (ts: number) => Math.round(((ts - navTs) / 1000) * 100) / 100;
  const shifts = events.filter((e) => e.name === "LayoutShift");

  return {
    shifts: shifts.map((e) => ({
      score: shiftScore(e.args),
      time: { ms: toMs(e.ts) },
    })),
    totalScore: totalShiftScore(shifts),
  };
};

const extractLongTasks = (events: TraceEvent[], navTs: number): unknown => {
  const toMs = (ts: number) => Math.round(((ts - navTs) / 1000) * 100) / 100;
  const tasks = events.filter(
    (e): e is TraceEvent & { dur: number } =>
      e.name === "RunTask" && e.dur !== undefined && e.dur > 50000,
  );

  return {
    count: tasks.length,
    tasks: tasks.map((e) => ({
      duration: { ms: Math.round((e.dur / 1000) * 100) / 100 },
      start: { ms: toMs(e.ts) },
    })),
  };
};

const INSIGHT_EXTRACTORS: Record<
  string,
  (events: TraceEvent[], navTs: number) => unknown
> = {
  CLSCulprits: extractCLSCulprits,
  DocumentLatency: extractDocumentLatency,
  LCPBreakdown: extractLCPBreakdown,
  LongTasks: extractLongTasks,
  RenderBlocking: extractRenderBlocking,
};

const analyzeTrace = async (filePath: string): Promise<string> => {
  const events = await parseTraceEvents(filePath);
  const sets = groupByNavigation(events);

  const insightSets = sets.map((s) => ({
    id: s.id,
    insights: [...AVAILABLE_INSIGHTS],
    url: s.url,
  }));

  const navEvent = events.find((e) => e.name === "navigationStart");
  if (!navEvent) throw new Error("no navigationStart event found in trace");
  const cwv = extractInsights(events);

  return JSON.stringify({ ...cwv, insightSets });
};

const analyzeInsight = async (
  filePath: string,
  insightSetId: string,
  insightName: string,
): Promise<string> => {
  const events = await parseTraceEvents(filePath);
  const sets = groupByNavigation(events);

  const set = sets.find((s) => s.id === insightSetId);
  if (!set)
    throw new Error(
      `insight set '${insightSetId}' not found, available: ${sets.map((s) => s.id).join(", ")}`,
    );

  const extractor = INSIGHT_EXTRACTORS[insightName];
  if (!extractor)
    throw new Error(
      `unknown insight '${insightName}', available: ${AVAILABLE_INSIGHTS.join(", ")}`,
    );

  return JSON.stringify({
    data: extractor(set.events, set.navTs),
    insight: insightName,
    insightSetId: set.id,
    url: set.url,
  });
};

const takeHeapSnapshot = async (
  page: Page,
  filePath: string,
): Promise<string> => {
  const client = await page.createCDPSession();

  const chunks: string[] = [];
  client.on(
    "HeapProfiler.addHeapSnapshotChunk",
    (params: { chunk: string }) => {
      chunks.push(params.chunk);
    },
  );

  await client.send("HeapProfiler.takeHeapSnapshot", {
    reportProgress: false,
  });

  const heapData = chunks.join("");
  await Bun.write(filePath, heapData);
  await client.detach();

  return JSON.stringify({ saved: filePath });
};

const TraceStartParams = z
  .object({
    autoStop: toggle,
    path: textParam("path").optional(),
    reload: toggle,
  })
  .readonly();

export const traceStartCommand = defineTargetCommand(
  {
    description: "Start a performance trace",
    flags: [
      opt("--path <path>", "save trace to file"),
      opt("--reload", "reload page after starting trace"),
      opt("--auto-stop", "stop trace after page loads"),
    ],
    name: "trace-start",
    toPayload: (o) => ({
      autoStop: !!o["autoStop"],
      path: o["path"],
      reload: !!o["reload"],
    }),
  },
  TraceStartParams,
  async ({ getSession, traceCaptures }, target, { autoStop, path, reload }) => {
    const key = targetKey(target);
    if (traceCaptures.has(key))
      throw new Error(`trace already active on ${key}`);
    const { page } = await getSession(target);
    const { capture, result } = await startTrace(page, path, reload, autoStop);
    if (!autoStop) traceCaptures.set(key, capture);
    return result;
  },
);

const TraceStopParams = z
  .object({ path: textParam("path").optional() })
  .readonly();

export const traceStopCommand = defineTargetCommand(
  {
    description: "Stop the performance trace",
    flags: [opt("--path <path>", "save trace to file")],
    name: "trace-stop",
    toPayload: (o) => ({ path: o["path"] }),
  },
  TraceStopParams,
  async ({ traceCaptures }, target, { path }) => {
    const key = targetKey(target);
    const capture = traceCaptures.get(key);
    if (!capture) throw new Error(`no active trace on ${key}`);
    const result = await stopTrace(capture, path);
    traceCaptures.delete(key);
    return result;
  },
);

const TraceAnalyzeParams = z.object({ path: textParam("path") }).readonly();

export const traceAnalyzeCommand = defineDaemonCommand(
  {
    description: "Analyze a trace file for performance insights",
    flags: [req("--path <path>", "trace file to analyze")],
    name: "trace-analyze",
    toPayload: (o) => ({ path: o["path"] }),
  },
  TraceAnalyzeParams,
  (_, { path }) => analyzeTrace(path),
);

const TraceAnalyzeInsightParams = z
  .object({
    insightName: textParam("insightName"),
    insightSetId: textParam("insightSetId"),
    path: textParam("path"),
  })
  .readonly();

export const traceAnalyzeInsightCommand = defineDaemonCommand(
  {
    description: "Get detailed info on a specific performance insight",
    flags: [
      req("--path <path>", "trace file to analyze"),
      req("--insight-set-id <id>", "insight set ID from trace-analyze output"),
      req(
        "--insight-name <name>",
        "insight name (DocumentLatency, LCPBreakdown, RenderBlocking, CLSCulprits, LongTasks)",
      ),
    ],
    name: "trace-analyze-insight",
    toPayload: (o) => ({
      insightName: o["insightName"],
      insightSetId: o["insightSetId"],
      path: o["path"],
    }),
  },
  TraceAnalyzeInsightParams,
  (_, { path, insightSetId, insightName }) =>
    analyzeInsight(path, insightSetId, insightName),
);

const HeapSnapshotParams = z.object({ path: textParam("path") }).readonly();

export const heapSnapshotCommand = definePageCommand(
  {
    description: "Capture a heap memory snapshot",
    flags: [req("--path <path>", "save .heapsnapshot to file")],
    name: "heap-snapshot",
    toPayload: (o) => ({ path: o["path"] }),
  },
  HeapSnapshotParams,
  (page, { path }) => takeHeapSnapshot(page, path),
);
