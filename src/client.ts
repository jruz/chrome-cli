import { SOCKET_PATH } from "./config";

const parseErrorResponse = (text: string): Error => {
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof parsed.error === "string"
    ) {
      return new Error(parsed.error);
    }
    return new Error(text);
  } catch (err) {
    if (err instanceof SyntaxError) return new Error(text, { cause: err });
    throw err;
  }
};

export const send = async (
  command: Record<string, unknown>,
): Promise<string> => {
  const response = await fetch("http://localhost/command", {
    method: "POST",
    unix: SOCKET_PATH,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(command),
  });

  const text = await response.text();

  if (!response.ok) {
    throw parseErrorResponse(text);
  }

  return text;
};

export const isDaemonRunning = async (): Promise<boolean> => {
  try {
    await send({ action: "status" });
    return true;
  } catch {
    return false;
  }
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const waitForDaemonState = async (
  expectedRunning: boolean,
  timeoutMs: number,
): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const running = await isDaemonRunning();
    if (running === expectedRunning) return;
    await sleep(50);
  }

  const action = expectedRunning ? "start" : "stop";
  throw new Error(`daemon failed to ${action} within ${timeoutMs}ms`);
};

const daemonCommand = (): string[] => {
  const main = Bun.main;
  if (main !== process.execPath) {
    return [process.execPath, main, "--__daemon"];
  }
  return [process.execPath, "--__daemon"];
};

export const startDaemon = async (): Promise<void> => {
  const cmd = daemonCommand();
  const proc = Bun.spawn(cmd, {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  });
  proc.unref();

  await waitForDaemonState(true, 5000);
};

export const stopDaemon = async (): Promise<string> => {
  const result = await send({ action: "shutdown" });
  await waitForDaemonState(false, 5000);
  return result;
};

export const ensureDaemon = async (): Promise<void> => {
  const running = await isDaemonRunning();
  if (running) return;
  await startDaemon();
};
