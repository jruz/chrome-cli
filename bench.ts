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

const stats = (operation: string, method: string, times: number[]): BenchResult => {
  const minVal = Math.min(...times);
  const maxVal = Math.max(...times);
  return {
    operation,
    method,
    times: times.map((t) => Math.round(t)),
    avg: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
    min: Math.round(minVal),
    max: Math.round(maxVal),
  };
};

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

  const cliNav = await runCli(`navigate --port ${port} --url ${TARGET_URL} --timeout 30000`);
  const cliNavStats = stats("navigate", "cli", cliNav);
  results.push(cliNavStats);
  const cliSnap = await runCli(`snapshot --port ${port}`);
  const cliSnapStats = stats("snapshot", "cli", cliSnap);
  results.push(cliSnapStats);
  const cliShot = await runCli(`screenshot --port ${port} --path /tmp/bench-shot.png`);
  const cliShotStats = stats("screenshot", "cli", cliShot);
  results.push(cliShotStats);
  const cliEval = await runCli(`eval --port ${port} --expression document.title`);
  const cliEvalStats = stats("eval", "cli", cliEval);
  results.push(cliEvalStats);
  const cliPages = await runCli(`pages --port ${port}`);
  const cliPagesStats = stats("pages", "cli", cliPages);
  results.push(cliPagesStats);

  // --- Daemon (in-process Unix socket) benchmarks ---

  const daemonNav = await timeOp(() => send({ action: "navigate", port, url: TARGET_URL, timeout: 30000 }));
  const daemonNavStats = stats("navigate", "daemon", daemonNav);
  results.push(daemonNavStats);
  const daemonSnap = await timeOp(() => send({ action: "snapshot", port }));
  const daemonSnapStats = stats("snapshot", "daemon", daemonSnap);
  results.push(daemonSnapStats);
  const daemonShot = await timeOp(() => send({ action: "screenshot", port, path: "/tmp/bench-shot-d.png" }));
  const daemonShotStats = stats("screenshot", "daemon", daemonShot);
  results.push(daemonShotStats);
  const daemonEval = await timeOp(() => send({ action: "eval", port, expression: "document.title" }));
  const daemonEvalStats = stats("eval", "daemon", daemonEval);
  results.push(daemonEvalStats);
  const daemonPages = await timeOp(() => send({ action: "pages", port }));
  const daemonPagesStats = stats("pages", "daemon", daemonPages);
  results.push(daemonPagesStats);

  // --- Raw puppeteer (in-process) benchmarks ---

  const session = await connect(port, "");

  const rawNav = await timeOp(() => navigate(session.page, TARGET_URL, 30000, undefined, undefined));
  const rawNavStats = stats("navigate", "raw-cdp", rawNav);
  results.push(rawNavStats);
  const rawSnap = await timeOp(() => snapshot(session.page, false, undefined));
  const rawSnapStats = stats("snapshot", "raw-cdp", rawSnap);
  results.push(rawSnapStats);
  const rawShot = await timeOp(() => screenshot(session.page, "/tmp/bench-shot-raw.png", false, "png", undefined, undefined));
  const rawShotStats = stats("screenshot", "raw-cdp", rawShot);
  results.push(rawShotStats);
  const rawEval = await timeOp(() => evaluate(session.page, "document.title", undefined));
  const rawEvalStats = stats("eval", "raw-cdp", rawEval);
  results.push(rawEvalStats);
  const rawPages = await timeOp(async () => {
    const pages = await session.browser.pages();
    const mapped = pages.map(async (p, i) => ({ id: i, url: p.url(), title: await p.title() }));
    await Promise.all(mapped);
  });
  const rawPagesStats = stats("pages", "raw-cdp", rawPages);
  results.push(rawPagesStats);

  await session.browser.disconnect();

  const pad = (s: string, n: number) => s.padEnd(n);
  const rpad = (s: string, n: number) => s.padStart(n);

  const header = `${pad("operation", 12)} ${pad("method", 10)} ${rpad("avg", 6)} ${rpad("min", 6)} ${rpad("max", 6)}  (ms)`;
  const separator = `${"-".repeat(12)} ${"-".repeat(10)} ${"-".repeat(6)} ${"-".repeat(6)} ${"-".repeat(6)}`;
  const rows = results.map((r) => {
    const avgStr = String(r.avg);
    const minStr = String(r.min);
    const maxStr = String(r.max);
    const avg = rpad(avgStr, 6);
    const min = rpad(minStr, 6);
    const max = rpad(maxStr, 6);
    return `${pad(r.operation, 12)} ${pad(r.method, 10)} ${avg} ${min} ${max}`;
  });

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
