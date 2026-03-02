import { Command } from "commander";
import { log } from "./src/log";
import { ensureDaemon, send } from "./src/client";

type Flag = {
  flag: string;
  description: string;
  required: boolean;
};

type CliCommand = {
  name: string;
  description: string;
  needsPort: boolean;
  flags: Flag[];
  toPayload: (opts: Record<string, string>) => Record<string, unknown>;
};

const req = (flag: string, desc: string): Flag => ({ flag, description: desc, required: true });
const opt = (flag: string, desc: string): Flag => ({ flag, description: desc, required: false });

const parseViewport = (v: string) => {
  const parts = v.split("x");
  return { width: Number(parts[0]), height: Number(parts[1]) };
};

const parseGeo = (v: string) => {
  const parts = v.split(",");
  return { latitude: Number(parts[0]), longitude: Number(parts[1]) };
};

const cliCommands: CliCommand[] = [
  {
    name: "launch",
    description: "Launch a new Chrome instance",
    needsPort: false,
    flags: [opt("--headed", "launch with visible window")],
    toPayload: (o) => ({ headless: !o.headed }),
  },
  {
    name: "kill",
    description: "Kill a Chrome instance by port",
    needsPort: true,
    flags: [],
    toPayload: () => ({}),
  },
  {
    name: "kill-all",
    description: "Kill all tracked Chrome instances",
    needsPort: false,
    flags: [],
    toPayload: () => ({}),
  },
  {
    name: "navigate",
    description: "Navigate the current page to a URL",
    needsPort: true,
    flags: [req("--url <url>", "target URL"), req("--timeout <ms>", "navigation timeout")],
    toPayload: (o) => ({ url: o.url, timeout: Number(o.timeout) }),
  },
  {
    name: "back",
    description: "Navigate back in browser history",
    needsPort: true,
    flags: [],
    toPayload: () => ({}),
  },
  {
    name: "forward",
    description: "Navigate forward in browser history",
    needsPort: true,
    flags: [],
    toPayload: () => ({}),
  },
  {
    name: "reload",
    description: "Reload the current page",
    needsPort: true,
    flags: [],
    toPayload: () => ({}),
  },
  {
    name: "snapshot",
    description: "Take an accessibility tree snapshot",
    needsPort: true,
    flags: [],
    toPayload: () => ({}),
  },
  {
    name: "screenshot",
    description: "Take a screenshot (PNG)",
    needsPort: true,
    flags: [opt("--path <path>", "save to file"), opt("--full-page", "capture full page")],
    toPayload: (o) => ({ path: o.path, fullPage: !!o.fullPage }),
  },
  {
    name: "click",
    description: "Click an element by uid",
    needsPort: true,
    flags: [req("--uid <uid>", "element uid from snapshot"), opt("--dbl-click", "double click")],
    toPayload: (o) => ({ uid: o.uid, dblClick: !!o.dblClick }),
  },
  {
    name: "hover",
    description: "Hover over an element by uid",
    needsPort: true,
    flags: [req("--uid <uid>", "element uid from snapshot")],
    toPayload: (o) => ({ uid: o.uid }),
  },
  {
    name: "fill",
    description: "Clear and type a value into an input",
    needsPort: true,
    flags: [req("--uid <uid>", "element uid"), req("--value <value>", "text to type")],
    toPayload: (o) => ({ uid: o.uid, value: o.value }),
  },
  {
    name: "type",
    description: "Type text into the focused element",
    needsPort: true,
    flags: [req("--text <text>", "text to type"), opt("--submit-key <key>", "key to press after")],
    toPayload: (o) => ({ text: o.text, submitKey: o.submitKey }),
  },
  {
    name: "press",
    description: "Press a key or combination",
    needsPort: true,
    flags: [req("--key <key>", "key or combination")],
    toPayload: (o) => ({ key: o.key }),
  },
  {
    name: "drag",
    description: "Drag an element onto another",
    needsPort: true,
    flags: [req("--from <uid>", "element to drag"), req("--to <uid>", "drop target")],
    toPayload: (o) => ({ from: o.from, to: o.to }),
  },
  {
    name: "upload",
    description: "Upload a file through a file input",
    needsPort: true,
    flags: [req("--uid <uid>", "file input uid"), req("--file <path>", "local file path")],
    toPayload: (o) => ({ uid: o.uid, file: o.file }),
  },
  {
    name: "eval",
    description: "Evaluate JavaScript in page context",
    needsPort: true,
    flags: [req("--expression <code>", "JavaScript expression")],
    toPayload: (o) => ({ expression: o.expression }),
  },
  {
    name: "pages",
    description: "List all open pages/tabs",
    needsPort: true,
    flags: [],
    toPayload: () => ({}),
  },
  {
    name: "new-page",
    description: "Open a new page/tab",
    needsPort: true,
    flags: [req("--url <url>", "URL to load")],
    toPayload: (o) => ({ url: o.url }),
  },
  {
    name: "close-page",
    description: "Close a page/tab by index",
    needsPort: true,
    flags: [req("--page-id <id>", "page index")],
    toPayload: (o) => ({ pageId: Number(o.pageId) }),
  },
  {
    name: "select-page",
    description: "Switch focus to a page/tab",
    needsPort: true,
    flags: [req("--page-id <id>", "page index")],
    toPayload: (o) => ({ pageId: Number(o.pageId) }),
  },
  {
    name: "emulate",
    description: "Emulate device features",
    needsPort: true,
    flags: [
      opt("--viewport <WxH>", "viewport size"),
      opt("--user-agent <string>", "user agent string"),
      opt("--geolocation <lat,lng>", "geolocation"),
      opt("--color-scheme <scheme>", "dark or light"),
    ],
    toPayload: (o) => ({
      viewport: o.viewport ? parseViewport(o.viewport) : undefined,
      userAgent: o.userAgent,
      geolocation: o.geolocation ? parseGeo(o.geolocation) : undefined,
      colorScheme: o.colorScheme,
    }),
  },
  {
    name: "wait",
    description: "Wait for text to appear on the page",
    needsPort: true,
    flags: [req("--text <texts>", "comma-separated texts"), req("--timeout <ms>", "max wait time")],
    toPayload: (o) => {
      const text = o.text;
      if (!text) throw new Error("--text is required");
      return { texts: text.split(","), timeout: Number(o.timeout) };
    },
  },
  {
    name: "dialog",
    description: "Handle a browser dialog",
    needsPort: true,
    flags: [req("--action <action>", "accept or dismiss"), opt("--prompt-text <text>", "prompt input")],
    toPayload: (o) => ({ dialogAction: o.action, promptText: o.promptText }),
  },
  {
    name: "trace-start",
    description: "Start a performance trace",
    needsPort: true,
    flags: [opt("--path <path>", "save trace to file")],
    toPayload: (o) => ({ path: o.path }),
  },
  {
    name: "trace-stop",
    description: "Stop the performance trace",
    needsPort: true,
    flags: [opt("--path <path>", "save trace to file")],
    toPayload: (o) => ({ path: o.path }),
  },
  {
    name: "heap-snapshot",
    description: "Capture a heap memory snapshot",
    needsPort: true,
    flags: [req("--path <path>", "save .heapsnapshot to file")],
    toPayload: (o) => ({ path: o.path }),
  },
  {
    name: "network-start",
    description: "Start capturing network requests",
    needsPort: true,
    flags: [],
    toPayload: () => ({}),
  },
  {
    name: "network-list",
    description: "List captured network requests",
    needsPort: true,
    flags: [opt("--type <type>", "filter by resource type")],
    toPayload: (o) => ({ type: o.type }),
  },
  {
    name: "network-stop",
    description: "Stop capturing network requests",
    needsPort: true,
    flags: [],
    toPayload: () => ({}),
  },
  {
    name: "console-start",
    description: "Start capturing console messages",
    needsPort: true,
    flags: [],
    toPayload: () => ({}),
  },
  {
    name: "console-list",
    description: "List captured console messages",
    needsPort: true,
    flags: [opt("--type <type>", "filter by message type")],
    toPayload: (o) => ({ type: o.type }),
  },
  {
    name: "console-stop",
    description: "Stop capturing console messages",
    needsPort: true,
    flags: [],
    toPayload: () => ({}),
  },
];

const run = (fn: (opts: Record<string, string>) => Promise<string>) =>
  async (opts: Record<string, string>) => {
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

cliCommands.forEach((def) => {
  const cmd = program.command(def.name).description(def.description);

  if (def.needsPort) {
    cmd.requiredOption("--port <port>", "Chrome debug port");
  }

  def.flags.forEach((f) => {
    if (f.required) cmd.requiredOption(f.flag, f.description);
    else cmd.option(f.flag, f.description);
  });

  cmd.action(run((opts) => {
    const payload: Record<string, unknown> = { action: def.name };
    if (def.needsPort && opts.port) {
      payload.port = Number(opts.port);
    }
    Object.assign(payload, def.toPayload(opts));
    return send(payload);
  }));
});

program.parseAsync();
