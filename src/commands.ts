import { launchCommand, killCommand } from "./commands/lifecycle.ts";
import { oneshotCommand } from "./commands/oneshot.ts";
import {
  navigateCommand,
  backCommand,
  forwardCommand,
  reloadCommand,
} from "./commands/navigate.ts";
import { snapshotCommand, screenshotCommand } from "./commands/snapshot.ts";
import {
  clickCommand,
  hoverCommand,
  fillCommand,
  typeCommand,
  pressCommand,
  dragCommand,
  uploadCommand,
  fillFormCommand,
} from "./commands/interaction-commands.ts";
import { resizeCommand, emulateCommand } from "./commands/emulate.ts";
import { evalCommand } from "./commands/evaluate.ts";
import {
  pagesCommand,
  newPageCommand,
  closePageCommand,
  selectPageCommand,
} from "./commands/page.ts";
import { waitCommand, dialogCommand } from "./commands/wait.ts";
import {
  traceStartCommand,
  traceStopCommand,
  traceAnalyzeCommand,
  traceAnalyzeInsightCommand,
  heapSnapshotCommand,
} from "./commands/performance.ts";
import {
  networkStartCommand,
  networkListCommand,
  networkGetCommand,
  networkStopCommand,
} from "./commands/network.ts";
import {
  consoleStartCommand,
  consoleListCommand,
  consoleGetCommand,
  consoleStopCommand,
} from "./commands/console.ts";

import type { Command } from "./command.ts";

export const commands: readonly Command[] = [
  launchCommand,
  killCommand,
  oneshotCommand,
  navigateCommand,
  backCommand,
  forwardCommand,
  reloadCommand,
  snapshotCommand,
  screenshotCommand,
  clickCommand,
  hoverCommand,
  fillCommand,
  typeCommand,
  pressCommand,
  dragCommand,
  uploadCommand,
  fillFormCommand,
  resizeCommand,
  evalCommand,
  pagesCommand,
  newPageCommand,
  closePageCommand,
  selectPageCommand,
  emulateCommand,
  waitCommand,
  dialogCommand,
  traceStartCommand,
  traceStopCommand,
  traceAnalyzeCommand,
  traceAnalyzeInsightCommand,
  heapSnapshotCommand,
  networkStartCommand,
  networkListCommand,
  networkGetCommand,
  networkStopCommand,
  consoleStartCommand,
  consoleListCommand,
  consoleGetCommand,
  consoleStopCommand,
];
