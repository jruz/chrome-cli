import { log } from "./src/log";
import { connect } from "./src/browser";
import { ensureDaemon, send } from "./src/client";
import { navigate } from "./src/commands/navigate";
import { snapshot } from "./src/commands/snapshot";
import { screenshot } from "./src/commands/snapshot";
import { evaluate } from "./src/commands/evaluate";

const RUNS = 5;
const TARGET_URL = "https://example.com";

type BenchResult = {
  operation: string;
  method: string;
  times: number[];
  avg: number;
  min: number;
  max: number;
};

const timeOp = async (fn: () => Promise<unknown>): Promise<number[]> => {
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  return times;
};

const stats = (operation: string, method: string, times: number[]): BenchResult => ({
  operation,
  method,
  times: times.map((t) => Math.round(t)),
  avg: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
  min: Math.round(Math.min(...times)),
  max: Math.round(Math.max(...times)),
});

const runCli = async (args: string): Promise<number[]> => {
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    const proc = Bun.spawn(["bun", "run", "cli.ts", ...args.split(" ")], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    times.push(performance.now() - start);
  }
  return times;
};

const main = async () => {
  await ensureDaemon();
  const portStr = await send({ action: "launch", headless: true });
  let parsed: unknown;
  try {
    parsed = JSON.parse(portStr);
  } catch (err) {
    log.error(`failed to parse launch response: ${portStr} (${String(err)})`);
    process.exit(1);
  }
  if (typeof parsed !== "object" || parsed === null || !("port" in parsed) || typeof parsed.port !== "number") {
    log.error(`unexpected launch response: ${portStr}`);
    process.exit(1);
  }
  const port = parsed.port;

  await send({ action: "navigate", port, url: TARGET_URL, timeout: 30000 });

  const results: BenchResult[] = [];

  // --- CLI (subprocess → daemon) benchmarks ---

  results.push(stats("navigate", "cli", await runCli(`navigate --port ${port} --url ${TARGET_URL} --timeout 30000`)));
  results.push(stats("snapshot", "cli", await runCli(`snapshot --port ${port}`)));
  results.push(stats("screenshot", "cli", await runCli(`screenshot --port ${port} --path /tmp/bench-shot.png`)));
  results.push(stats("eval", "cli", await runCli(`eval --port ${port} --expression document.title`)));
  results.push(stats("pages", "cli", await runCli(`pages --port ${port}`)));

  // --- Daemon (in-process Unix socket) benchmarks ---

  results.push(stats("navigate", "daemon", await timeOp(() => send({ action: "navigate", port, url: TARGET_URL, timeout: 30000 }))));
  results.push(stats("snapshot", "daemon", await timeOp(() => send({ action: "snapshot", port }))));
  results.push(stats("screenshot", "daemon", await timeOp(() => send({ action: "screenshot", port, path: "/tmp/bench-shot-d.png" }))));
  results.push(stats("eval", "daemon", await timeOp(() => send({ action: "eval", port, expression: "document.title" }))));
  results.push(stats("pages", "daemon", await timeOp(() => send({ action: "pages", port }))));

  // --- Raw puppeteer (in-process) benchmarks ---

  const session = await connect(port, "");

  results.push(stats("navigate", "raw-cdp", await timeOp(() => navigate(session.page, TARGET_URL, 30000, undefined, undefined))));
  results.push(stats("snapshot", "raw-cdp", await timeOp(() => snapshot(session.page, false, undefined))));
  results.push(stats("screenshot", "raw-cdp", await timeOp(() => screenshot(session.page, "/tmp/bench-shot-raw.png", false, "png", undefined, undefined))));
  results.push(stats("eval", "raw-cdp", await timeOp(() => evaluate(session.page, "document.title", undefined))));
  results.push(stats("pages", "raw-cdp", await timeOp(async () => {
    const pages = await session.browser.pages();
    await Promise.all(pages.map(async (p, i) => ({ id: i, url: p.url(), title: await p.title() })));
  })));

  await session.browser.disconnect();

  const pad = (s: string, n: number) => s.padEnd(n);
  const rpad = (s: string, n: number) => s.padStart(n);

  const header = `${pad("operation", 12)} ${pad("method", 10)} ${rpad("avg", 6)} ${rpad("min", 6)} ${rpad("max", 6)}  (ms)`;
  const separator = `${"-".repeat(12)} ${"-".repeat(10)} ${"-".repeat(6)} ${"-".repeat(6)} ${"-".repeat(6)}`;
  const rows = results.map((r) =>
    `${pad(r.operation, 12)} ${pad(r.method, 10)} ${rpad(String(r.avg), 6)} ${rpad(String(r.min), 6)} ${rpad(String(r.max), 6)}`
  );

  const output = [
    "",
    header,
    separator,
    ...rows,
    "",
    `runs: ${RUNS}, url: ${TARGET_URL}`,
    `cli = subprocess → daemon → CDP`,
    `daemon = in-process → Unix socket → daemon → CDP`,
    `raw-cdp = in-process → CDP (baseline)`,
    "",
  ].join("\n");

  log.info(output);

  const proc = Bun.spawn(["pkill", "-f", `remote-debugging-port=${port}`]);
  await proc.exited;
};

void main();
