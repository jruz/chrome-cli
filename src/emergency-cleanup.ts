import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";

type TargetKind = "daemon" | "browser";
type Target = Readonly<{ pid: number; inode: number; kind: TargetKind }>;

const MissingProcess = z.object({ code: z.enum(["ENOENT", "ESRCH"]) });
const CHROME =
  /^(?:chrome|google-chrome(?:-stable)?|chromium(?:-browser)?|\.chromium-wrapped)$/;
const PROFILE = /^--user-data-dir=\/.*\/chrome-cli-[a-zA-Z0-9]{6}$/;
const DEBUG = /^--remote-debugging-(?:port=\d+|pipe)$/;

const classify = (argv: readonly string[]): TargetKind | undefined => {
  const [executable, entry] = argv;
  if (!executable) return undefined;
  const name = basename(executable);
  if (
    argv.at(-1) === "--__daemon" &&
    ((name === "chrome-cli" &&
      (argv.length === 2 || entry === "/$bunfs/root/chrome-cli")) ||
      (name === "bun" &&
        argv.length === 3 &&
        entry &&
        basename(entry) === "cli.ts"))
  ) {
    return "daemon";
  }
  if (
    CHROME.test(name) &&
    argv.some((arg) => PROFILE.test(arg)) &&
    argv.some((arg) => DEBUG.test(arg)) &&
    !argv.some((arg) => arg.startsWith("--type="))
  ) {
    return "browser";
  }
  return undefined;
};

const inspect = (pid: number, uid: number): Target | undefined => {
  try {
    const directory = `/proc/${pid}`;
    const { ino, uid: owner } = statSync(directory);
    if (owner !== uid) return undefined;
    const argv = readFileSync(`${directory}/cmdline`, "utf8")
      .split("\0")
      .slice(0, -1);
    const kind = classify(argv);
    if (kind === undefined) return undefined;
    return { inode: ino, kind, pid };
  } catch (error) {
    if (!MissingProcess.safeParse(error).success) throw error;
    return undefined;
  }
};

const findTargets = (uid: number, kind: TargetKind): readonly Target[] => {
  try {
    const pids = readdirSync("/proc")
      .filter((entry) => /^[1-9]\d*$/.test(entry))
      .map(Number);
    return pids.flatMap((pid) => {
      const target = inspect(pid, uid);
      return target?.kind === kind ? [target] : [];
    });
  } catch (error) {
    throw new Error(`Could not scan /proc: ${String(error)}`, { cause: error });
  }
};

const isSameTarget = (target: Target, uid: number): boolean => {
  const current = inspect(target.pid, uid);
  return current?.inode === target.inode && current.kind === target.kind;
};

const waitForExit = async (
  targets: readonly Target[],
  uid: number,
  deadline: number,
): Promise<void> => {
  const remaining = targets.filter((target) => isSameTarget(target, uid));
  if (remaining.length === 0) return;
  if (Date.now() >= deadline) {
    throw new Error(
      `Chrome CLI processes still running: ${remaining.map(({ pid }) => pid).join(", ")}`,
    );
  }
  await setTimeout(50);
  await waitForExit(remaining, uid, deadline);
};

const stop = async (
  uid: number,
  kind: TargetKind,
): Promise<readonly number[]> => {
  const signaled = findTargets(uid, kind).filter((target) => {
    if (!isSameTarget(target, uid)) return false;
    try {
      process.kill(target.pid, "SIGTERM");
      return true;
    } catch (error) {
      if (!MissingProcess.safeParse(error).success) throw error;
      return false;
    }
  });
  await waitForExit(signaled, uid, Date.now() + 5000);
  return signaled.map(({ pid }) => pid);
};

export const killAllIncludingOrphans = async (): Promise<string> => {
  const uid = process.geteuid?.();
  if (process.platform !== "linux" || uid === undefined) {
    throw new Error("kill-all --include-orphans is only supported on Linux");
  }
  const daemons = await stop(uid, "daemon");
  const browsers = await stop(uid, "browser");
  return JSON.stringify({ browsers, daemons });
};
