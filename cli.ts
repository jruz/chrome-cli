import { Command } from "commander";
import { log } from "./src/log";
import { ensureDaemon, send } from "./src/client";
import { commands } from "./src/registry";

const run = (fn: (opts: Record<string, any>) => Promise<string>) =>
  async (opts: Record<string, any>) => {
    await ensureDaemon();
    try {
      log.info(await fn(opts));
    } catch (err) {
      log.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  };

const program = new Command()
  .name("chrome-cli")
  .description("Control Chrome via CDP (Chrome DevTools Protocol)")
  .version("0.1.0");

program.command("daemon-start")
  .description("Start the background daemon")
  .action(run(async () => send({ action: "status" })));

program.command("daemon-status")
  .description("Show daemon status")
  .action(run(async () => send({ action: "status" })));

program.command("daemon-stop")
  .description("Stop the background daemon")
  .action(run(async () => send({ action: "shutdown" })));

commands.forEach((def) => {
  if (def.name === "status" || def.name === "shutdown") return;

  const cmd = program.command(def.name).description(def.description);

  if (def.needs === "page" || def.needs === "browser") {
    cmd.requiredOption("--port <port>", "Chrome debug port");
  }

  def.flags.forEach((f) => {
    if (f.required) cmd.requiredOption(f.flag, f.description);
    else cmd.option(f.flag, f.description);
  });

  cmd.action(run((opts) => {
    const payload: Record<string, unknown> = { action: def.name };
    if ((def.needs === "page" || def.needs === "browser") && opts.port) {
      payload.port = Number(opts.port);
    }
    Object.assign(payload, def.toPayload(opts));
    return send(payload);
  }));
});

program.parseAsync();
