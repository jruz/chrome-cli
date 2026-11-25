import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { createInterface } from "node:readline";
import { afterEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { createActivity, track } from "../activity.ts";
import { isAlive, type Session } from "../browser.ts";
import { createCapacity } from "../capacity.ts";
import {
  killAllCmd,
  killCmd,
  launchCmd,
  launchSession,
  reapIdleCmd,
  sessionFor,
  type DaemonState,
} from "./lifecycle.ts";
import { oneshot } from "./oneshot.ts";

const createState = (limit: number, idleMs: number): DaemonState => ({
  activity: createActivity(idleMs),
  capacity: createCapacity(limit),
  consoleCaptures: new Map(),
  networkCaptures: new Map(),
  sessions: new Map(),
});

const HOUR = 60 * 60 * 1000;
const state = createState(8, HOUR);
const unrelated = createState(8, HOUR);
const capped = createState(2, HOUR);
const idle = createState(8, 100);
const LIMIT_ERROR = /browser limit reached \(2\/2\)/;
const PidSchema = z.coerce.number().int().positive();
const PidsSchema = z.array(PidSchema).readonly();

const processTree = async (pid: number): Promise<readonly number[]> => {
  const text = await readFile(`/proc/${pid}/task/${pid}/children`, "utf8");
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const children = PidsSchema.parse(tokens);
  const tasks = children.map(processTree);
  const descendants = await Promise.all(tasks);
  return [pid, ...descendants.flat()];
};

const inspectSession = async (session: Session) => {
  const client = await session.browser.target().createCDPSession();
  const { processInfo } = await client.send("SystemInfo.getProcessInfo");
  await client.detach();
  const browserProcess = processInfo.find((info) => info.type === "browser");
  if (!browserProcess) throw new Error("missing browser process");
  const pids =
    process.platform === "linux"
      ? await processTree(browserProcess.id)
      : processInfo.map((info) => info.id);
  expect(pids.length).toBeGreaterThan(1);
  return {
    pid: browserProcess.id,
    pids,
    port: session.port,
    userDataDir: session.userDataDir,
  };
};

type Inspection = Awaited<ReturnType<typeof inspectSession>>;

const linuxProcessRunning = async (pid: number): Promise<boolean> => {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    return !/\) [ZX] /.test(stat);
  } catch (error) {
    const missing = z.object({ code: z.enum(["ENOENT", "ESRCH"]) });
    if (missing.safeParse(error).success) return false;
    throw error;
  }
};

const processRunning = async (pid: number): Promise<boolean> => {
  if (process.platform === "linux") return linuxProcessRunning(pid);
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const { code } = z.object({ code: z.literal("ESRCH") }).parse(error);
    expect(code).toBe("ESRCH");
    return false;
  }
};

const waitForProcesses = async (
  pids: readonly number[],
  deadline: number,
): Promise<void> => {
  const tasks = pids.map(processRunning);
  const running = await Promise.all(tasks);
  if (!running.some(Boolean)) return;
  if (Date.now() >= deadline)
    throw new Error(`processes still running: ${pids.join(" ")}`);
  await setTimeout(50);
  await waitForProcesses(pids, deadline);
};

const expectAlive = async (port: number, expected: boolean) => {
  const alive = await isAlive(port);
  expect(alive).toBe(expected);
};

const expectProfile = (path: string, expected: boolean) => {
  const exists = existsSync(path);
  expect(exists).toBe(expected);
};

const expectStopped = async (inspection: Inspection) => {
  await expectAlive(inspection.port, false);
  expectProfile(inspection.userDataDir, false);
  await waitForProcesses(inspection.pids, Date.now() + 10000);
};

const start = async (target: DaemonState): Promise<Session> => {
  await launchCmd(target, true);
  const [session] = target.sessions.values();
  if (!session) throw new Error("missing launched session");
  return session;
};

afterEach(async () => {
  vi.unstubAllEnvs();
  await killAllCmd(state);
  await killAllCmd(unrelated);
  await killAllCmd(capped);
  await killAllCmd(idle);
});

test("idle expiry closes the browser and removes its profile", async () => {
  const session = await start(idle);
  const inspection = await inspectSession(session);
  await setTimeout(200);
  const result = await reapIdleCmd(idle);
  expect(result).toBe(
    `{"reaped":[{"pid":${inspection.pid},"port":${session.port}}]}`,
  );
  expect(idle.sessions.size).toBe(0);
  await expectStopped(inspection);
}, 30000);

