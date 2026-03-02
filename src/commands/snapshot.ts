import type { Page } from "puppeteer-core";
import { z } from "zod";

const RawAXNodeSchema = z.object({
  nodeId: z.string(),
  role: z.object({ value: z.string() }).optional(),
  name: z.object({ value: z.string() }).optional(),
  childIds: z.array(z.string()).optional(),
  value: z.object({ value: z.string() }).optional(),
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

  const val = node.value?.value;
  return {
    role,
    name,
    uid: node.nodeId,
    ...(val !== undefined ? { value: val } : {}),
    children,
  };
};

const formatTree = (tree: AXTree, depth: number): string => {
  const indent = "  ".repeat(depth);
  const value = tree.value ? ` value="${tree.value}"` : "";
  const line = `${indent}${tree.role} "${tree.name}"${value} [uid=${tree.uid}]`;
  if (tree.children.length === 0) return line;
  const children = tree.children.map((c) => formatTree(c, depth + 1));
  return [line, ...children].join("\n");
};

export const snapshot = async (page: Page): Promise<string> => {
  const client = await page.createCDPSession();
  const { nodes } = AXTreeResponseSchema.parse(await client.send("Accessibility.getFullAXTree"));
  await client.detach();

  const nodeMap = new Map(nodes.map((n) => [n.nodeId, n]));
  const root = nodes[0];
  if (!root) return "empty page";

  const tree = buildTree(nodeMap, root.nodeId);
  if (!tree) return "empty page";

  return formatTree(tree, 0);
};

export const screenshot = async (
  page: Page,
  path: string | undefined,
  fullPage: boolean,
): Promise<string> => {
  const buffer = await page.screenshot({
    ...(path !== undefined ? { path } : {}),
    fullPage,
    type: "png",
  });
  if (path) return JSON.stringify({ saved: path });
  return Buffer.from(buffer).toString("base64");
};
