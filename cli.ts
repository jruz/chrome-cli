import { Command } from "commander";
import { log } from "./src/log";
import { ensureDaemon, send } from "./src/client";
import { versionString } from "./src/version";

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
    toPayload: (o) => ({ headless: !o['headed'] }),
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
    flags: [
      req("--url <url>", "target URL"),
      req("--timeout <ms>", "navigation timeout"),
      opt("--init-script <code>", "JavaScript to inject before load"),
      opt("--handle-before-unload <action>", "auto-handle beforeunload dialog (accept or decline)"),
    ],
    toPayload: (o) => ({ url: o['url'], timeout: Number(o['timeout']), initScript: o['initScript'], handleBeforeUnload: o['handleBeforeUnload'] }),
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
    flags: [opt("--ignore-cache", "bypass cache on reload")],
    toPayload: (o) => ({ ignoreCache: !!o['ignoreCache'] }),
  },
  {
    name: "snapshot",
    description: "Take an accessibility tree snapshot",
    needsPort: true,
    flags: [opt("--verbose", "include all a11y properties"), opt("--path <path>", "save to file")],
    toPayload: (o) => ({ verbose: !!o['verbose'], filePath: o['path'] }),
  },
  {
    name: "screenshot",
    description: "Take a screenshot",
    needsPort: true,
    flags: [
      opt("--path <path>", "save to file"),
      opt("--full-page", "capture full page"),
      req("--format <format>", "png, jpeg, or webp"),
      opt("--quality <n>", "compression quality 0-100 (jpeg/webp)"),
      opt("--uid <uid>", "capture a single element"),
    ],
    toPayload: (o) => ({
      path: o['path'],
      fullPage: !!o['fullPage'],
      format: o['format'],
      quality: o['quality'] ? Number(o['quality']) : undefined,
      uid: o['uid'],
    }),
  },
  {
    name: "click",
    description: "Click an element by uid",
    needsPort: true,
    flags: [req("--uid <uid>", "element uid from snapshot"), opt("--dbl-click", "double click"), opt("--include-snapshot", "include snapshot in response")],
    toPayload: (o) => ({ uid: o['uid'], dblClick: !!o['dblClick'], includeSnapshot: !!o['includeSnapshot'] }),
  },
  {
    name: "hover",
    description: "Hover over an element by uid",
    needsPort: true,
    flags: [req("--uid <uid>", "element uid from snapshot"), opt("--include-snapshot", "include snapshot in response")],
    toPayload: (o) => ({ uid: o['uid'], includeSnapshot: !!o['includeSnapshot'] }),
  },
  {
    name: "fill",
    description: "Clear and type a value into an input",
    needsPort: true,
    flags: [req("--uid <uid>", "element uid"), req("--value <value>", "text to type"), opt("--include-snapshot", "include snapshot in response")],
    toPayload: (o) => ({ uid: o['uid'], value: o['value'], includeSnapshot: !!o['includeSnapshot'] }),
  },
  {
    name: "type",
    description: "Type text into the focused element",
    needsPort: true,
    flags: [req("--text <text>", "text to type"), opt("--submit-key <key>", "key to press after"), opt("--include-snapshot", "include snapshot in response")],
    toPayload: (o) => ({ text: o['text'], submitKey: o['submitKey'], includeSnapshot: !!o['includeSnapshot'] }),
  },
  {
    name: "press",
    description: "Press a key or combination",
    needsPort: true,
    flags: [req("--key <key>", "key or combination"), opt("--include-snapshot", "include snapshot in response")],
    toPayload: (o) => ({ key: o['key'], includeSnapshot: !!o['includeSnapshot'] }),
  },
  {
    name: "drag",
    description: "Drag an element onto another",
    needsPort: true,
    flags: [req("--from <uid>", "element to drag"), req("--to <uid>", "drop target"), opt("--include-snapshot", "include snapshot in response")],
    toPayload: (o) => ({ from: o['from'], to: o['to'], includeSnapshot: !!o['includeSnapshot'] }),
  },
  {
    name: "upload",
    description: "Upload a file through a file input",
    needsPort: true,
    flags: [req("--uid <uid>", "file input uid"), req("--file <path>", "local file path"), opt("--include-snapshot", "include snapshot in response")],
    toPayload: (o) => ({ uid: o['uid'], file: o['file'], includeSnapshot: !!o['includeSnapshot'] }),
  },
  {
    name: "fill-form",
    description: "Fill multiple form elements at once",
    needsPort: true,
    flags: [req("--fields <json>", "JSON array of {uid, value} objects"), opt("--include-snapshot", "include snapshot in response")],
    toPayload: (o) => {
      const raw = o['fields'];
      if (!raw) throw new Error("--fields is required");
      try {
        return { fields: JSON.parse(raw), includeSnapshot: !!o['includeSnapshot'] };
      } catch (err) {
        throw new Error(`invalid JSON for --fields: ${String(err)}`, { cause: err });
      }
    },
  },
  {
    name: "resize",
    description: "Resize the page viewport",
    needsPort: true,
    flags: [req("--width <px>", "viewport width"), req("--height <px>", "viewport height")],
    toPayload: (o) => ({ width: Number(o['width']), height: Number(o['height']) }),
  },
  {
    name: "eval",
    description: "Evaluate JavaScript in page context",
    needsPort: true,
    flags: [req("--expression <code>", "JavaScript expression"), opt("--args <json>", "JSON array of {uid} element references")],
    toPayload: (o) => {
      const argsRaw = o['args'];
      if (!argsRaw) return { expression: o['expression'] };
      try {
        return { expression: o['expression'], args: JSON.parse(argsRaw) };
      } catch (err) {
        throw new Error(`invalid JSON for --args: ${String(err)}`, { cause: err });
      }
    },
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
    flags: [
      req("--url <url>", "URL to load"),
      opt("--background", "open without focusing"),
      opt("--isolated-context <name>", "create page in isolated browser context"),
      opt("--timeout <ms>", "navigation timeout"),
    ],
    toPayload: (o) => ({ url: o['url'], background: !!o['background'], isolatedContext: o['isolatedContext'], timeout: o['timeout'] ? Number(o['timeout']) : undefined }),
  },
  {
    name: "close-page",
    description: "Close a page/tab by index",
    needsPort: true,
    flags: [req("--page-id <id>", "page index")],
    toPayload: (o) => ({ pageId: Number(o['pageId']) }),
  },
  {
    name: "select-page",
    description: "Switch focus to a page/tab",
    needsPort: true,
    flags: [req("--page-id <id>", "page index"), opt("--no-bring-to-front", "select without focusing")],
    toPayload: (o) => ({ pageId: Number(o['pageId']), noBringToFront: !!o['noBringToFront'] }),
  },
  {
    name: "emulate",
    description: "Emulate device features",
    needsPort: true,
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
      opt("--network-conditions <preset>", "Offline, Slow 3G, Fast 3G, Slow 4G, Fast 4G, No emulation"),
    ],
    toPayload: (o) => {
      const resolveViewport = () => {
        if (!o['viewport']) return undefined;
        if (o['viewport'] === "reset") return "reset";
        const vp = parseViewport(o['viewport']);
        return {
          ...vp,
          ...(o['hasTouch'] ? { hasTouch: true } : {}),
          ...(o['isMobile'] ? { isMobile: true } : {}),
          ...(o['isLandscape'] ? { isLandscape: true } : {}),
          ...(o['deviceScaleFactor'] ? { deviceScaleFactor: Number(o['deviceScaleFactor']) } : {}),
        };
      };

      const resolveGeo = () => {
        if (!o['geolocation']) return undefined;
        if (o['geolocation'] === "reset") return "reset";
        return parseGeo(o['geolocation']);
      };

      return {
        viewport: resolveViewport(),
        userAgent: o['userAgent'],
        geolocation: resolveGeo(),
        colorScheme: o['colorScheme'],
        cpuThrottlingRate: o['cpuThrottling'] ? Number(o['cpuThrottling']) : undefined,
        networkConditions: o['networkConditions'],
      };
    },
  },
  {
    name: "wait",
    description: "Wait for text to appear on the page",
    needsPort: true,
    flags: [req("--text <texts>", "comma-separated texts"), req("--timeout <ms>", "max wait time")],
    toPayload: (o) => {
      const text = o['text'];
      if (!text) throw new Error("--text is required");
      return { texts: text.split(","), timeout: Number(o['timeout']) };
    },
  },
  {
    name: "dialog",
    description: "Handle a browser dialog",
    needsPort: true,
    flags: [req("--action <action>", "accept or dismiss"), opt("--prompt-text <text>", "prompt input")],
    toPayload: (o) => ({ dialogAction: o['action'], promptText: o['promptText'] }),
  },
  {
    name: "trace-start",
    description: "Start a performance trace",
    needsPort: true,
    flags: [
      opt("--path <path>", "save trace to file"),
      opt("--reload", "reload page after starting trace"),
      opt("--auto-stop", "stop trace after page loads"),
    ],
    toPayload: (o) => ({ path: o['path'], reload: !!o['reload'], autoStop: !!o['autoStop'] }),
  },
  {
    name: "trace-stop",
    description: "Stop the performance trace",
    needsPort: true,
    flags: [opt("--path <path>", "save trace to file")],
    toPayload: (o) => ({ path: o['path'] }),
  },
  {
    name: "trace-analyze",
    description: "Analyze a trace file for performance insights",
    needsPort: false,
    flags: [req("--path <path>", "trace file to analyze")],
    toPayload: (o) => ({ path: o['path'] }),
  },
  {
    name: "trace-analyze-insight",
    description: "Get detailed info on a specific performance insight",
    needsPort: false,
    flags: [
      req("--path <path>", "trace file to analyze"),
      req("--insight-set-id <id>", "insight set ID from trace-analyze output"),
      req("--insight-name <name>", "insight name (DocumentLatency, LCPBreakdown, RenderBlocking, CLSCulprits, LongTasks)"),
    ],
    toPayload: (o) => ({ path: o['path'], insightSetId: o['insightSetId'], insightName: o['insightName'] }),
  },
  {
    name: "heap-snapshot",
    description: "Capture a heap memory snapshot",
    needsPort: true,
    flags: [req("--path <path>", "save .heapsnapshot to file")],
    toPayload: (o) => ({ path: o['path'] }),
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
    flags: [
      opt("--type <type>", "filter by resource type"),
      opt("--include-preserved", "include requests from last 3 navigations"),
      opt("--page-size <n>", "results per page"),
      opt("--page-idx <n>", "page number (0-based)"),
    ],
    toPayload: (o) => ({
      type: o['type'],
      includePreserved: !!o['includePreserved'],
      pageSize: o['pageSize'] ? Number(o['pageSize']) : undefined,
      pageIdx: o['pageIdx'] ? Number(o['pageIdx']) : undefined,
    }),
  },
  {
    name: "network-get",
    description: "Get a single network request with full detail",
    needsPort: true,
    flags: [
      req("--reqid <id>", "request index"),
      opt("--request-file <path>", "save request body to file"),
      opt("--response-file <path>", "save response body to file"),
    ],
    toPayload: (o) => ({
      reqid: Number(o['reqid']),
      requestFile: o['requestFile'],
      responseFile: o['responseFile'],
    }),
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
    flags: [
      opt("--type <type>", "filter by message type"),
      opt("--include-preserved", "include messages from last 3 navigations"),
      opt("--page-size <n>", "results per page"),
      opt("--page-idx <n>", "page number (0-based)"),
    ],
    toPayload: (o) => ({
      type: o['type'],
      includePreserved: !!o['includePreserved'],
      pageSize: o['pageSize'] ? Number(o['pageSize']) : undefined,
      pageIdx: o['pageIdx'] ? Number(o['pageIdx']) : undefined,
    }),
  },
  {
    name: "console-get",
    description: "Get a single console message by index",
    needsPort: true,
    flags: [req("--msgid <id>", "message index")],
    toPayload: (o) => ({ msgid: Number(o['msgid']) }),
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
  .version(versionString());

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
    if (def.needsPort && opts['port']) {
      payload['port'] = Number(opts['port']);
    }
    Object.assign(payload, def.toPayload(opts));
    return send(payload);
  }));
});

void program.parseAsync();