test("an in-flight command prevents idle expiry", async () => {
  const session = await start(idle);
  const reapWhileBusy = async () => {
    await setTimeout(200);
    return reapIdleCmd(idle);
  };
  const busy = await track(idle.activity, session.port, reapWhileBusy);
  const afterUse = await reapIdleCmd(idle);
  expect([busy, afterUse]).toEqual(['{"reaped":[]}', '{"reaped":[]}']);
  await expectAlive(session.port, true);
}, 30000);

const browserPid = (session: Session): number => {
  const pid = session.browser.process()?.pid;
  if (pid === undefined) throw new Error("missing browser process");
  return pid;
};

test("an unresponsive owned browser is removed and frees capacity", async () => {
  const session = await start(capped);
  await launchCmd(capped, true);
  const inspection = await inspectSession(session);
  const pid = browserPid(session);
  process.kill(pid, "SIGKILL");
  await waitForProcesses([inspection.pid], Date.now() + 10000);
  const lookup = sessionFor(capped, session.port);
  await expect(lookup).rejects.toThrow(/is not responding, session removed/);
  expectProfile(session.userDataDir, false);
  const replacement = launchCmd(capped, true);
  await expect(replacement).resolves.toMatch(/"port"/);
}, 30000);

const oneshotPage = (target: DaemonState) =>
  oneshot(target, {
    format: undefined,
    fullPage: undefined,
    height: undefined,
    mode: "snapshot",
    path: undefined,
    quality: undefined,
    timeout: 5000,
    url: "data:text/html,<h1>capacity</h1>",
    verbose: false,
    width: undefined,
  });

const rejectionMessage = (result: PromiseSettledResult<string>) => {
  if (result.status === "fulfilled") return "fulfilled";
  return z.instanceof(Error).parse(result.reason).message;
};

test("parallel launch and oneshot cannot exceed the browser limit", async () => {
  const attempts = [
    launchCmd(capped, true),
    oneshotPage(capped),
    launchCmd(capped, true),
    oneshotPage(capped),
  ];
  const results = await Promise.allSettled(attempts);
  const outcomes = results.map(rejectionMessage);
  const [admitted, rejected] = [outcomes.slice(0, 2), outcomes.slice(2)];
  expect(admitted).toEqual(["fulfilled", "fulfilled"]);
  rejected.forEach((message) => {
    expect(message).toMatch(LIMIT_ERROR);
  });
  expect(capped.sessions.size).toBe(1);

  await launchCmd(capped, true);
  const full = launchCmd(capped, true);
  await expect(full).rejects.toThrow(LIMIT_ERROR);
}, 30000);

test("killing a browser frees its capacity", async () => {
  const first = await start(capped);
  await launchCmd(capped, true);
  await killCmd(capped, first.port);
  const replacement = launchCmd(capped, true);
  await expect(replacement).resolves.toMatch(/"port"/);
}, 30000);

test("failed launches free capacity", async () => {
  vi.stubEnv("CHROME_PATH", "/missing/chrome");
  vi.stubEnv("PATH", "");
  const failures = [1, 2, 3].map(() => launchCmd(capped, true));
  const results = await Promise.allSettled(failures);
  const outcomes = results.map(rejectionMessage);
  expect(outcomes[0]).toMatch(/chrome\/chromium not found/);
  vi.unstubAllEnvs();

  const launches = [launchCmd(capped, true), launchCmd(capped, true)];
  const sessions = await Promise.all(launches);
  expect(sessions).toHaveLength(2);
}, 30000);

test("kill awaits Chrome exit without killing the CDP client or an unrelated browser", async () => {
  const session = await start(state);
  const other = await start(unrelated);
  const inspection = await inspectSession(session);
  const result = await killCmd(state, session.port);
  expect(result).toBe(`{"killed":${session.port},"pid":${inspection.pid}}`);
  expect(state.sessions.size).toBe(0);
  await expectStopped(inspection);
  await expectAlive(other.port, true);
  const value = await other.page.evaluate(() => 2 + 2);
  expect(value).toBe(4);
}, 30000);

test("kill closes only the requested port when it is not registered", async () => {
  const session = await start(unrelated);
  const inspection = await inspectSession(session);
  await killCmd(state, session.port);
  unrelated.sessions.delete(session.port);
  const running = await isAlive(session.port);
  expect(running).toBe(false);
  await waitForProcesses(inspection.pids, Date.now() + 10000);
  expectProfile(session.userDataDir, true);
  await rm(session.userDataDir, { recursive: true });
}, 30000);

