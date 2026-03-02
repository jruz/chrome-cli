import { Command } from "commander";
import { log } from "./src/log";
import { ensureDaemon, send } from "./src/client";

const run = (fn: (opts: Record<string, string>) => Promise<string>) =>
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

const program = new Command()
  .name("chrome-cli")
  .description("Control Chrome via CDP (Chrome DevTools Protocol)")
  .version("0.1.0");

// --- Daemon ---

program
  .command("daemon-start")
  .description("Start the background daemon (auto-started on first command)")
  .action(run(async () => {
    const result = await send({ action: "status" });
    return result;
  }));

program
  .command("daemon-status")
  .description("Show daemon status and connected Chrome sessions")
  .action(run(async () => send({ action: "status" })));

program
  .command("daemon-stop")
  .description("Stop the background daemon and disconnect all sessions")
  .action(run(async () => send({ action: "shutdown" })));

// --- Browser ---

program
  .command("launch")
  .description("Launch a new Chrome instance and return its debug port")
  .option("--headed", "launch with a visible browser window")
  .action(run(async (opts) =>
    send({ action: "launch", headless: !opts.headed })
  ));

// --- Kill ---

program
  .command("kill")
  .description("Kill a Chrome instance by port and remove its daemon session")
  .requiredOption("--port <port>", "Chrome debug port")
  .action(run(async (opts) =>
    send({ action: "kill", port: Number(opts.port) })
  ));

program
  .command("kill-all")
  .description("Kill all tracked Chrome instances")
  .action(run(async () => send({ action: "kill-all" })));

// --- Navigation ---

program
  .command("navigate")
  .description("Navigate the current page to a URL")
  .requiredOption("--port <port>", "Chrome debug port")
  .requiredOption("--url <url>", "target URL")
  .requiredOption("--timeout <ms>", "navigation timeout in milliseconds")
  .action(run(async (opts) =>
    send({ action: "navigate", port: Number(opts.port), url: opts.url, timeout: Number(opts.timeout) })
  ));

program
  .command("back")
  .description("Navigate back in browser history")
  .requiredOption("--port <port>", "Chrome debug port")
  .action(run(async (opts) =>
    send({ action: "back", port: Number(opts.port) })
  ));

program
  .command("forward")
  .description("Navigate forward in browser history")
  .requiredOption("--port <port>", "Chrome debug port")
  .action(run(async (opts) =>
    send({ action: "forward", port: Number(opts.port) })
  ));

program
  .command("reload")
  .description("Reload the current page")
  .requiredOption("--port <port>", "Chrome debug port")
  .action(run(async (opts) =>
    send({ action: "reload", port: Number(opts.port) })
  ));

// --- Snapshots ---

program
  .command("snapshot")
  .description("Take an accessibility tree snapshot of the current page")
  .requiredOption("--port <port>", "Chrome debug port")
  .action(run(async (opts) =>
    send({ action: "snapshot", port: Number(opts.port) })
  ));

program
  .command("screenshot")
  .description("Take a screenshot of the current page (PNG)")
  .requiredOption("--port <port>", "Chrome debug port")
  .option("--path <path>", "save to file instead of base64 output")
  .option("--full-page", "capture the full scrollable page")
  .action(run(async (opts) =>
    send({ action: "screenshot", port: Number(opts.port), path: opts.path, fullPage: !!opts.fullPage })
  ));

// --- Interaction ---

program
  .command("click")
  .description("Click an element by its accessibility tree uid")
  .requiredOption("--port <port>", "Chrome debug port")
  .requiredOption("--uid <uid>", "element uid from snapshot")
  .option("--dbl-click", "perform a double click")
  .action(run(async (opts) =>
    send({ action: "click", port: Number(opts.port), uid: opts.uid, dblClick: !!opts.dblClick })
  ));

program
  .command("hover")
  .description("Hover over an element by its accessibility tree uid")
  .requiredOption("--port <port>", "Chrome debug port")
  .requiredOption("--uid <uid>", "element uid from snapshot")
  .action(run(async (opts) =>
    send({ action: "hover", port: Number(opts.port), uid: opts.uid })
  ));

program
  .command("fill")
  .description("Clear and type a value into an input element")
  .requiredOption("--port <port>", "Chrome debug port")
  .requiredOption("--uid <uid>", "element uid from snapshot")
  .requiredOption("--value <value>", "text to type into the element")
  .action(run(async (opts) =>
    send({ action: "fill", port: Number(opts.port), uid: opts.uid, value: opts.value })
  ));

program
  .command("type")
  .description("Type text using the keyboard into the focused element")
  .requiredOption("--port <port>", "Chrome debug port")
  .requiredOption("--text <text>", "text to type")
  .option("--submit-key <key>", "key to press after typing (e.g. Enter, Tab)")
  .action(run(async (opts) =>
    send({ action: "type", port: Number(opts.port), text: opts.text, submitKey: opts.submitKey })
  ));

program
  .command("press")
  .description("Press a key or key combination (e.g. Enter, Control+A)")
  .requiredOption("--port <port>", "Chrome debug port")
  .requiredOption("--key <key>", "key or combination to press")
  .action(run(async (opts) =>
    send({ action: "press", port: Number(opts.port), key: opts.key })
  ));

