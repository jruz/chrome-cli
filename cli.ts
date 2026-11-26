import { Command, Option } from "commander";
import { log } from "./src/log.ts";
import { ensureDaemon, send } from "./src/client.ts";
import type { CliOptions, Flag } from "./src/command.ts";
import { commands } from "./src/commands.ts";
import { localCommands } from "./src/commands/daemon-client.ts";
import { versionString } from "./src/version.ts";

const targetPayload = (opts: CliOptions) => {
  const session = opts["session"];
  if (session) return { session };
  const port = opts["port"];
  if (port) return { port: Number(port) };
  throw new Error("one of --session or --port is required");
};

const run =
  (fn: (opts: CliOptions) => Promise<string>) => async (opts: CliOptions) => {
    try {
      const result = await fn(opts);
      log.info(result);
    } catch (err) {
      log.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  };

const version = versionString();
const program = new Command()
  .name("chrome-cli")
  .description("Control Chrome via CDP (Chrome DevTools Protocol)")
  .version(version);

const register = (
  spec: Readonly<{ name: string; description: string; flags: readonly Flag[] }>,
  needsTarget: boolean,
) => {
  const cmd = program.command(spec.name).description(spec.description);
  if (needsTarget) {
    const session = new Option(
      "--session <id>",
      "browser launched by launch",
    ).conflicts("port");
    cmd.addOption(session);
    cmd.option("--port <port>", "debug port of an external Chrome");
  }
  spec.flags.forEach((flag) => {
    if (flag.required) cmd.requiredOption(flag.flag, flag.description);
    else cmd.option(flag.flag, flag.description);
  });
  return cmd;
};

localCommands.forEach((spec) => {
  const cmd = register(spec, false);
  const action = run(spec.run);
  cmd.action(action);
});

commands.forEach(({ cli }) => {
  const cmd = register(cli, cli.needsTarget);
  const action = run(async (opts) => {
    await ensureDaemon();
    const target = cli.needsTarget ? targetPayload(opts) : {};
    const extra = cli.toPayload(opts);
    return send({ action: cli.name, ...target, ...extra });
  });
  cmd.action(action);
});

if (process.argv.includes("--__daemon")) {
  const { start } = await import("./src/daemon.ts");
  start();
} else {
  await program.parseAsync();
}
