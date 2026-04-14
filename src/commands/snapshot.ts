import type { Page } from "puppeteer-core";
import { writeFile } from "fs/promises";
import { z } from "zod";
import { findByUid } from "./interact";

const RawAXNodeSchema = z.object({
  nodeId: z.string(),
  role: z.object({ value: z.string() }).optional(),
  name: z.object({ value: z.string() }).optional(),
  childIds: z.string().array().optional(),
  value: z.object({ value: z.union([z.string(), z.number()]) }).optional(),
  description: z.object({ value: z.string() }).optional(),
  ignored: z.boolean().optional(),
});

type RawAXNode = z.infer<typeof RawAXNodeSchema>;

const AXTreeResponseSchema = z.object({
  nodes: z.array(RawAXNodeSchema),
});

type AXTree = {
  role: string;
  name: string;
  uid: string;
  value?: string;
  description?: string;
  children: AXTree[];
};

const buildTree = (
  nodeMap: Map<string, RawAXNode>,
  nodeId: string,
): AXTree | null => {
  const node = nodeMap.get(nodeId);
  if (!node) return null;

  const children = node.childIds
    ? node.childIds.map((id) => buildTree(nodeMap, id)).filter((n): n is AXTree => n !== null)
    : [];

  if (node.ignored) {
    const [single] = children;
    return children.length === 1 && single ? single : { role: "group", name: "", uid: node.nodeId, children };
  }

  const role = node.role ? node.role.value : "none";
  const name = node.name ? node.name.value : "";

  const rawVal = node.value?.value;
  const val = rawVal !== undefined ? String(rawVal) : undefined;
  const desc = node.description?.value;
  return {
    role,
    name,
    uid: node.nodeId,
    ...(val !== undefined ? { value: val } : {}),
    ...(desc !== undefined ? { description: desc } : {}),
    children,
  };
};

const formatTree = (tree: AXTree, depth: number, verbose: boolean): string => {
  const indent = "  ".repeat(depth);
  const value = tree.value ? ` value="${tree.value}"` : "";
  const desc = verbose && tree.description ? ` description="${tree.description}"` : "";
  const line = `${indent}${tree.role} "${tree.name}"${value}${desc} [uid=${tree.uid}]`;
  if (tree.children.length === 0) return line;
  const children = tree.children.map((c) => formatTree(c, depth + 1, verbose));
  return [line, ...children].join("\n");
};

export const snapshot = async (
  page: Page,
  verbose: boolean,
  filePath: string | undefined,
): Promise<string> => {
  const client = await page.createCDPSession();
  const raw = await client.send("Accessibility.getFullAXTree");
  const { nodes } = AXTreeResponseSchema.parse(raw);
  await client.detach();

  const nodeMap = new Map(nodes.map((n) => [n.nodeId, n]));
  const root = nodes[0];
  if (!root) return "empty page";

  const tree = buildTree(nodeMap, root.nodeId);
  if (!tree) return "empty page";

  const text = formatTree(tree, 0, verbose);

  if (filePath) {
    await writeFile(filePath, text);
    return JSON.stringify({ saved: filePath });
  }

  return text;
};

type ScreenshotFormat = "png" | "jpeg" | "webp";

const isScreenshotFormat = (v: string): v is ScreenshotFormat =>
  v === "png" || v === "jpeg" || v === "webp";

export const screenshot = async (
  page: Page,
  path: string | undefined,
  fullPage: boolean,
  format: string,
  quality: number | undefined,
  uid: string | undefined,
): Promise<string> => {
  if (!isScreenshotFormat(format)) throw new Error(`invalid format: ${format}`);

  const opts = {
    ...(path !== undefined ? { path } : {}),
    type: format,
    ...(format !== "png" && quality !== undefined ? { quality } : {}),
  };

  if (uid) {
    const el = await findByUid(page, uid);
    if (!el) throw new Error(`element not found: ${uid}`);
    const buffer = await el.screenshot(opts);
    if (path) return JSON.stringify({ saved: path });
    return Buffer.from(buffer).toString("base64");
  }

  const buffer = await page.screenshot({ ...opts, fullPage });
  if (path) return JSON.stringify({ saved: path });
  return Buffer.from(buffer).toString("base64");
};
