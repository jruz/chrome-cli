import { SOCKET_PATH } from "./config";

const parseErrorResponse = (text: string): Error => {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && "error" in parsed && typeof parsed.error === "string") {
      return new Error(parsed.error);
    }
    return new Error(text);
  } catch (err) {
    if (err instanceof SyntaxError) return new Error(text, { cause: err });
    throw err;
  }
};

export const send = async (command: Record<string, unknown>): Promise<string> => {
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

export const startDaemon = async (): Promise<void> => {
  const proc = Bun.spawn(["bun", "run", "src/daemon.ts"], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  });
  proc.unref();

  const start = Date.now();
  while (Date.now() - start < 5000) {
    const running = await isDaemonRunning();
    if (running) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("daemon failed to start within 5000ms");
};

export const ensureDaemon = async (): Promise<void> => {
  const running = await isDaemonRunning();
  if (running) return;
  await startDaemon();
};
