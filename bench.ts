import { log } from "./src/log";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { closeOwned, launch, type Session } from "./src/browser.ts";
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

const sumTimes = (
  times: readonly number[],
  index: number,
  total: number,
): number => {
  const time = times[index];
  if (time === undefined) return total;
  return sumTimes(times, index + 1, total + time);
};

const stats = (
  operation: string,
  method: string,
  times: number[],
): BenchResult => {
  const minVal = Math.min(...times);
  const maxVal = Math.max(...times);
  return {
    avg: Math.round(sumTimes(times, 0, 0) / times.length),
    max: Math.round(maxVal),
    method,
    min: Math.round(minVal),
    operation,
    times: times.map((t) => Math.round(t)),
  };
};

const runCli = async (args: string): Promise<number[]> => {
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    const proc = Bun.spawn(["bun", "run", "cli.ts", ...args.split(" ")], {
      stderr: "pipe",
      stdout: "pipe",
    });
    const [code, , stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    if (code !== 0) throw new Error(`bench ${args}: ${stderr}`);
    times.push(performance.now() - start);
  }
  return times;
};

const measureDaemon = async (id: string): Promise<BenchResult[]> => {
  await send({
    action: "navigate",
    session: id,
    timeout: 30000,
    url: TARGET_URL,
  });

  const results: BenchResult[] = [];

  const cliNav = await runCli(
    `navigate --session ${id} --url ${TARGET_URL} --timeout 30000`,
  );
  const cliNavStats = stats("navigate", "cli", cliNav);
  results.push(cliNavStats);
  const cliSnap = await runCli(`snapshot --session ${id}`);
  const cliSnapStats = stats("snapshot", "cli", cliSnap);
  results.push(cliSnapStats);
  const cliShot = await runCli(
    `screenshot --session ${id} --format png --path /tmp/bench-shot.png`,
  );
  const cliShotStats = stats("screenshot", "cli", cliShot);
  results.push(cliShotStats);
  const cliEval = await runCli(
    `eval --session ${id} --expression document.title`,
  );
  const cliEvalStats = stats("eval", "cli", cliEval);
  results.push(cliEvalStats);
  const cliPages = await runCli(`pages --session ${id}`);
  const cliPagesStats = stats("pages", "cli", cliPages);
  results.push(cliPagesStats);

  const daemonNav = await timeOp(() =>
    send({ action: "navigate", session: id, timeout: 30000, url: TARGET_URL }),
  );
  const daemonNavStats = stats("navigate", "daemon", daemonNav);
  results.push(daemonNavStats);
  const daemonSnap = await timeOp(() =>
    send({ action: "snapshot", session: id }),
  );
  const daemonSnapStats = stats("snapshot", "daemon", daemonSnap);
  results.push(daemonSnapStats);
  const daemonShot = await timeOp(() =>
    send({
      action: "screenshot",
      format: "png",
      path: "/tmp/bench-shot-d.png",
      session: id,
    }),
  );
  const daemonShotStats = stats("screenshot", "daemon", daemonShot);
  results.push(daemonShotStats);
  const daemonEval = await timeOp(() =>
    send({ action: "eval", expression: "document.title", session: id }),
  );
  const daemonEvalStats = stats("eval", "daemon", daemonEval);
  results.push(daemonEvalStats);
  const daemonPages = await timeOp(() =>
    send({ action: "pages", session: id }),
  );
  const daemonPagesStats = stats("pages", "daemon", daemonPages);
  results.push(daemonPagesStats);

  return results;
};

const measureRaw = async (session: Session): Promise<BenchResult[]> => {
  const results: BenchResult[] = [];

  const rawNav = await timeOp(() =>
    navigate(session.page, TARGET_URL, 30000, undefined, undefined),
  );
  const rawNavStats = stats("navigate", "raw-cdp", rawNav);
  results.push(rawNavStats);
  const rawSnap = await timeOp(() => snapshot(session.page, false, undefined));
  const rawSnapStats = stats("snapshot", "raw-cdp", rawSnap);
  results.push(rawSnapStats);
  const rawShot = await timeOp(() =>
    screenshot(
      session.page,
      "/tmp/bench-shot-raw.png",
      false,
      "png",
      undefined,
      undefined,
    ),
  );
  const rawShotStats = stats("screenshot", "raw-cdp", rawShot);
  results.push(rawShotStats);
  const rawEval = await timeOp(() =>
    evaluate(session.page, "document.title", undefined),
  );
  const rawEvalStats = stats("eval", "raw-cdp", rawEval);
  results.push(rawEvalStats);
  const rawPages = await timeOp(async () => {
    const pages = await session.browser.pages();
    const mapped = pages.map(async (p, i) => ({
      id: i,
      title: await p.title(),
      url: p.url(),
    }));
    await Promise.all(mapped);
  });
  const rawPagesStats = stats("pages", "raw-cdp", rawPages);
  results.push(rawPagesStats);

  return results;
};

const printResults = (results: readonly BenchResult[]) => {
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
};

const benchDaemon = async (): Promise<BenchResult[]> => {
  await ensureDaemon();
  const response = await send({ action: "launch", headless: true });
  const launchResult = z.object({ session: z.string() });
  const raw: unknown = await new Response(response).json();
  const { session } = launchResult.parse(raw);
  try {
    return await measureDaemon(session);
  } finally {
    await send({ action: "kill", session });
  }
};

const benchRaw = async (): Promise<BenchResult[]> => {
  const browser = await launch(true);
  try {
    return await measureRaw(browser);
  } finally {
    await closeOwned(browser.browser);
    await rm(browser.userDataDir, { recursive: true });
  }
};

const daemonResults = await benchDaemon();
const rawResults = await benchRaw();
printResults([...daemonResults, ...rawResults]);
