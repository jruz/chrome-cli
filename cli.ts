import { Command, Option } from "commander";
import { log } from "./src/log";
import {
  ensureDaemon,
  isDaemonRunning,
  send,
  startDaemon,
  stopDaemon,
} from "./src/client";
import { versionString } from "./src/version";

type Flag = {
  flag: string;
  description: string;
  required: boolean;
};

type CliCommand = {
  name: string;
  description: string;
  needsTarget: boolean;
  flags: Flag[];
  toPayload: (opts: Record<string, string>) => Record<string, unknown>;
};

const req = (flag: string, desc: string): Flag => ({
  description: desc,
  flag,
  required: true,
});
const opt = (flag: string, desc: string): Flag => ({
  description: desc,
  flag,
  required: false,
});

const parseViewport = (v: string) => {
  const parts = v.split("x");
  return { height: Number(parts[1]), width: Number(parts[0]) };
};

const parseGeo = (v: string) => {
  const parts = v.split(",");
  return { latitude: Number(parts[0]), longitude: Number(parts[1]) };
};

const cliCommands: CliCommand[] = [
  {
    description: "Launch a new Chrome instance",
    flags: [opt("--headed", "launch with visible window")],
    name: "launch",
    needsTarget: false,
    toPayload: (o) => ({ headless: !o["headed"] }),
  },
  {
    description: "Kill a Chrome instance by session or port",
    flags: [],
    name: "kill",
    needsTarget: true,
    toPayload: () => ({}),
  },
  {
    description: "One-shot: launch, navigate, snapshot/screenshot, kill",
    flags: [
      req("--url <url>", "target URL"),
      req("--mode <mode>", "snapshot or screenshot"),
      opt("--timeout <ms>", "navigation timeout (default: 30000)"),
      opt("--path <path>", "save to file"),
      opt("--verbose", "include all a11y properties"),
      opt("--full-page", "capture full page (default for screenshot)"),
      opt("--format <format>", "png, jpeg, or webp (default: png)"),
      opt("--quality <n>", "compression quality 0-100 (jpeg/webp)"),
      opt("--width <px>", "viewport width (default: 1366)"),
      opt("--height <px>", "viewport height (default: 768)"),
    ],
    name: "oneshot",
    needsTarget: false,
    toPayload: (o) => ({
      format: o["format"],
      fullPage: !!o["fullPage"],
      mode: o["mode"],
      path: o["path"],
      ...(o["timeout"] ? { timeout: Number(o["timeout"]) } : {}),
      url: o["url"],
      verbose: !!o["verbose"],
      ...(o["quality"] ? { quality: Number(o["quality"]) } : {}),
      ...(o["width"] ? { width: Number(o["width"]) } : {}),
      ...(o["height"] ? { height: Number(o["height"]) } : {}),
    }),
  },
  {
    description: "Navigate the current page to a URL",
    flags: [
      req("--url <url>", "target URL"),
      req("--timeout <ms>", "navigation timeout"),
      opt("--init-script <code>", "JavaScript to inject before load"),
      opt(
        "--handle-before-unload <action>",
        "auto-handle beforeunload dialog (accept or decline)",
      ),
    ],
    name: "navigate",
    needsTarget: true,
    toPayload: (o) => ({
      handleBeforeUnload: o["handleBeforeUnload"],
      initScript: o["initScript"],
      timeout: Number(o["timeout"]),
      url: o["url"],
    }),
  },
  {
    description: "Navigate back in browser history",
    flags: [],
    name: "back",
    needsTarget: true,
    toPayload: () => ({}),
  },
  {
    description: "Navigate forward in browser history",
    flags: [],
    name: "forward",
    needsTarget: true,
    toPayload: () => ({}),
  },
  {
    description: "Reload the current page",
    flags: [opt("--ignore-cache", "bypass cache on reload")],
    name: "reload",
    needsTarget: true,
    toPayload: (o) => ({ ignoreCache: !!o["ignoreCache"] }),
  },
  {
    description: "Take an accessibility tree snapshot",
    flags: [
      opt("--verbose", "include all a11y properties"),
      opt("--path <path>", "save to file"),
    ],
    name: "snapshot",
    needsTarget: true,
    toPayload: (o) => ({ filePath: o["path"], verbose: !!o["verbose"] }),
  },
  {
    description: "Take a screenshot",
    flags: [
      opt("--path <path>", "save to file"),
      opt("--full-page", "capture full page"),
      req("--format <format>", "png, jpeg, or webp"),
      opt("--quality <n>", "compression quality 0-100 (jpeg/webp)"),
      opt("--uid <uid>", "capture a single element"),
    ],
    name: "screenshot",
    needsTarget: true,
    toPayload: (o) => ({
      format: o["format"],
      fullPage: !!o["fullPage"],
      path: o["path"],
      quality: o["quality"] ? Number(o["quality"]) : undefined,
      uid: o["uid"],
    }),
  },
  {
    description: "Click an element by uid",
    flags: [
      req("--uid <uid>", "element uid from snapshot"),
      opt("--dbl-click", "double click"),
      opt("--include-snapshot", "include snapshot in response"),
    ],
    name: "click",
    needsTarget: true,
    toPayload: (o) => ({
      dblClick: !!o["dblClick"],
      includeSnapshot: !!o["includeSnapshot"],
      uid: o["uid"],
    }),
  },
  {
    description: "Hover over an element by uid",
    flags: [
      req("--uid <uid>", "element uid from snapshot"),
      opt("--include-snapshot", "include snapshot in response"),
    ],
    name: "hover",
    needsTarget: true,
    toPayload: (o) => ({
      includeSnapshot: !!o["includeSnapshot"],
      uid: o["uid"],
    }),
  },
  {
    description: "Clear and type a value into an input",
    flags: [
      req("--uid <uid>", "element uid"),
      req("--value <value>", "text to type"),
      opt("--include-snapshot", "include snapshot in response"),
    ],
    name: "fill",
    needsTarget: true,
    toPayload: (o) => ({
      includeSnapshot: !!o["includeSnapshot"],
      uid: o["uid"],
      value: o["value"],
    }),
  },
  {
    description: "Type text into the focused element",
    flags: [
      req("--text <text>", "text to type"),
      opt("--submit-key <key>", "key to press after"),
      opt("--include-snapshot", "include snapshot in response"),
    ],
    name: "type",
    needsTarget: true,
    toPayload: (o) => ({
      includeSnapshot: !!o["includeSnapshot"],
      submitKey: o["submitKey"],
      text: o["text"],
    }),
  },
  {
    description: "Press a key or combination",
    flags: [
      req("--key <key>", "key or combination"),
      opt("--include-snapshot", "include snapshot in response"),
    ],
    name: "press",
    needsTarget: true,
    toPayload: (o) => ({
      includeSnapshot: !!o["includeSnapshot"],
      key: o["key"],
    }),
  },
  {
    description: "Drag an element onto another",
    flags: [
      req("--from <uid>", "element to drag"),
      req("--to <uid>", "drop target"),
      opt("--include-snapshot", "include snapshot in response"),
    ],
    name: "drag",
    needsTarget: true,
    toPayload: (o) => ({
      from: o["from"],
      includeSnapshot: !!o["includeSnapshot"],
      to: o["to"],
    }),
  },
  {
    description: "Upload a file through a file input",
    flags: [
      req("--uid <uid>", "file input uid"),
      req("--file <path>", "local file path"),
      opt("--include-snapshot", "include snapshot in response"),
    ],
    name: "upload",
    needsTarget: true,
    toPayload: (o) => ({
      file: o["file"],
      includeSnapshot: !!o["includeSnapshot"],
      uid: o["uid"],
    }),
  },
  {
    description: "Fill multiple form elements at once",
    flags: [
      req("--fields <json>", "JSON array of {uid, value} objects"),
      opt("--include-snapshot", "include snapshot in response"),
    ],
    name: "fill-form",
    needsTarget: true,
    toPayload: (o) => {
      const raw = o["fields"];
      if (!raw) throw new Error("--fields is required");
      try {
        return {
          fields: JSON.parse(raw),
          includeSnapshot: !!o["includeSnapshot"],
        };
      } catch (err) {
        throw new Error(`invalid JSON for --fields: ${String(err)}`, {
          cause: err,
        });
      }
    },
  },
  {
    description: "Resize the page viewport",
    flags: [
      req("--width <px>", "viewport width"),
      req("--height <px>", "viewport height"),
    ],
    name: "resize",
    needsTarget: true,
    toPayload: (o) => ({
      height: Number(o["height"]),
      width: Number(o["width"]),
    }),
  },
  {
    description: "Evaluate JavaScript in page context",
    flags: [
      req("--expression <code>", "JavaScript expression"),
      opt("--args <json>", "JSON array of {uid} element references"),
    ],
    name: "eval",
    needsTarget: true,
    toPayload: (o) => {
      const argsRaw = o["args"];
      if (!argsRaw) return { expression: o["expression"] };
      try {
        return { args: JSON.parse(argsRaw), expression: o["expression"] };
      } catch (err) {
        throw new Error(`invalid JSON for --args: ${String(err)}`, {
          cause: err,
        });
      }
    },
  },
  {
    description: "List all open pages/tabs",
    flags: [],
    name: "pages",
    needsTarget: true,
    toPayload: () => ({}),
  },
  {
    description: "Open a new page/tab",
    flags: [
      req("--url <url>", "URL to load"),
      opt("--background", "open without focusing"),
      opt(
        "--isolated-context <name>",
        "create page in isolated browser context",
      ),
      opt("--timeout <ms>", "navigation timeout"),
    ],
    name: "new-page",
    needsTarget: true,
    toPayload: (o) => ({
      background: !!o["background"],
      isolatedContext: o["isolatedContext"],
      timeout: o["timeout"] ? Number(o["timeout"]) : undefined,
      url: o["url"],
    }),
  },
  {
    description: "Close a page/tab by index",
    flags: [req("--page-id <id>", "page index")],
    name: "close-page",
    needsTarget: true,
    toPayload: (o) => ({ pageId: Number(o["pageId"]) }),
  },
  {
    description: "Switch focus to a page/tab",
    flags: [
      req("--page-id <id>", "page index"),
      opt("--no-bring-to-front", "select without focusing"),
    ],
    name: "select-page",
    needsTarget: true,
    toPayload: (o) => ({
      noBringToFront: !!o["noBringToFront"],
      pageId: Number(o["pageId"]),
    }),
  },
  {
    description: "Emulate device features",
    flags: [
      opt("--viewport <WxH>", "viewport size (WxH or 'reset')"),
      opt("--has-touch", "enable touch events"),
      opt("--is-mobile", "enable mobile viewport"),
      opt("--is-landscape", "landscape orientation"),
      opt("--device-scale-factor <n>", "device pixel ratio"),
      opt("--user-agent <string>", "user agent string (or 'reset')"),
      opt("--geolocation <lat,lng>", "geolocation (or 'reset')"),
      opt("--color-scheme <scheme>", "dark, light, or auto"),
      opt("--cpu-throttling <rate>", "CPU slowdown factor (1 to disable)"),
      opt(
        "--network-conditions <preset>",
        "Offline, Slow 3G, Fast 3G, Slow 4G, Fast 4G, No emulation",
      ),
    ],
    name: "emulate",
    needsTarget: true,
    toPayload: (o) => {
      const resolveViewport = () => {
        if (!o["viewport"]) return undefined;
        if (o["viewport"] === "reset") return "reset";
        const vp = parseViewport(o["viewport"]);
        return {
          ...vp,
          ...(o["hasTouch"] ? { hasTouch: true } : {}),
          ...(o["isMobile"] ? { isMobile: true } : {}),
          ...(o["isLandscape"] ? { isLandscape: true } : {}),
          ...(o["deviceScaleFactor"]
            ? { deviceScaleFactor: Number(o["deviceScaleFactor"]) }
            : {}),
        };
      };

      const resolveGeo = () => {
        if (!o["geolocation"]) return undefined;
        if (o["geolocation"] === "reset") return "reset";
        return parseGeo(o["geolocation"]);
      };

      return {
        colorScheme: o["colorScheme"],
        cpuThrottlingRate: o["cpuThrottling"]
          ? Number(o["cpuThrottling"])
          : undefined,
        geolocation: resolveGeo(),
        networkConditions: o["networkConditions"],
        userAgent: o["userAgent"],
        viewport: resolveViewport(),
      };
    },
  },
  {
    description: "Wait for text to appear on the page",
    flags: [
      req("--text <texts>", "comma-separated texts"),
      req("--timeout <ms>", "max wait time"),
    ],
    name: "wait",
    needsTarget: true,
    toPayload: (o) => {
      const text = o["text"];
      if (!text) throw new Error("--text is required");
      return { texts: text.split(","), timeout: Number(o["timeout"]) };
    },
  },
  {
    description: "Handle a browser dialog",
    flags: [
      req("--action <action>", "accept or dismiss"),
      opt("--prompt-text <text>", "prompt input"),
    ],
    name: "dialog",
    needsTarget: true,
    toPayload: (o) => ({
      dialogAction: o["action"],
      promptText: o["promptText"],
    }),
  },
  {
    description: "Start a performance trace",
    flags: [
      opt("--path <path>", "save trace to file"),
      opt("--reload", "reload page after starting trace"),
      opt("--auto-stop", "stop trace after page loads"),
    ],
    name: "trace-start",
    needsTarget: true,
    toPayload: (o) => ({
      autoStop: !!o["autoStop"],
      path: o["path"],
      reload: !!o["reload"],
    }),
  },
  {
    description: "Stop the performance trace",
    flags: [opt("--path <path>", "save trace to file")],
    name: "trace-stop",
    needsTarget: true,
    toPayload: (o) => ({ path: o["path"] }),
  },
  {
    description: "Analyze a trace file for performance insights",
    flags: [req("--path <path>", "trace file to analyze")],
    name: "trace-analyze",
    needsTarget: false,
    toPayload: (o) => ({ path: o["path"] }),
  },
  {
    description: "Get detailed info on a specific performance insight",
    flags: [
      req("--path <path>", "trace file to analyze"),
      req("--insight-set-id <id>", "insight set ID from trace-analyze output"),
      req(
        "--insight-name <name>",
        "insight name (DocumentLatency, LCPBreakdown, RenderBlocking, CLSCulprits, LongTasks)",
      ),
    ],
    name: "trace-analyze-insight",
    needsTarget: false,
    toPayload: (o) => ({
      insightName: o["insightName"],
      insightSetId: o["insightSetId"],
      path: o["path"],
    }),
  },
  {
    description: "Capture a heap memory snapshot",
    flags: [req("--path <path>", "save .heapsnapshot to file")],
    name: "heap-snapshot",
    needsTarget: true,
    toPayload: (o) => ({ path: o["path"] }),
  },
  {
    description: "Start capturing network requests",
    flags: [],
    name: "network-start",
    needsTarget: true,
    toPayload: () => ({}),
  },
  {
    description: "List captured network requests",
    flags: [
      opt("--type <type>", "filter by resource type"),
      opt("--include-preserved", "include requests from last 3 navigations"),
      opt("--page-size <n>", "results per page"),
      opt("--page-idx <n>", "page number (0-based)"),
    ],
    name: "network-list",
    needsTarget: true,
    toPayload: (o) => ({
      includePreserved: !!o["includePreserved"],
      pageIdx: o["pageIdx"] ? Number(o["pageIdx"]) : undefined,
      pageSize: o["pageSize"] ? Number(o["pageSize"]) : undefined,
      type: o["type"],
    }),
  },
  {
    description: "Get a single network request with full detail",
    flags: [
      req("--reqid <id>", "request index"),
      opt("--request-file <path>", "save request body to file"),
      opt("--response-file <path>", "save response body to file"),
    ],
    name: "network-get",
    needsTarget: true,
    toPayload: (o) => ({
      reqid: Number(o["reqid"]),
      requestFile: o["requestFile"],
      responseFile: o["responseFile"],
    }),
  },
  {
    description: "Stop capturing network requests",
    flags: [],
    name: "network-stop",
    needsTarget: true,
    toPayload: () => ({}),
  },
  {
    description: "Start capturing console messages",
    flags: [],
    name: "console-start",
    needsTarget: true,
    toPayload: () => ({}),
  },
  {
    description: "List captured console messages",
    flags: [
      opt("--type <type>", "filter by message type"),
      opt("--include-preserved", "include messages from last 3 navigations"),
      opt("--page-size <n>", "results per page"),
      opt("--page-idx <n>", "page number (0-based)"),
    ],
    name: "console-list",
    needsTarget: true,
    toPayload: (o) => ({
      includePreserved: !!o["includePreserved"],
      pageIdx: o["pageIdx"] ? Number(o["pageIdx"]) : undefined,
      pageSize: o["pageSize"] ? Number(o["pageSize"]) : undefined,
      type: o["type"],
    }),
  },
  {
    description: "Get a single console message by index",
    flags: [req("--msgid <id>", "message index")],
    name: "console-get",
    needsTarget: true,
    toPayload: (o) => ({ msgid: Number(o["msgid"]) }),
  },
  {
    description: "Stop capturing console messages",
    flags: [],
    name: "console-stop",
    needsTarget: true,
    toPayload: () => ({}),
  },
];

