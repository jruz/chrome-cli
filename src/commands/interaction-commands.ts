import { z } from "zod";
import {
  arrayParam,
  definePageCommand,
  opt,
  req,
  textParam,
  type CliOptions,
  type CliSpec,
  toggle,
} from "../command.ts";
import type { Page } from "puppeteer-core";
import type { ZodRawShape, output } from "zod";
import { snapshot } from "./snapshot.ts";
import {
  click,
  hover,
  fill,
  fillForm,
  typeText,
  pressKey,
  drag,
  uploadFile,
} from "./interact.ts";

const JsonValue = z.unknown();
const JsonKey = z.string();
const JsonObject = z.record(JsonKey, JsonValue);
const addSnapshot = async (page: Page, result: string) => {
  const snap = await snapshot(page, false, undefined);
  try {
    const raw: unknown = JSON.parse(result);
    const parsed = JsonObject.parse(raw);
    return JSON.stringify({ ...parsed, snapshot: snap });
  } catch (error) {
    throw new Error(
      `failed to merge snapshot into response: ${String(error)}`,
      { cause: error },
    );
  }
};

const SnapshotOption = z.object({ includeSnapshot: toggle }).readonly();
const interactionParams = <Shape extends ZodRawShape>(shape: Shape) => {
  const params = z.object(shape).readonly();
  return z.intersection(params, SnapshotOption);
};

const includeSnapshotFlag = opt(
  "--include-snapshot",
  "include snapshot in response",
);
type InteractionParams<Shape extends ZodRawShape> = output<
  ReturnType<typeof interactionParams<Shape>>
>;

const defineInteractionCommand = <Shape extends ZodRawShape>(
  cli: CliSpec,
  shape: Shape,
  run: (page: Page, params: InteractionParams<Shape>) => Promise<string>,
) => {
  const schema = interactionParams(shape);
  const flags = [...cli.flags, includeSnapshotFlag];
  const toPayload = (opts: CliOptions) => ({
    ...cli.toPayload(opts),
    includeSnapshot: !!opts["includeSnapshot"],
  });
  return definePageCommand(
    { ...cli, flags, toPayload },
    schema,
    async (page, params) => {
      const result = await run(page, params);
      if (!params.includeSnapshot) return result;
      return addSnapshot(page, result);
    },
  );
};

export const clickCommand = defineInteractionCommand(
  {
    description: "Click an element by uid",
    flags: [
      req("--uid <uid>", "element uid from snapshot"),
      opt("--dbl-click", "double click"),
    ],
    name: "click",
    toPayload: (o) => ({
      dblClick: !!o["dblClick"],
      uid: o["uid"],
    }),
  },
  {
    dblClick: toggle,
    uid: textParam("uid"),
  },
  (page, { uid, dblClick }) => click(page, uid, dblClick),
);

export const hoverCommand = defineInteractionCommand(
  {
    description: "Hover over an element by uid",
    flags: [req("--uid <uid>", "element uid from snapshot")],
    name: "hover",
    toPayload: (o) => ({
      uid: o["uid"],
    }),
  },
  { uid: textParam("uid") },
  (page, { uid }) => hover(page, uid),
);

export const fillCommand = defineInteractionCommand(
  {
    description: "Clear and type a value into an input",
    flags: [
      req("--uid <uid>", "element uid"),
      req("--value <value>", "text to type"),
    ],
    name: "fill",
    toPayload: (o) => ({
      uid: o["uid"],
      value: o["value"],
    }),
  },
  {
    uid: textParam("uid"),
    value: textParam("value"),
  },
  (page, { uid, value }) => fill(page, uid, value),
);

export const typeCommand = defineInteractionCommand(
  {
    description: "Type text into the focused element",
    flags: [
      req("--text <text>", "text to type"),
      opt("--submit-key <key>", "key to press after"),
    ],
    name: "type",
    toPayload: (o) => ({
      submitKey: o["submitKey"],
      text: o["text"],
    }),
  },
  {
    submitKey: textParam("submitKey").optional(),
    text: textParam("text"),
  },
  (page, { text, submitKey }) => typeText(page, text, submitKey),
);

export const pressCommand = defineInteractionCommand(
  {
    description: "Press a key or combination",
    flags: [req("--key <key>", "key or combination")],
    name: "press",
    toPayload: (o) => ({
      key: o["key"],
    }),
  },
  { key: textParam("key") },
  (page, { key }) => pressKey(page, key),
);

export const dragCommand = defineInteractionCommand(
  {
    description: "Drag an element onto another",
    flags: [
      req("--from <uid>", "element to drag"),
      req("--to <uid>", "drop target"),
    ],
    name: "drag",
    toPayload: (o) => ({
      from: o["from"],
      to: o["to"],
    }),
  },
  {
    from: textParam("from"),
    to: textParam("to"),
  },
  (page, { from, to }) => drag(page, from, to),
);

export const uploadCommand = defineInteractionCommand(
  {
    description: "Upload a file through a file input",
    flags: [
      req("--uid <uid>", "file input uid"),
      req("--file <path>", "local file path"),
    ],
    name: "upload",
    toPayload: (o) => ({
      file: o["file"],
      uid: o["uid"],
    }),
  },
  {
    file: textParam("file"),
    uid: textParam("uid"),
  },
  (page, { uid, file }) => uploadFile(page, uid, file),
);

export const fillFormCommand = defineInteractionCommand(
  {
    description: "Fill multiple form elements at once",
    flags: [req("--fields <json>", "JSON array of {uid, value} objects")],
    name: "fill-form",
    toPayload: (o) => {
      const raw = o["fields"];
      if (!raw) throw new Error("--fields is required");
      try {
        return {
          fields: JSON.parse(raw),
        };
      } catch (err) {
        throw new Error(`invalid JSON for --fields: ${String(err)}`, {
          cause: err,
        });
      }
    },
  },
  {
    fields: arrayParam("fields"),
  },
  (page, { fields }) => fillForm(page, fields),
);
