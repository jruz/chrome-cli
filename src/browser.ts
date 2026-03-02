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

const chromeExecutable = (): string => {
  const platform = process.platform as Platform;
  const path = CHROME_PATHS[platform];
  if (!path) {
    throw new Error(`unsupported platform: ${platform}`);
  }
  return path;
};

export type Session = {
  browser: Browser;
  page: Page;
  port: number;
  userDataDir: string;
};

const waitForDebugPort = async (port: number, timeoutMs: number): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
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
  const candidates = Array.from({ length: maxAttempts }, () => 9222 + Math.floor(Math.random() * 1000));
  const results = await candidates.reduce(
    async (accP, candidate) => {
      const found = await accP;
      if (found) return found;
      if (await isPortFree(candidate)) return candidate;
      return null;
    },
    Promise.resolve(null as number | null),
  );
  if (!results) throw new Error(`failed to find free debug port after ${maxAttempts} attempts`);
  return results;
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
