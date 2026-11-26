import { z } from "zod";
import {
  defineDaemonCommand,
  numberParam,
  opt,
  req,
  textParam,
  toggle,
} from "../command.ts";

import { snapshot } from "./snapshot";
import { screenshot } from "./snapshot";
import type { DaemonState } from "./lifecycle";
import { killCmd, launchSession } from "./lifecycle";
import { track } from "../activity";
import { targetKey } from "../target";

const OneshotParams = z
  .object({
    format: textParam("format").optional(),
    fullPage: z.coerce.boolean().optional(),
    height: numberParam("height").optional(),
    mode: z.enum(["snapshot", "screenshot"]),
    path: textParam("path").optional(),
    quality: numberParam("quality").optional(),
    timeout: numberParam("timeout").optional(),
    url: textParam("url"),
    verbose: toggle,
    width: numberParam("width").optional(),
  })
  .readonly();

type OneshotOpts = z.infer<typeof OneshotParams>;

const TIMEOUT = 30000;
const WIDTH = 1366;
const HEIGHT = 768;
const SCREENSHOT_FORMAT = "png";
const SCREENSHOT_FULL_PAGE = true;

export const oneshot = async (
  state: DaemonState,
  opts: OneshotOpts,
): Promise<string> => {
  const timeout = opts.timeout ?? TIMEOUT;
  const width = opts.width ?? WIDTH;
  const height = opts.height ?? HEIGHT;
  const format = opts.format ?? SCREENSHOT_FORMAT;
  const fullPage =
    opts.mode === "screenshot"
      ? (opts.fullPage ?? SCREENSHOT_FULL_PAGE)
      : false;

  const session = await launchSession(state, true);
  const { page, target } = session;

  const capture = async (): Promise<string> => {
    await page.setViewport({ height, width });
    await page.goto(opts.url, { timeout, waitUntil: "networkidle0" });
    if (opts.mode === "screenshot")
      return screenshot(
        page,
        opts.path,
        fullPage,
        format,
        opts.quality,
        undefined,
      );
    return snapshot(page, opts.verbose, opts.path);
  };

  try {
    const key = targetKey(target);
    return await track(state.activity, key, capture);
  } finally {
    await killCmd(state, target);
  }
};

export const oneshotCommand = defineDaemonCommand(
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
  OneshotParams,
  ({ state }, params) => oneshot(state, params),
);
