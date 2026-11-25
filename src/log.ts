import { z } from "zod";

const key = z.string();
const value = z.unknown();
const JsonObject = z.record(key, value);

const structured = (msg: string, severity: string): string => {
  try {
    const parsed: unknown = JSON.parse(msg);
    const result = JsonObject.safeParse(parsed);
    if (!result.success) {
      return JSON.stringify({ message: msg, severity });
    }
    return JSON.stringify({ severity, ...result.data });
  } catch {
    return JSON.stringify({ message: msg, severity });
  }
};

export const log = {
  error: (msg: string) => {
    const out = structured(msg, "ERROR");
    console.error(out);
  },
  info: (msg: string) => {
    const out = structured(msg, "INFO");
    console.log(out);
  },
  warn: (msg: string) => {
    const out = structured(msg, "WARN");
    console.warn(out);
  },
};
