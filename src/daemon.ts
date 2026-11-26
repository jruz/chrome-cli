import { rmSync } from "node:fs";
import { z, ZodError } from "zod";
import { createActivity } from "./activity.ts";
import { createCapacity } from "./capacity.ts";
import {
  textParam,
  type CommandContext,
  type CommandEntry,
} from "./command.ts";
import { commands } from "./commands.ts";
import {
  lifecycleHandlers,
  reapIdleCmd,
  sessionFor,
  shutdownOnSignals,
  type DaemonState,
} from "./commands/lifecycle.ts";
import {
  ensureRuntimeDir,
  LOCK_PATH,
  IDLE_TIMEOUT_MS,
  MAX_BROWSERS,
  REAP_INTERVAL_MS,
  SOCKET_PATH,
} from "./config.ts";
import { acquireDaemonLock } from "./daemon-lock.ts";
import { log } from "./log.ts";

const RequestField = z.unknown();
const RequestSchema = z
  .object({ action: textParam("action") })
  .catchall(RequestField)
  .readonly();

const toErrorMessage = (err: unknown): string => {
  if (err instanceof ZodError)
    return err.issues.map((i) => i.message).join("; ");
  if (err instanceof Error) return err.message;
  return String(err);
};

const state: DaemonState = {
  activity: createActivity(IDLE_TIMEOUT_MS),
  capacity: createCapacity(MAX_BROWSERS),
  consoleCaptures: new Map(),
  networkCaptures: new Map(),
  sessions: new Map(),
};

const context: CommandContext = {
  getSession: (target) => sessionFor(state, target),
  state,
  traceCaptures: new Map(),
};

const registered = commands.map<CommandEntry>(({ cli, execute }) => [
  cli.name,
  execute,
]);
const handlers = new Map([...registered, ...lifecycleHandlers]);

const dispatch = (input: unknown) => {
  const request = RequestSchema.parse(input);
  const handler = handlers.get(request.action);
  if (!handler) throw new Error(`unknown action: ${request.action}`);
  return handler(context, request);
};

const reapIdle = (): void => {
  reapIdleCmd(state)
    .then(log.info)
    .catch((error: unknown) => {
      log.error(`idle reaping failed: ${toErrorMessage(error)}`);
    });
};

const removeStaleSocket = (): void => {
  try {
    rmSync(SOCKET_PATH, { force: true });
  } catch (error) {
    throw new Error(`Could not remove ${SOCKET_PATH}: ${String(error)}`, {
      cause: error,
    });
  }
};

const start = () => {
  ensureRuntimeDir();
  if (!acquireDaemonLock(LOCK_PATH)) {
    log.info(`another daemon owns ${LOCK_PATH} (pid: ${process.pid} exiting)`);
    return;
  }
  removeStaleSocket();

  Bun.serve({
    fetch: async (req) => {
      try {
        const rawBody: unknown = await req.json();
        const result = await dispatch(rawBody);
        return new Response(result, {
          headers: { "content-type": "application/json" },
        });
      } catch (err) {
        const message = toErrorMessage(err);
        return new Response(JSON.stringify({ error: message }), {
          status: 500,
        });
      }
    },
    unix: SOCKET_PATH,
  });
  shutdownOnSignals(state);
  setInterval(reapIdle, REAP_INTERVAL_MS);

  log.info(`daemon listening on ${SOCKET_PATH} (pid: ${process.pid})`);
};

export { start };
