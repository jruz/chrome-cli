import { z } from "zod";
import {
  definePageCommand,
  numberParam,
  opt,
  req,
  textParam,
} from "../command.ts";

import type { Page } from "puppeteer-core";

const waitFor = async (
  page: Page,
  texts: string[],
  timeout: number,
): Promise<string> => {
  const promises = texts.map(async (text) => {
    await page.waitForFunction(
      (t: string) => document.body.innerText.includes(t),
      { timeout },
      text,
    );
    return text;
  });
  const found = await Promise.race(promises);
  return JSON.stringify({ found });
};

const handleDialog = async (
  page: Page,
  action: "accept" | "dismiss",
  promptText: string | undefined,
): Promise<string> => {
  return new Promise((resolve, reject) => {
    page.once("dialog", (dialog) => {
      (async () => {
        if (action === "accept") {
          await dialog.accept(promptText);
        } else {
          await dialog.dismiss();
        }
        const dialogType = dialog.type();
        return JSON.stringify({ action, type: dialogType });
      })().then(resolve, reject);
    });
  });
};

const Text = z.string();
const Texts = z.array(Text);
const UnknownValue = z.unknown();
const TextsParam = z
  .array(UnknownValue, { error: "param 'texts' must be an array" })
  .transform((values, ctx) => {
    const invalid = values.findIndex((value) => typeof value !== "string");
    if (invalid !== -1) {
      ctx.issues.push({
        code: "custom",
        input: values,
        message: `param 'texts[${invalid}]' must be a string`,
      });
      return z.NEVER;
    }
    return Texts.parse(values);
  });

const WaitParams = z
  .object({ texts: TextsParam, timeout: numberParam("timeout") })
  .readonly();

export const waitCommand = definePageCommand(
  {
    description: "Wait for text to appear on the page",
    flags: [
      req("--text <texts>", "comma-separated texts"),
      req("--timeout <ms>", "max wait time"),
    ],
    name: "wait",
    toPayload: (o) => {
      const text = o["text"];
      if (!text) throw new Error("--text is required");
      return { texts: text.split(","), timeout: Number(o["timeout"]) };
    },
  },
  WaitParams,
  (page, { texts, timeout }) => waitFor(page, texts, timeout),
);

const DialogParams = z
  .object({
    dialogAction: z.enum(["accept", "dismiss"]),
    promptText: textParam("promptText").optional(),
  })
  .readonly();

export const dialogCommand = definePageCommand(
  {
    description: "Handle a browser dialog",
    flags: [
      req("--action <action>", "accept or dismiss"),
      opt("--prompt-text <text>", "prompt input"),
    ],
    name: "dialog",
    toPayload: (o) => ({
      dialogAction: o["action"],
      promptText: o["promptText"],
    }),
  },
  DialogParams,
  (page, { dialogAction, promptText }) =>
    handleDialog(page, dialogAction, promptText),
);
