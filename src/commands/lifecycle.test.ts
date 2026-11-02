import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { isAlive, launch, type Session } from "../browser.ts";
import { killAllCmd, killCmd, launchCmd, type DaemonState } from "./lifecycle.ts";
import { oneshot } from "./oneshot.ts";

const createState = (): DaemonState => ({
  sessions: new Map(),
  networkCaptures: new Map(),
  consoleCaptures: new Map(),
});

const state = createState();
const unrelated = createState();
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
  const pids = process.platform === "linux"
    ? await processTree(browserProcess.id)
    : processInfo.map((info) => info.id);
  expect(pids.length).toBeGreaterThan(1);
  return { port: session.port, userDataDir: session.userDataDir, pid: browserProcess.id, pids };
};

type Inspection = Awaited<ReturnType<typeof inspectSession>>;

const processRunning = async (pid: number): Promise<boolean> => {
  if (process.platform === "linux") {
    const file = Bun.file(`/proc/${pid}/stat`);
    if (!await file.exists()) return false;
    const stat = await file.text();
    return !/\) [ZX] /.test(stat);
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const { code } = z.object({ code: z.literal("ESRCH") }).parse(error);
    expect(code).toBe("ESRCH");
    return false;
  }
};

const waitForProcesses = async (pids: readonly number[], deadline: number): Promise<void> => {
  const tasks = pids.map(processRunning);
  const running = await Promise.all(tasks);
  if (!running.some(Boolean)) return;
  if (Date.now() >= deadline) throw new Error(`processes still running: ${pids.join(" ")}`);
  await Bun.sleep(50);
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
  await killAllCmd(state);
  await killAllCmd(unrelated);
});

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
  await expectAlive(session.port, false);
  await waitForProcesses(inspection.pids, Date.now() + 10000);
  expectProfile(session.userDataDir, true);
  await rm(session.userDataDir, { recursive: true });
}, 30000);

test("kill-all closes tracked browsers and leaves an unrelated browser alone", async () => {
  const first = await start(state);
  const second = await launch(true);
  state.sessions.set(second.port, second);
  const other = await start(unrelated);
  const tasks = [first, second].map(inspectSession);
  const inspections = await Promise.all(tasks);
  await killAllCmd(state);
  const checks = inspections.map(expectStopped);
  await Promise.all(checks);
  await expectAlive(other.port, true);
}, 30000);

test("shutdown closes tracked browser processes before exiting", async () => {
  const other = await start(unrelated);
  const script = `
    import { launch } from "./src/browser.ts";
    import { shutdownCmd } from "./src/commands/lifecycle.ts";
    const session = await launch(true);
    const client = await session.browser.target().createCDPSession();
    const { processInfo } = await client.send("SystemInfo.getProcessInfo");
    await client.detach();
    console.log(JSON.stringify({
      port: session.port,
      userDataDir: session.userDataDir,
      pids: processInfo.map((info) => info.id),
    }));
    await shutdownCmd({
      sessions: new Map([[session.port, session]]),
      networkCaptures: new Map(),
      consoleCaptures: new Map(),
    });
  `;
  const child = Bun.spawn([process.execPath, "--eval", script], { stdout: "pipe", stderr: "inherit" });
  const output = await new Response(child.stdout).text();
  const code = await child.exited;
  expect(code).toBe(0);
  const schema = z.object({ port: z.number(), userDataDir: z.string(), pids: PidsSchema }).readonly();
  const raw: unknown = await new Response(output).json();
  const details = schema.parse(raw);
  await expectAlive(details.port, false);
  expectProfile(details.userDataDir, false);
  await waitForProcesses(details.pids, Date.now() + 10000);
  await expectAlive(other.port, true);
}, 30000);

const modes: readonly (readonly ["snapshot" | "screenshot" | "failure"])[] = [["snapshot"], ["screenshot"], ["failure"]];

test.each(modes)("oneshot %s awaits browser cleanup", async (mode) => {
  const inspection = Promise.withResolvers<Inspection>();
  const server = Bun.serve({
    port: 0,
    fetch: async () => {
      const [session] = state.sessions.values();
      if (!session) throw new Error("missing oneshot session");
      const details = await inspectSession(session);
      inspection.resolve(details);
      return new Response("<h1>Lifecycle regression</h1>", { headers: { "content-type": "text/html" } });
    },
  });
  const tmp = tmpdir();
  const id = crypto.randomUUID();
  const failurePath = join(tmp, id, "snapshot.txt");
  try {
    const result = oneshot(state, {
      url: server.url.href,
      mode: mode === "failure" ? "snapshot" : mode,
      timeout: 5000,
      path: mode === "failure" ? failurePath : undefined,
      verbose: false,
      fullPage: undefined,
      format: undefined,
      quality: undefined,
      width: undefined,
      height: undefined,
    });
    if (mode === "failure") {
      const error: unknown = await result.catch((error: unknown) => error);
      const { code } = z.object({ code: z.string() }).parse(error);
      expect(code).toBe("ENOENT");
    } else {
      const output = await result;
      expect(output).toBeString();
    }
    expect(state.sessions.size).toBe(0);
    const details = await inspection.promise;
    await expectStopped(details);
  } finally {
    await server.stop(true);
  }
}, 30000);
