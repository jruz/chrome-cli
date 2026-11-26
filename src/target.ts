import { randomUUID } from "node:crypto";
import { z } from "zod";

export type Target =
  | { readonly kind: "session"; readonly id: string }
  | { readonly kind: "port"; readonly port: number };

export type TargetFields =
  | { readonly session: string }
  | { readonly port: number };

const sessionTarget = (id: string): Target => ({ id, kind: "session" });

export const portTarget = (port: number): Target => ({ kind: "port", port });

const SessionParams = z
  .object({ port: z.undefined(), session: z.string().min(1) })
  .transform(({ session }) => sessionTarget(session));

const PortParams = z
  .object({ port: z.int().min(1).max(65535), session: z.undefined() })
  .transform(({ port }) => portTarget(port));

const TargetParams = z.union([SessionParams, PortParams]);

export const parseTarget = (
  params: Readonly<Record<string, unknown>>,
): Target => {
  const parsed = TargetParams.safeParse({
    port: params["port"],
    session: params["session"],
  });
  if (!parsed.success)
    throw new Error("exactly one of 'session' or 'port' is required");
  return parsed.data;
};

export const newSessionTarget = (): Target => {
  const id = randomUUID();
  return sessionTarget(id);
};

export const targetKey = (target: Target): string =>
  target.kind === "session" ? `session ${target.id}` : `port ${target.port}`;

export const targetFields = (target: Target): TargetFields =>
  target.kind === "session" ? { session: target.id } : { port: target.port };
