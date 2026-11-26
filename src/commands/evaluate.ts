import { z } from "zod";
import {
  arrayParam,
  definePageCommand,
  opt,
  req,
  textParam,
} from "../command.ts";

import type { Page } from "puppeteer-core";
import { findByUid } from "./interact";

type EvalArg = { uid: string };

const isEvalArg = (v: unknown): v is EvalArg =>
  typeof v === "object" &&
  v !== null &&
  "uid" in v &&
  typeof v.uid === "string";

const buildEvalScript = (expression: string, uids: string[]): string => {
  const queries = uids
    .map(
      (uid, i) =>
        `var _a${i}=document.querySelector('[data-chrome-cli-uid="${uid}"]');`,
    )
    .join("");
  const argList = uids.map((_, i) => `_a${i}`).join(",");
  return `(()=>{${queries}return(${expression})(${argList});})()`;
};

export const evaluate = async (
  page: Page,
  expression: string,
  args: unknown[] | undefined,
): Promise<string> => {
  if (!args || args.length === 0) {
    const result = await page.evaluate(expression);
    return JSON.stringify({ result });
  }

  const validated = args.map((arg, i) => {
    if (!isEvalArg(arg))
      throw new Error(`invalid arg at index ${i}: ${JSON.stringify(arg)}`);
    return arg;
  });

  const checks = validated.map(async (arg) => {
    const el = await findByUid(page, arg.uid);
    if (!el) throw new Error(`element not found: ${arg.uid}`);
  });
  await Promise.all(checks);

  const uids = validated.map((a) => a.uid);
  const script = buildEvalScript(expression, uids);
  const result = await page.evaluate(script);
  return JSON.stringify({ result });
};

const EvalParams = z
  .object({
    args: arrayParam("args").optional(),
    expression: textParam("expression"),
  })
  .readonly();

export const evalCommand = definePageCommand(
  {
    description: "Evaluate JavaScript in page context",
    flags: [
      req("--expression <code>", "JavaScript expression"),
      opt("--args <json>", "JSON array of {uid} element references"),
    ],
    name: "eval",
    toPayload: (o) => {
      const argsRaw = o["args"];
      if (!argsRaw) return { expression: o["expression"] };
      try {
        return { args: JSON.parse(argsRaw), expression: o["expression"] };
      } catch (err) {
        throw new Error(`invalid JSON for --args: ${String(err)}`, {
          cause: err,
        });
      }
    },
  },
  EvalParams,
  (page, { expression, args }) => evaluate(page, expression, args),
);
