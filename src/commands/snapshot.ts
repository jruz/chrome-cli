import type { Page } from "puppeteer-core";

type RawAXNode = {
  nodeId: string;
  role?: { value: string };
  name?: { value: string };
  childIds?: string[];
  value?: { value: string };
  description?: { value: string };
  ignored?: boolean;
};

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

  if (node.ignored) return children.length === 1 ? children[0]! : { role: "group", name: "", uid: node.nodeId, children };

  const role = node.role ? node.role.value : "none";
  const name = node.name ? node.name.value : "";

  return {
    role,
    name,
    uid: node.nodeId,
    value: node.value?.value,
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
  const { nodes } = (await client.send("Accessibility.getFullAXTree")) as {
    nodes: RawAXNode[];
  };
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
    path,
    fullPage,
    type: "png",
  });
  if (path) return JSON.stringify({ saved: path });
  return Buffer.from(buffer).toString("base64");
};
