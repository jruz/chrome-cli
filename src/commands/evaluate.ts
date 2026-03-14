import type { Page } from "puppeteer-core";
import { findByUid } from "./interact";

type EvalArg = { uid: string };

const isEvalArg = (v: unknown): v is EvalArg =>
  typeof v === "object" && v !== null &&
  "uid" in v && typeof v.uid === "string";

const buildEvalScript = (expression: string, uids: string[]): string => {
  const queries = uids.map((uid, i) => `var _a${i}=document.querySelector('[data-chrome-cli-uid="${uid}"]');`).join("");
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
    if (!isEvalArg(arg)) throw new Error(`invalid arg at index ${i}: ${JSON.stringify(arg)}`);
    return arg;
  });

  await Promise.all(
    validated.map(async (arg) => {
      const el = await findByUid(page, arg.uid);
      if (!el) throw new Error(`element not found: ${arg.uid}`);
    }),
  );

  const script = buildEvalScript(expression, validated.map((a) => a.uid));
  const result = await page.evaluate(script);
  return JSON.stringify({ result });
};
