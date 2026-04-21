import { launch as launchChrome, connect } from "../browser";
import { snapshot } from "./snapshot";
import { screenshot } from "./snapshot";
import type { DaemonState } from "./lifecycle";
import { killCmd } from "./lifecycle";

type OneshotMode = "snapshot" | "screenshot";

type OneshotOpts = {
  url: string;
  mode: OneshotMode;
  timeout: number | undefined;
  path: string | undefined;
  verbose: boolean;
  fullPage: boolean | undefined;
  format: string | undefined;
  quality: number | undefined;
  width: number | undefined;
  height: number | undefined;
};

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
  const fullPage = opts.mode === "screenshot" ? (opts.fullPage ?? SCREENSHOT_FULL_PAGE) : false;

  const { port, userDataDir } = await launchChrome(true);
  const session = await connect(port, userDataDir);
  state.sessions.set(port, session);

  try {
    await session.page.setViewport({ width, height });
    await session.page.goto(opts.url, { waitUntil: "networkidle0", timeout });

    if (opts.mode === "screenshot") {
      return await screenshot(session.page, opts.path, fullPage, format, opts.quality, undefined);
    }

    return await snapshot(session.page, opts.verbose, opts.path);
  } finally {
    await killCmd(state, port);
  }
};
