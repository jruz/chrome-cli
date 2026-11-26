import {
  ensureDaemon,
  isDaemonRunning,
  send,
  startDaemon,
  stopDaemon,
} from "../client.ts";
import { opt, type CliOptions, type Flag } from "../command.ts";

const parseJson = (raw: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error("expected object response");
    }
    const entries = Object.entries(parsed);
    return Object.fromEntries(entries);
  } catch (err) {
    throw new Error(`invalid daemon response: ${String(err)}`, { cause: err });
  }
};

const withRunning = (raw: string, running: boolean): string => {
  const parsed = parseJson(raw);
  return JSON.stringify({ running, ...parsed });
};

export type LocalCommand = Readonly<{
  name: string;
  description: string;
  flags: readonly Flag[];
  run: (opts: CliOptions) => Promise<string>;
}>;

export const localCommands: readonly LocalCommand[] = [
  {
    description: "Start the background daemon",
    flags: [],
    name: "daemon-start",
    run: async () => {
      const running = await isDaemonRunning();
      if (!running) await startDaemon();
      const status = await send({ action: "status" });
      const parsed = parseJson(status);
      return JSON.stringify({ running: true, started: !running, ...parsed });
    },
  },
  {
    description: "Show daemon status",
    flags: [],
    name: "daemon-status",
    run: async () => {
      const running = await isDaemonRunning();
      if (!running) return JSON.stringify({ running: false });
      const status = await send({ action: "status" });
      return withRunning(status, true);
    },
  },
  {
    description: "Stop the background daemon",
    flags: [],
    name: "daemon-stop",
    run: async () => {
      const running = await isDaemonRunning();
      if (!running) throw new Error("daemon is not running");
      const result = await stopDaemon();
      return withRunning(result, false);
    },
  },
  {
    description: "Kill all tracked Chrome instances",
    flags: [
      opt(
        "--include-orphans",
        "also stop all Chrome CLI daemons and orphaned browsers (Linux)",
      ),
    ],
    name: "kill-all",
    run: async (opts) => {
      if (opts["includeOrphans"]) {
        const { killAllIncludingOrphans } =
          await import("../emergency-cleanup.ts");
        return killAllIncludingOrphans();
      }
      await ensureDaemon();
      return send({ action: "kill-all" });
    },
  },
];
