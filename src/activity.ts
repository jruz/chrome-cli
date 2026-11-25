import { z } from "zod";

type Usage = { lastUsed: number; inFlight: number };

export type Activity = {
  readonly timeoutMs: number;
  readonly ports: Map<number, Usage>;
};

const Timeout = z.int().positive();

export const createActivity = (timeoutMs: number): Activity => ({
  ports: new Map(),
  timeoutMs: Timeout.parse(timeoutMs),
});

const usageFor = (activity: Activity, port: number): Usage => {
  const existing = activity.ports.get(port);
  if (existing) return existing;
  const usage = { inFlight: 0, lastUsed: Date.now() };
  activity.ports.set(port, usage);
  return usage;
};

export const touch = (activity: Activity, port: number): void => {
  usageFor(activity, port).lastUsed = Date.now();
};

export const track = async <T>(
  activity: Activity,
  port: number,
  run: () => Promise<T>,
): Promise<T> => {
  const usage = usageFor(activity, port);
  usage.inFlight += 1;
  try {
    return await run();
  } finally {
    usage.inFlight -= 1;
    usage.lastUsed = Date.now();
  }
};

const isExpired = (activity: Activity, now: number) => (port: number) => {
  const usage = activity.ports.get(port);
  if (!usage) return false;
  return usage.inFlight === 0 && now - usage.lastUsed >= activity.timeoutMs;
};

export const expiredPorts = (
  activity: Activity,
  candidates: ReadonlySet<number>,
): readonly number[] => {
  const now = Date.now();
  const expired = isExpired(activity, now);
  return Array.from(candidates).filter(expired);
};

export const forget = (activity: Activity, port: number): void => {
  activity.ports.delete(port);
};
