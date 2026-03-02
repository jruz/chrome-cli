import { SOCKET_PATH } from "./config";

export const send = async (command: Record<string, unknown>): Promise<string> => {
  const response = await fetch("http://localhost/command", {
    method: "POST",
    unix: SOCKET_PATH,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(command),
  } as RequestInit);

  const text = await response.text();

  if (!response.ok) {
    try {
      const parsed = JSON.parse(text) as { error: string };
      throw new Error(parsed.error);
    } catch (err) {
      if (err instanceof SyntaxError) throw new Error(text);
      throw err;
    }
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