program
  .command("drag")
  .description("Drag an element onto another element")
  .requiredOption("--port <port>", "Chrome debug port")
  .requiredOption("--from <uid>", "uid of the element to drag")
  .requiredOption("--to <uid>", "uid of the drop target")
  .action(run(async (opts) =>
    send({ action: "drag", port: Number(opts.port), from: opts.from, to: opts.to })
  ));

program
  .command("upload")
  .description("Upload a file through a file input element")
  .requiredOption("--port <port>", "Chrome debug port")
  .requiredOption("--uid <uid>", "element uid of the file input")
  .requiredOption("--file <path>", "local file path to upload")
  .action(run(async (opts) =>
    send({ action: "upload", port: Number(opts.port), uid: opts.uid, file: opts.file })
  ));

// --- Evaluate ---

program
  .command("eval")
  .description("Evaluate a JavaScript expression in the page context")
  .requiredOption("--port <port>", "Chrome debug port")
  .requiredOption("--expression <code>", "JavaScript expression to evaluate")
  .action(run(async (opts) =>
    send({ action: "eval", port: Number(opts.port), expression: opts.expression })
  ));

// --- Pages ---

program
  .command("pages")
  .description("List all open pages/tabs in the browser")
  .requiredOption("--port <port>", "Chrome debug port")
  .action(run(async (opts) =>
    send({ action: "pages", port: Number(opts.port) })
  ));

program
  .command("new-page")
  .description("Open a new page/tab and navigate to a URL")
  .requiredOption("--port <port>", "Chrome debug port")
  .requiredOption("--url <url>", "URL to load in the new page")
  .action(run(async (opts) =>
    send({ action: "new-page", port: Number(opts.port), url: opts.url })
  ));

program
  .command("close-page")
  .description("Close a page/tab by its index")
  .requiredOption("--port <port>", "Chrome debug port")
  .requiredOption("--page-id <id>", "page index to close")
  .action(run(async (opts) =>
    send({ action: "close-page", port: Number(opts.port), pageId: Number(opts.pageId) })
  ));

program
  .command("select-page")
  .description("Switch focus to a page/tab by its index")
  .requiredOption("--port <port>", "Chrome debug port")
  .requiredOption("--page-id <id>", "page index to select")
  .action(run(async (opts) =>
    send({ action: "select-page", port: Number(opts.port), pageId: Number(opts.pageId) })
  ));

// --- Emulation ---

program
  .command("emulate")
  .description("Emulate device features (viewport, user agent, geolocation, color scheme)")
  .requiredOption("--port <port>", "Chrome debug port")
  .option("--viewport <WxH>", "viewport size (e.g. 1280x720)")
  .option("--user-agent <string>", "user agent string")
  .option("--geolocation <lat,lng>", "geolocation override (e.g. 37.7749,-122.4194)")
  .option("--color-scheme <scheme>", "color scheme: dark or light")
  .action(run(async (opts) =>
    send({
      action: "emulate",
      port: Number(opts.port),
      viewport: opts.viewport
        ? { width: Number(opts.viewport.split("x")[0]), height: Number(opts.viewport.split("x")[1]) }
        : undefined,
      userAgent: opts.userAgent,
      geolocation: opts.geolocation
        ? { latitude: Number(opts.geolocation.split(",")[0]), longitude: Number(opts.geolocation.split(",")[1]) }
        : undefined,
      colorScheme: opts.colorScheme,
    })
  ));

// --- Wait ---

program
  .command("wait")
  .description("Wait for text to appear on the page")
  .requiredOption("--port <port>", "Chrome debug port")
  .requiredOption("--text <texts>", "comma-separated texts to wait for (resolves on first match)")
  .requiredOption("--timeout <ms>", "maximum wait time in milliseconds")
  .action(run(async (opts) =>
    send({ action: "wait", port: Number(opts.port), texts: opts.text!.split(","), timeout: Number(opts.timeout) })
  ));

program
  .command("dialog")
  .description("Handle a browser dialog (alert, confirm, prompt)")
  .requiredOption("--port <port>", "Chrome debug port")
  .requiredOption("--action <action>", "accept or dismiss the dialog")
  .option("--prompt-text <text>", "text to enter into a prompt dialog")
  .action(run(async (opts) =>
    send({ action: "dialog", port: Number(opts.port), dialogAction: opts.action, promptText: opts.promptText })
  ));

// --- Performance ---

program
  .command("trace-start")
  .description("Start a performance trace recording")
  .requiredOption("--port <port>", "Chrome debug port")
  .option("--path <path>", "file path to save trace data")
  .action(run(async (opts) =>
    send({ action: "trace-start", port: Number(opts.port), path: opts.path })
  ));

program
  .command("trace-stop")
  .description("Stop the active performance trace and save results")
  .requiredOption("--port <port>", "Chrome debug port")
  .option("--path <path>", "file path to save trace data")
  .action(run(async (opts) =>
    send({ action: "trace-stop", port: Number(opts.port), path: opts.path })
  ));

program
  .command("heap-snapshot")
  .description("Capture a heap memory snapshot for leak debugging")
  .requiredOption("--port <port>", "Chrome debug port")
  .requiredOption("--path <path>", "file path to save the .heapsnapshot")
  .action(run(async (opts) =>
    send({ action: "heap-snapshot", port: Number(opts.port), path: opts.path })
  ));

program.parseAsync();
