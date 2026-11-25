import { lstatSync, mkdirSync, type Stats } from "node:fs";
import { join } from "node:path";

const currentUid = (): number => {
  if (!process.getuid) throw new Error("chrome-cli requires a POSIX platform");
  return process.getuid();
};

const UID = currentUid();
const RUNTIME_DIR = `/tmp/chrome-cli-${UID}`;

export const SOCKET_PATH = join(RUNTIME_DIR, "daemon.sock");
export const LOCK_PATH = join(RUNTIME_DIR, "daemon.lock");

const createRuntimeDir = (): Stats => {
  try {
    mkdirSync(RUNTIME_DIR, { mode: 0o700, recursive: true });
    return lstatSync(RUNTIME_DIR);
  } catch (error) {
    throw new Error(`Could not create ${RUNTIME_DIR}: ${String(error)}`, {
      cause: error,
    });
  }
};

export const ensureRuntimeDir = (): void => {
  const stats = createRuntimeDir();
  if (!stats.isDirectory())
    throw new Error(`${RUNTIME_DIR} must be a directory`);
  if (stats.uid !== UID)
    throw new Error(`${RUNTIME_DIR} must be owned by uid ${UID}`);
  if ((stats.mode & 0o077) !== 0)
    throw new Error(`${RUNTIME_DIR} must not be accessible by other users`);
};
