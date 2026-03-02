import type { Page } from "puppeteer-core";

export const startTrace = async (
  page: Page,
  filePath: string | undefined,
): Promise<string> => {
  const client = await page.createCDPSession();
  await client.send("Tracing.start", {
    categories: "-*,devtools.timeline,v8.execute,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,toplevel,blink.console,blink.user_timing,latencyInfo,disabled-by-default-v8.cpu_profiler",
    options: "sampling-frequency=10000",
  });
  return JSON.stringify({ tracing: true, filePath });
};

export const stopTrace = async (
  page: Page,
  filePath: string | undefined,
): Promise<string> => {
  const client = await page.createCDPSession();

  const chunks: string[] = [];
  client.on("Tracing.dataCollected", (params: any) => {
    chunks.push(JSON.stringify(params.value));
  });

  await client.send("Tracing.end");
  await new Promise<void>((resolve) => {
    client.on("Tracing.tracingComplete", () => resolve());
  });

  const traceData = `[${chunks.join(",")}]`;
  if (filePath) {
    await Bun.write(filePath, traceData);
    return JSON.stringify({ saved: filePath });
  }
  return JSON.stringify({ size: traceData.length });
};

export const takeHeapSnapshot = async (
  page: Page,
  filePath: string,
): Promise<string> => {
  const client = await page.createCDPSession();

  const chunks: string[] = [];
  client.on("HeapProfiler.addHeapSnapshotChunk", (params: any) => {
    chunks.push(params.chunk);
  });

  await client.send("HeapProfiler.takeHeapSnapshot", {
    reportProgress: false,
  });

  await Bun.write(filePath, chunks.join(""));
  await client.detach();

  return JSON.stringify({ saved: filePath });
};
