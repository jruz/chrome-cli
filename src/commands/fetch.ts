import { launch as launchChrome, connect } from "../browser";
import { snapshot } from "./snapshot";
import { screenshot } from "./snapshot";
import type { DaemonState } from "./lifecycle";
import { killCmd } from "./lifecycle";

type FetchMode = "snapshot" | "screenshot";

export const fetchUrl = async (
  state: DaemonState,
  url: string,
  mode: FetchMode,
  timeout: number,
  path: string | undefined,
  fullPage: boolean,
  format: string,
  quality: number | undefined,
): Promise<string> => {
  const { port, userDataDir } = await launchChrome(true);
  const session = await connect(port, userDataDir);
  state.sessions.set(port, session);

  try {
    await session.page.goto(url, { waitUntil: "networkidle0", timeout });

    if (mode === "screenshot") {
      return await screenshot(session.page, path, fullPage, format, quality, undefined);
    }

    return await snapshot(session.page, false, path);
  } finally {
    await killCmd(state, port);
  }
};
