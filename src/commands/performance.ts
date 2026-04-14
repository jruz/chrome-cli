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
    const serialized = JSON.stringify(params.value);
    chunks.push(serialized);
  });

  await client.send("Tracing.end");
  await new Promise<void>((resolve) => {
    client.on("Tracing.tracingComplete", () => { resolve(); });
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
  const dataEntries = Object.entries(data);
  const record: Record<string, unknown> = Object.fromEntries(dataEntries);
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

const parseTraceEvents = async (filePath: string): Promise<TraceEvent[]> => {
  const raw = await Bun.file(filePath).text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`failed to parse trace file: ${String(err)}`, { cause: err });
  }

  const events = (Array.isArray(parsed) ? parsed.flat() : []).filter(isTraceEvent);
  if (events.length === 0) throw new Error("no trace events found in file");
  return events;
};

type InsightSet = {
  id: string;
  url: string;
  events: TraceEvent[];
  navTs: number;
};

type InsightName = "DocumentLatency" | "LCPBreakdown" | "RenderBlocking" | "CLSCulprits" | "LongTasks";

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
    const url = typeof event.args?.['data'] === "object" && event.args['data'] !== null &&
      "documentLoaderURL" in event.args['data'] &&
      typeof event.args['data'].documentLoaderURL === "string"
      ? event.args['data'].documentLoaderURL
      : "unknown";

    return {
      id: `nav-${setIdx}`,
      url,
      events: events.slice(idx, nextNavIdx),
      navTs: event.ts,
    };
  });
};

const extractDocumentLatency = (events: TraceEvent[], navTs: number): unknown => {
  const toMs = (ts: number) => Math.round((ts - navTs) / 1000 * 100) / 100;
  const resourceEvents = events.filter((e) =>
    e.name === "ResourceSendRequest" || e.name === "ResourceReceiveResponse" || e.name === "ResourceFinish"
  );

  const docSend = resourceEvents.find((e) =>
    e.name === "ResourceSendRequest" && typeof e.args?.['data'] === "object" && e.args['data'] !== null &&
    "requestMethod" in e.args['data'] && e.args['data'].requestMethod === "GET"
  );
  if (!docSend) return { error: "no document request found" };

  const docReceive = resourceEvents.find((e) => e.name === "ResourceReceiveResponse" && e.ts > docSend.ts);
  const docFinish = resourceEvents.find((e) => e.name === "ResourceFinish" && e.ts > docSend.ts);

  return {
    requestStart: { ms: toMs(docSend.ts) },
    responseReceived: docReceive ? { ms: toMs(docReceive.ts) } : null,
    responseComplete: docFinish ? { ms: toMs(docFinish.ts) } : null,
  };
};

const extractLCPBreakdown = (events: TraceEvent[], navTs: number): unknown => {
  const toMs = (ts: number) => Math.round((ts - navTs) / 1000 * 100) / 100;

  const fcp = events.find((e) => e.name === "firstContentfulPaint");
  const lcp = events.filter((e) => e.name === "largestContentfulPaint::Candidate").pop();
  if (!lcp) return { error: "no LCP event found" };

  const docReceive = events.find((e) => e.name === "ResourceReceiveResponse");
  const ttfb = docReceive ? toMs(docReceive.ts) : null;

  return {
    ttfb: ttfb !== null ? { ms: ttfb } : null,
    firstContentfulPaint: fcp ? { ms: toMs(fcp.ts) } : null,
    largestContentfulPaint: { ms: toMs(lcp.ts) },
  };
};

const extractRenderBlocking = (events: TraceEvent[]): unknown => {
  const blocking = events.filter((e) => {
    if (e.name !== "ResourceSendRequest") return false;
    const data = e.args?.['data'];
    if (typeof data !== "object" || data === null) return false;
    return "renderBlocking" in data && data.renderBlocking === "blocking";
  });

  return {
    count: blocking.length,
    resources: blocking.map((e) => {
      const data = e.args?.['data'];
      const url = typeof data === "object" && data !== null && "url" in data && typeof data.url === "string"
        ? data.url
        : "unknown";
      return { url };
    }),
  };
};

const extractCLSCulprits = (events: TraceEvent[], navTs: number): unknown => {
  const toMs = (ts: number) => Math.round((ts - navTs) / 1000 * 100) / 100;
  const shifts = events.filter((e) => e.name === "LayoutShift");

  return {
    totalScore: Math.round(shifts.reduce((s, e) => s + shiftScore(e.args), 0) * 10000) / 10000,
    shifts: shifts.map((e) => ({
      time: { ms: toMs(e.ts) },
      score: shiftScore(e.args),
    })),
  };
};

const extractLongTasks = (events: TraceEvent[], navTs: number): unknown => {
  const toMs = (ts: number) => Math.round((ts - navTs) / 1000 * 100) / 100;
  const tasks = events
    .filter((e): e is TraceEvent & { dur: number } => e.name === "RunTask" && e.dur !== undefined && e.dur > 50000);

  return {
    count: tasks.length,
    tasks: tasks.map((e) => ({
      start: { ms: toMs(e.ts) },
      duration: { ms: Math.round(e.dur / 1000 * 100) / 100 },
    })),
  };
};

const INSIGHT_EXTRACTORS: Record<string, (events: TraceEvent[], navTs: number) => unknown> = {
  DocumentLatency: extractDocumentLatency,
  LCPBreakdown: extractLCPBreakdown,
  RenderBlocking: extractRenderBlocking,
  CLSCulprits: extractCLSCulprits,
  LongTasks: extractLongTasks,
};

export const analyzeTrace = async (
  filePath: string,
): Promise<string> => {
  const events = await parseTraceEvents(filePath);
  const sets = groupByNavigation(events);

  const insightSets = sets.map((s) => ({
    id: s.id,
    url: s.url,
    insights: [...AVAILABLE_INSIGHTS],
  }));

  const navEvent = events.find((e) => e.name === "navigationStart");
  if (!navEvent) throw new Error("no navigationStart event found in trace");
  const cwv = extractInsights(events);

  return JSON.stringify({ ...cwv, insightSets });
};

export const analyzeInsight = async (
  filePath: string,
  insightSetId: string,
  insightName: string,
): Promise<string> => {
  const events = await parseTraceEvents(filePath);
  const sets = groupByNavigation(events);

  const set = sets.find((s) => s.id === insightSetId);
  if (!set) throw new Error(`insight set '${insightSetId}' not found, available: ${sets.map((s) => s.id).join(", ")}`);

  const extractor = INSIGHT_EXTRACTORS[insightName];
  if (!extractor) throw new Error(`unknown insight '${insightName}', available: ${AVAILABLE_INSIGHTS.join(", ")}`);

  return JSON.stringify({
    insightSetId: set.id,
    url: set.url,
    insight: insightName,
    data: extractor(set.events, set.navTs),
  });
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

  const heapData = chunks.join("");
  await Bun.write(filePath, heapData);
  await client.detach();

  return JSON.stringify({ saved: filePath });
};
