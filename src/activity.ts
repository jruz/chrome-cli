import { z } from "zod";

type Usage = { lastUsed: number; inFlight: number };

export type Activity = {
  readonly timeoutMs: number;
  readonly usage: Map<string, Usage>;
};

const Timeout = z.int().positive();

export const createActivity = (timeoutMs: number): Activity => ({
  timeoutMs: Timeout.parse(timeoutMs),
  usage: new Map(),
});

const usageFor = (activity: Activity, key: string): Usage => {
  const existing = activity.usage.get(key);
  if (existing) return existing;
  const usage = { inFlight: 0, lastUsed: Date.now() };
  activity.usage.set(key, usage);
  return usage;
};

export const touch = (activity: Activity, key: string): void => {
  usageFor(activity, key).lastUsed = Date.now();
};

export const track = async <T>(
  activity: Activity,
  key: string,
  run: () => Promise<T>,
): Promise<T> => {
  const usage = usageFor(activity, key);
  usage.inFlight += 1;
  try {
    return await run();
  } finally {
    usage.inFlight -= 1;
    usage.lastUsed = Date.now();
  }
};

const isExpired = (activity: Activity, now: number) => (key: string) => {
  const usage = activity.usage.get(key);
  if (!usage) return false;
  return usage.inFlight === 0 && now - usage.lastUsed >= activity.timeoutMs;
};

export const expiredKeys = (
  activity: Activity,
  candidates: ReadonlySet<string>,
): readonly string[] => {
  const now = Date.now();
  const expired = isExpired(activity, now);
  return Array.from(candidates).filter(expired);
};

export const forget = (activity: Activity, key: string): void => {
  activity.usage.delete(key);
};
