import type { Page } from "puppeteer-core";
import { z } from "zod";
import { track } from "./activity.ts";
import type { Session } from "./browser.ts";
import type { DaemonState } from "./commands/lifecycle.ts";
import type { TraceCapture } from "./commands/performance.ts";
import { parseTarget, targetKey, type Target } from "./target.ts";

export type Flag = Readonly<{
  flag: string;
  description: string;
  required: boolean;
}>;

export type CliOptions = Readonly<Record<string, string>>;

export type CliSpec = Readonly<{
  name: string;
  description: string;
  flags: readonly Flag[];
  toPayload: (opts: CliOptions) => Record<string, unknown>;
}>;

export type CommandContext = Readonly<{
  state: DaemonState;
  traceCaptures: Map<string, TraceCapture>;
  getSession: (target: Target) => Promise<Session>;
}>;

type Payload = Readonly<Record<string, unknown>>;
type CommandResult = string | Promise<string>;

type CommandHandler = (
  context: CommandContext,
  input: Payload,
) => CommandResult;
export type CommandEntry = readonly [action: string, handler: CommandHandler];

export type Command = Readonly<{
  cli: CliSpec & Readonly<{ needsTarget: boolean }>;
  execute: CommandHandler;
}>;

export const req = (flag: string, description: string): Flag => ({
  description,
  flag,
  required: true,
});
export const opt = (flag: string, description: string): Flag => ({
  description,
  flag,
  required: false,
});
export const textParam = (name: string) =>
  z.string({ error: `param '${name}' must be a string` });
export const numberParam = (name: string) =>
  z.number({ error: `param '${name}' must be a number` });
const UnknownParam = z.unknown();
export const arrayParam = (name: string) =>
  z.array(UnknownParam, { error: `param '${name}' must be an array` });
export const toggle = z.coerce.boolean().default(false);
export const noParams = z.object({}).readonly();

export const defineDaemonCommand = <Schema extends z.ZodType>(
  cli: CliSpec,
  schema: Schema,
  run: (context: CommandContext, params: z.output<Schema>) => CommandResult,
): Command => ({
  cli: { ...cli, needsTarget: false },
  execute: (context, input) => {
    const params = schema.parse(input);
    return run(context, params);
  },
});

export const defineTargetCommand = <Schema extends z.ZodType>(
  cli: CliSpec,
  schema: Schema,
  run: (
    context: CommandContext,
    target: Target,
    params: z.output<Schema>,
  ) => CommandResult,
): Command => ({
  cli: { ...cli, needsTarget: true },
  execute: async (context, input) => {
    const params = schema.parse(input);
    const target = parseTarget(input);
    const key = targetKey(target);
    const execute = async () => run(context, target, params);
    if (!context.state.capacity.owned.has(key)) return execute();
    return track(context.state.activity, key, execute);
  },
});

export const definePageCommand = <Schema extends z.ZodType>(
  cli: CliSpec,
  schema: Schema,
  run: (page: Page, params: z.output<Schema>) => CommandResult,
): Command =>
  defineTargetCommand(cli, schema, async ({ getSession }, target, params) => {
    const { page } = await getSession(target);
    return run(page, params);
  });
