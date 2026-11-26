import { afterEach, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync, type Stats } from "node:fs";
import { z } from "zod";
import { send } from "./client.ts";
import { SOCKET_PATH } from "./config.ts";

const env = { ...process.env, REVISION: "test" };
const Status = z.object({ running: z.boolean() });
const MissingProcess = z.object({ code: z.enum(["ENOENT", "ESRCH"]) });

const cli = async (...args: readonly string[]): Promise<string> => {
  const proc = Bun.spawn(["bun", "cli.ts", ...args], {
    env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const stdoutText = new Response(proc.stdout).text();
  const stderrText = new Response(proc.stderr).text();
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    stdoutText,
    stderrText,
  ]);
  if (code !== 0) throw new Error(`chrome-cli ${args.join(" ")}: ${stderr}`);
  return stdout;
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON: ${text}`, { cause: error });
  }
};

const running = async (): Promise<boolean> => {
  const output = await cli("daemon-status");
  const json = parseJson(output);
  return Status.parse(json).running;
};

const readArgv = (pid: string): readonly string[] => {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
  } catch (error) {
    if (!MissingProcess.safeParse(error).success) throw error;
    return [];
  }
};

const listProcesses = (): readonly string[] => {
  try {
    return readdirSync("/proc");
  } catch (error) {
    throw new Error(`Could not scan /proc: ${String(error)}`, { cause: error });
  }
};

const daemonPids = (): readonly number[] =>
  listProcesses()
    .filter((entry) => /^\d+$/.test(entry))
    .filter((pid) => readArgv(pid).includes("--__daemon"))
    .map(Number);

const socketStats = (): Stats => {
  try {
    return statSync(SOCKET_PATH);
  } catch (error) {
    throw new Error(`Could not stat ${SOCKET_PATH}: ${String(error)}`, {
      cause: error,
    });
  }
};

const killDaemons = async (): Promise<void> => {
  daemonPids().forEach((pid) => process.kill(pid, "SIGKILL"));
  await Bun.sleep(100);
};

const spawnDaemon = () =>
  Bun.spawn(["bun", "cli.ts", "--__daemon"], {
    env,
    stdio: ["ignore", "ignore", "ignore"],
  });

afterEach(killDaemons);

test("snapshot keeps its CLI options", async () => {
  const help = await cli("snapshot", "--help");
  expect(help).toContain("--verbose");
  expect(help).toContain("--path <path>");
  expect(help).toContain("--session <id>");
  expect(help).toContain("--port <port>");
});

test.skipIf(process.platform !== "linux")(
  "snapshot validates options before resolving its session",
  async () => {
    await cli("daemon-start");
    const result = send({
      action: "snapshot",
      filePath: 42,
      session: "missing",
    });
    const [outcome] = await Promise.allSettled([result]);
    expect(outcome).toEqual({
      reason: new Error("param 'filePath' must be a string"),
      status: "rejected",
    });
  },
  20_000,
);

test.skipIf(process.platform !== "linux")(
  "navigate requires a numeric timeout before resolving its session",
  async () => {
    await cli("daemon-start");
    const result = send({
      action: "navigate",
      session: "missing",
      timeout: "5000",
      url: "about:blank",
    });
    const [outcome] = await Promise.allSettled([result]);
    expect(outcome).toEqual({
      reason: new Error("param 'timeout' must be a number"),
      status: "rejected",
    });
  },
  20_000,
);

test.skipIf(process.platform !== "linux")(
  "parallel cold start produces one daemon and one reachable socket",
  async () => {
    const starts = Array.from({ length: 8 }, () => cli("daemon-start"));
    await Promise.all(starts);
    await Bun.sleep(200);

    const pids = daemonPids();
    const isSocket = socketStats().isSocket();
    const isRunning = await running();
    expect(pids).toHaveLength(1);
    expect(isSocket).toBe(true);
    expect(isRunning).toBe(true);
  },
  20_000,
);

test.skipIf(process.platform !== "linux")(
  "startup recovers a stale socket",
  async () => {
    await cli("daemon-start");
    await killDaemons();
    const isStaleSocket = socketStats().isSocket();
    const runningBefore = await running();
    expect(isStaleSocket).toBe(true);
    expect(runningBefore).toBe(false);

    await cli("daemon-start");

    const runningAfter = await running();
    expect(runningAfter).toBe(true);
  },
  20_000,
);

test.skipIf(process.platform !== "linux")(
  "a second daemon leaves the live socket untouched",
  async () => {
    await cli("daemon-start");
    const owners = daemonPids();
    const { ino } = socketStats();
    expect(owners).toHaveLength(1);

    const contender = spawnDaemon();
    const code = await contender.exited;

    const remaining = daemonPids();
    const socket = socketStats();
    const isRunning = await running();
    expect(code).toBe(0);
    expect(remaining).toEqual(owners);
    expect(socket.ino).toBe(ino);
    expect(isRunning).toBe(true);
  },
  20_000,
);
