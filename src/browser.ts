import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { spawn } from "child_process";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const CHROME_PATHS = {
  darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  linux: "/usr/bin/google-chrome",
} as const;

type Platform = keyof typeof CHROME_PATHS;

const isPlatform = (p: string): p is Platform => p in CHROME_PATHS;

const chromeExecutable = (): string => {
  const platform = process.platform;
  if (!isPlatform(platform)) {
    throw new Error(`unsupported platform: ${platform}`);
  }
  return CHROME_PATHS[platform];
};

export type Session = {
  browser: Browser;
  page: Page;
  port: number;
  userDataDir: string;
};

const tryDebugPort = async (port: number): Promise<boolean> => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
};

const waitForDebugPort = async (port: number, timeoutMs: number): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await tryDebugPort(port)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Chrome did not start on port ${port} within ${timeoutMs}ms`);
};

const isPortFree = async (port: number): Promise<boolean> => {
  try {
    await fetch(`http://127.0.0.1:${port}/json/version`);
    return false;
  } catch {
    return true;
  }
};

const findFreePort = async (maxAttempts: number): Promise<number> => {
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = 9222 + Math.floor(Math.random() * 1000);
    if (await isPortFree(candidate)) return candidate;
  }
  throw new Error(`failed to find free debug port after ${maxAttempts} attempts`);
};

export const launch = async (headless: boolean): Promise<{ port: number; userDataDir: string }> => {
  const port = await findFreePort(10);
  const userDataDir = mkdtempSync(join(tmpdir(), "chrome-cli-"));
  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    ...(headless ? ["--headless=new"] : []),
  ];

  const child = spawn(chromeExecutable(), chromeArgs, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  await waitForDebugPort(port, 10000);

  return { port, userDataDir };
};

export const isAlive = async (port: number): Promise<boolean> => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
};

export const connect = async (port: number, userDataDir: string): Promise<Session> => {
  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${port}`,
  });
  const pages = await browser.pages();
  const first = pages[0];
  if (!first) throw new Error(`no pages found on port ${port}`);
  return { browser, page: first, port, userDataDir };
};

export const findChromePid = async (port: number): Promise<number | null> => {
  const proc = Bun.spawn(["lsof", "-ti", `:${port}`], { stdout: "pipe", stderr: "pipe" });
  const text = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) return null;
  const firstLine = text.trim().split("\n")[0];
  if (!firstLine) return null;
  const pid = parseInt(firstLine, 10);
  if (isNaN(pid)) return null;
  return pid;
};