test("kill-all closes tracked browsers and leaves an unrelated browser alone", async () => {
  const first = await start(state);
  const second = await launchSession(state, true);
  const other = await start(unrelated);
  const tasks = [first, second].map(inspectSession);
  const inspections = await Promise.all(tasks);
  await killAllCmd(state);
  expect(state.sessions.size).toBe(0);
  const checks = inspections.map(expectStopped);
  await Promise.all(checks);
  await expectAlive(other.port, true);
}, 30000);

test("SIGTERM closes owned browsers before the daemon exits", async () => {
  const other = await start(unrelated);
  const script = `
    import { createActivity } from "./src/activity.ts";
    import { createCapacity } from "./src/capacity.ts";
    import { launchSession, shutdownOnSignals } from "./src/commands/lifecycle.ts";
    const state = {
      activity: createActivity(60000),
      capacity: createCapacity(1),
      sessions: new Map(),
      networkCaptures: new Map(),
      consoleCaptures: new Map(),
    };
    const session = await launchSession(state, true);
    const client = await session.browser.target().createCDPSession();
    const { processInfo } = await client.send("SystemInfo.getProcessInfo");
    await client.detach();
    shutdownOnSignals(state);
    console.log(JSON.stringify({
      port: session.port,
      userDataDir: session.userDataDir,
      pids: processInfo.map((info) => info.id),
    }));
    setInterval(() => {}, 1000);
  `;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", script],
    {
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const exited = once(child, "exit");
  const lines = createInterface({ input: child.stdout });
  const firstLine: unknown[] = await once(lines, "line");
  const [line] = z.tuple([z.string()]).parse(firstLine);
  const schema = z
    .object({ pids: PidsSchema, port: z.number(), userDataDir: z.string() })
    .readonly();
  const raw: unknown = await new Response(line).json();
  const details = schema.parse(raw);
  child.kill("SIGTERM");
  const exit: unknown[] = await exited;
  const [code] = z.tuple([z.number(), z.null()]).parse(exit);
  expect(code).toBe(0);
  const running = await isAlive(details.port);
  expect(running).toBe(false);
  expectProfile(details.userDataDir, false);
  await waitForProcesses(details.pids, Date.now() + 10000);
  await expectAlive(other.port, true);
}, 30000);

const modes: readonly (readonly ["snapshot" | "screenshot" | "failure"])[] = [
  ["snapshot"],
  ["screenshot"],
  ["failure"],
];

test.each(modes)(
  "oneshot %s awaits browser cleanup",
  async (mode) => {
    const inspection = Promise.withResolvers<Inspection>();
    const server = createServer((request, response) => {
      if (request.url !== "/") {
        response.writeHead(404).end();
        return;
      }
      const [session] = state.sessions.values();
      if (!session) {
        response.destroy(new Error("missing oneshot session"));
        return;
      }
      inspectSession(session)
        .then((details) => {
          inspection.resolve(details);
          response.writeHead(200, { "content-type": "text/html" });
          response.end("<h1>Lifecycle regression</h1>");
        })
        .catch((error: unknown) => {
          response.destroy(
            error instanceof Error ? error : new Error(String(error)),
          );
        });
    });
    const listening = once(server, "listening");
    server.listen(0, "127.0.0.1");
    await listening;
    const tmp = tmpdir();
    const id = crypto.randomUUID();
    const failurePath = join(tmp, id, "snapshot.txt");
    try {
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new Error("missing HTTP test server address");
      const result = oneshot(state, {
        format: undefined,
        fullPage: undefined,
        height: undefined,
        mode: mode === "failure" ? "snapshot" : mode,
        path: mode === "failure" ? failurePath : undefined,
        quality: undefined,
        timeout: 5000,
        url: `http://127.0.0.1:${address.port}/`,
        verbose: false,
        width: undefined,
      });
      const outcome = await result.then(
        (output) => output.length > 0,
        (error: unknown) => z.object({ code: z.string() }).parse(error).code,
      );
      expect(outcome).toBe(mode === "failure" ? "ENOENT" : true);
      expect(state.sessions.size).toBe(0);
      const details = await inspection.promise;
      await expectStopped(details);
    } finally {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
    }
  },
  30000,
);