const targetPayload = (opts: Record<string, string>) => {
  const session = opts["session"];
  if (session) return { session };
  const port = opts["port"];
  if (port) return { port: Number(port) };
  throw new Error("one of --session or --port is required");
};

const run =
  (fn: (opts: Record<string, string>) => Promise<string>) =>
  async (opts: Record<string, string>) => {
    await ensureDaemon();
    try {
      const result = await fn(opts);
      log.info(result);
    } catch (err) {
      log.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  };

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

const runDaemon = (fn: () => Promise<string>) => async () => {
  try {
    const result = await fn();
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

const daemonStartAction = runDaemon(async () => {
  const running = await isDaemonRunning();
  if (running) {
    const status = await send({ action: "status" });
    const payload = withRunning(status, true);
    const parsed = parseJson(payload);
    return JSON.stringify({ started: false, ...parsed });
  }

  await startDaemon();
  const status = await send({ action: "status" });
  const payload = withRunning(status, true);
  const parsed = parseJson(payload);
  return JSON.stringify({ started: true, ...parsed });
});
program
  .command("daemon-start")
  .description("Start the background daemon")
  .action(daemonStartAction);

const daemonStatusAction = runDaemon(async () => {
  const running = await isDaemonRunning();
  if (!running) {
    return JSON.stringify({ running: false });
  }

  const status = await send({ action: "status" });
  return withRunning(status, true);
});
program
  .command("daemon-status")
  .description("Show daemon status")
  .action(daemonStatusAction);

const daemonStopAction = runDaemon(async () => {
  const running = await isDaemonRunning();
  if (!running) {
    throw new Error("daemon is not running");
  }

  const result = await stopDaemon();
  return withRunning(result, false);
});
program
  .command("daemon-stop")
  .description("Stop the background daemon")
  .action(daemonStopAction);

program
  .command("kill-all")
  .description("Kill all tracked Chrome instances")
  .option(
    "--include-orphans",
    "also stop all Chrome CLI daemons and orphaned browsers (Linux)",
  )
  .action(async (opts: { readonly includeOrphans?: boolean }) => {
    if (opts.includeOrphans) {
      return runDaemon(async () => {
        const { killAllIncludingOrphans } =
          await import("./src/emergency-cleanup.ts");
        return killAllIncludingOrphans();
      })();
    }
    return runDaemon(async () => {
      await ensureDaemon();
      return send({ action: "kill-all" });
    })();
  });

cliCommands.forEach((def) => {
  const cmd = program.command(def.name).description(def.description);

  if (def.needsTarget) {
    const session = new Option(
      "--session <id>",
      "browser launched by launch",
    ).conflicts("port");
    cmd.addOption(session);
    cmd.option("--port <port>", "debug port of an external Chrome");
  }

  def.flags.forEach((f) => {
    if (f.required) cmd.requiredOption(f.flag, f.description);
    else cmd.option(f.flag, f.description);
  });

  const action = run((opts) => {
    const payload: Record<string, unknown> = { action: def.name };
    if (def.needsTarget) {
      const target = targetPayload(opts);
      Object.assign(payload, target);
    }
    const extra = def.toPayload(opts);
    Object.assign(payload, extra);
    return send(payload);
  });
  cmd.action(action);
});

if (process.argv.includes("--__daemon")) {
  const { start } = await import("./src/daemon");
  start();
} else {
  await program.parseAsync();
}
