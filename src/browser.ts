import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { once } from "node:events";
import { accessSync, constants, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { newSessionTarget, portTarget, type Target } from "./target.ts";

const DARWIN_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

const LINUX_NAMES = [
  "google-chrome-stable",
  "google-chrome",
  "chromium-browser",
  "chromium",
];

const canAccess = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const findDarwin = (): string | undefined => DARWIN_PATHS.find(canAccess);

const findLinux = (): string | undefined => {
  const path = process.env["PATH"];
  if (path === undefined) return undefined;
  const directories = path.split(delimiter);
  return LINUX_NAMES.flatMap((name) =>
    directories.map((directory) => join(directory, name)),
  ).find(canAccess);
};

const chromeExecutable = (): string => {
  const envPath = process.env["CHROME_PATH"];
  if (envPath && canAccess(envPath)) return envPath;

  const found = process.platform === "darwin" ? findDarwin() : findLinux();
  if (found) return found;

  throw new Error(
    "chrome/chromium not found — set CHROME_PATH or install Chrome/Chromium",
  );
};

export type Session = {
  browser: Browser;
  page: Page;
  target: Target;
  userDataDir: string;
};

const launchBrowser = async (
  headless: boolean,
  userDataDir: string,
): Promise<Browser> => {
  try {
    return await puppeteer.launch({
      executablePath: chromeExecutable(),
      handleSIGHUP: false,
      handleSIGINT: false,
      handleSIGTERM: false,
      headless,
      pipe: true,
      timeout: 10000,
      userDataDir,
    });
  } catch (error) {
    rmSync(userDataDir, { recursive: true });
    throw error;
  }
};

export const launch = async (headless: boolean): Promise<Session> => {
  const tmp = tmpdir();
  const tmpBase = join(tmp, "chrome-cli-");
  const userDataDir = mkdtempSync(tmpBase);
  const browser = await launchBrowser(headless, userDataDir);
  try {
    const target = newSessionTarget();
    return await createSession(browser, target, userDataDir);
  } catch (error) {
    await closeOwned(browser);
    rmSync(userDataDir, { recursive: true });
    throw error;
  }
};

export const isAlive = async (port: number): Promise<boolean> => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
};

const createSession = async (
  browser: Browser,
  target: Target,
  userDataDir: string,
): Promise<Session> => {
  const pages = await browser.pages();
  const first = pages[0];
  if (!first) throw new Error("no pages found in browser");
  return { browser, page: first, target, userDataDir };
};

export const connect = async (
  port: number,
  userDataDir: string,
): Promise<Session> => {
  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${port}`,
  });
  try {
    const target = portTarget(port);
    return await createSession(browser, target, userDataDir);
  } catch (error) {
    await browser.disconnect();
    throw error;
  }
};

const waitForClosedPort = async (
  port: number,
  deadline: number,
): Promise<void> => {
  if (!(await isAlive(port))) return;
  if (Date.now() >= deadline)
    throw new Error(`Chrome still responding on port ${port}`);
  await setTimeout(50);
  await waitForClosedPort(port, deadline);
};

const ownedProcess = (browser: Browser) => {
  const child = browser.process();
  if (!child) throw new Error("browser process is not owned by this daemon");
  return child;
};

const hasExited = (child: ReturnType<typeof ownedProcess>): boolean =>
  child.exitCode !== null || child.signalCode !== null;

export const terminate = async (browser: Browser): Promise<void> => {
  const child = ownedProcess(browser);
  if (hasExited(child)) return;
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
};

export const closeOwned = async (browser: Browser): Promise<number> => {
  const child = ownedProcess(browser);
  if (child.pid === undefined) throw new Error("browser process has no pid");
  const exited = hasExited(child) ? Promise.resolve() : once(child, "exit");
  await browser.close();
  await exited;
  return child.pid;
};

export const close = async (
  browser: Browser,
  port: number,
): Promise<number> => {
  const client = await browser.target().createCDPSession();
  const { processInfo } = await client.send("SystemInfo.getProcessInfo");
  await client.detach();
  const processInfoBrowser = processInfo.find(
    (info) => info.type === "browser",
  );
  if (!processInfoBrowser)
    throw new Error(`no browser process on port ${port}`);
  await browser.close();
  await waitForClosedPort(port, Date.now() + 10000);
  return processInfoBrowser.id;
};
