import { dlopen, FFIType, read } from "bun:ffi";
import { openSync } from "node:fs";

const LOCK_EX = 2;
const LOCK_NB = 4;

const platform = (): { library: string; errno: string; busy: number } => {
  if (process.platform === "linux")
    return { busy: 11, errno: "__errno_location", library: "libc.so.6" };
  if (process.platform === "darwin")
    return {
      busy: 35,
      errno: "__error",
      library: "/usr/lib/libSystem.B.dylib",
    };
  throw new Error(`unsupported platform: ${process.platform}`);
};

const libc = () => {
  const { library, errno, busy } = platform();
  const { symbols } = dlopen(library, {
    [errno]: { args: [], returns: FFIType.ptr },
    flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  });
  const errnoPointer = symbols[errno];
  if (!errnoPointer) throw new Error(`missing ${errno} in ${library}`);
  const lastError = (): number => {
    const pointer = errnoPointer();
    if (pointer === null) throw new Error(`${errno} returned null`);
    return read.i32(pointer);
  };
  return { busy, flock: symbols.flock, lastError };
};

export const acquireDaemonLock = (path: string): boolean => {
  const { busy, flock, lastError } = libc();
  const fd = openSync(path, "a", 0o600);
  if (flock(fd, LOCK_EX | LOCK_NB) === 0) return true;
  const code = lastError();
  if (code === busy) return false;
  throw new Error(`flock ${path} failed with errno ${code}`);
};
