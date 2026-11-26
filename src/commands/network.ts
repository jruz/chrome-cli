import { z } from "zod";
import {
  defineTargetCommand,
  noParams,
  numberParam,
  opt,
  req,
  textParam,
  toggle,
} from "../command.ts";
import { targetFields, targetKey } from "../target.ts";
import type { Page, CDPSession } from "puppeteer-core";
import { writeFile } from "fs/promises";

type Headers = Record<string, string>;

type NetworkEntry = {
  requestId: string;
  url: string;
  method: string;
  resourceType: string | undefined;
  status: number | null;
  encodedDataLength: number | null;
  requestHeaders: Headers;
  responseHeaders: Headers;
  postData: string | undefined;
};

const MAX_PRESERVED = 3;

export type NetworkCapture = {
  cdpSession: CDPSession;
  entries: NetworkEntry[];
  preserved: NetworkEntry[][];
  frameListener: () => void;
};

type RequestWillBeSent = {
  requestId: string;
  request: { url: string; method: string; headers: Headers; postData?: string };
  type?: string;
};

type ResponseReceived = {
  requestId: string;
  response: { status: number; headers: Headers };
  type: string;
};

type LoadingFinished = {
  requestId: string;
  encodedDataLength: number;
};

type LoadingFailed = {
  requestId: string;
};

const startCapture = async (page: Page): Promise<NetworkCapture> => {
  const cdpSession = await page.createCDPSession();
  const entries: NetworkEntry[] = [];
  const preserved: NetworkEntry[][] = [];
  const pending = new Map<string, NetworkEntry>();

  cdpSession.on("Network.requestWillBeSent", (params: RequestWillBeSent) => {
    const entry: NetworkEntry = {
      encodedDataLength: null,
      method: params.request.method,
      postData: params.request.postData,
      requestHeaders: params.request.headers,
      requestId: params.requestId,
      resourceType: params.type,
      responseHeaders: {},
      status: null,
      url: params.request.url,
    };
    pending.set(params.requestId, entry);
    entries.push(entry);
  });

  cdpSession.on("Network.responseReceived", (params: ResponseReceived) => {
    const entry = pending.get(params.requestId);
    if (!entry) return;
    entry.status = params.response.status;
    entry.resourceType = params.type;
    entry.responseHeaders = params.response.headers;
  });

  cdpSession.on("Network.loadingFinished", (params: LoadingFinished) => {
    const entry = pending.get(params.requestId);
    if (!entry) return;
    entry.encodedDataLength = params.encodedDataLength;
    pending.delete(params.requestId);
  });

  cdpSession.on("Network.loadingFailed", (params: LoadingFailed) => {
    pending.delete(params.requestId);
  });

  const frameListener = () => {
    if (entries.length > 0) {
      preserved.push([...entries]);
      entries.length = 0;
      pending.clear();
      if (preserved.length > MAX_PRESERVED) {
        preserved.shift();
      }
    }
  };

  page.on("framenavigated", frameListener);
  await cdpSession.send("Network.enable");

  return { cdpSession, entries, frameListener, preserved };
};

const listEntries = (
  capture: NetworkCapture,
  typeFilter: string | undefined,
  includePreserved: boolean,
  pageIdx: number | undefined,
  pageSize: number | undefined,
): string => {
  const all = includePreserved
    ? [...capture.preserved.flat(), ...capture.entries]
    : capture.entries;

  const filtered = typeFilter
    ? all.filter(
        (e) => e.resourceType?.toLowerCase() === typeFilter.toLowerCase(),
      )
    : all;

  if (pageSize === undefined) return JSON.stringify(filtered);
  if (pageIdx === undefined)
    throw new Error("pageIdx is required when pageSize is set");

  const start = pageIdx * pageSize;
  const page = filtered.slice(start, start + pageSize);
  return JSON.stringify({
    entries: page,
    pageIdx,
    pageSize,
    total: filtered.length,
  });
};

const getEntry = async (
  capture: NetworkCapture,
  reqid: number,
  requestFilePath: string | undefined,
  responseFilePath: string | undefined,
): Promise<string> => {
  const entry = capture.entries[reqid];
  if (!entry) throw new Error(`network request not found: ${reqid}`);

  let responseBody: string | undefined;
  try {
    const resp = await capture.cdpSession.send("Network.getResponseBody", {
      requestId: entry.requestId,
    });
    responseBody = resp.base64Encoded
      ? Buffer.from(resp.body, "base64").toString()
      : resp.body;
  } catch {
    responseBody = undefined;
  }

  if (requestFilePath && entry.postData) {
    await writeFile(requestFilePath, entry.postData);
  }
  if (responseFilePath && responseBody) {
    await writeFile(responseFilePath, responseBody);
  }

  return JSON.stringify({
    ...entry,
    requestBody: requestFilePath
      ? `saved to ${requestFilePath}`
      : entry.postData,
    responseBody: responseFilePath
      ? `saved to ${responseFilePath}`
      : responseBody,
  });
};

const stopCapture = async (
  page: Page,
  capture: NetworkCapture,
): Promise<string> => {
  page.off("framenavigated", capture.frameListener);
  await capture.cdpSession.detach();
  return JSON.stringify({
    stopped: true,
    totalEntries: capture.entries.length,
  });
};

const NetworkStartParams = z
  .object({
    includePreserved: toggle,
    pageIdx: numberParam("pageIdx").optional(),
    pageSize: numberParam("pageSize").optional(),
    type: textParam("type").optional(),
  })
  .readonly();

export const networkStartCommand = defineTargetCommand(
  {
    description: "Start capturing network requests",
    flags: [],
    name: "network-start",
    toPayload: () => ({}),
  },
  noParams,
  async ({ getSession, state }, target) => {
    const key = targetKey(target);
    if (state.networkCaptures.has(key))
      throw new Error(`network capture already active on ${key}`);
    const { page } = await getSession(target);
    const capture = await startCapture(page);
    state.networkCaptures.set(key, capture);
    return JSON.stringify({ capturing: true, ...targetFields(target) });
  },
);

export const networkListCommand = defineTargetCommand(
  {
    description: "List captured network requests",
    flags: [
      opt("--type <type>", "filter by resource type"),
      opt("--include-preserved", "include requests from last 3 navigations"),
      opt("--page-size <n>", "results per page"),
      opt("--page-idx <n>", "page number (0-based)"),
    ],
    name: "network-list",
    toPayload: (o) => ({
      includePreserved: !!o["includePreserved"],
      pageIdx: o["pageIdx"] ? Number(o["pageIdx"]) : undefined,
      pageSize: o["pageSize"] ? Number(o["pageSize"]) : undefined,
      type: o["type"],
    }),
  },
  NetworkStartParams,
  ({ state }, target, { includePreserved, pageIdx, pageSize, type }) => {
    const key = targetKey(target);
    const capture = state.networkCaptures.get(key);
    if (!capture) throw new Error(`no active network capture on ${key}`);
    return listEntries(capture, type, includePreserved, pageIdx, pageSize);
  },
);

const NetworkGetParams = z
  .object({
    reqid: numberParam("reqid"),
    requestFile: textParam("requestFile").optional(),
    responseFile: textParam("responseFile").optional(),
  })
  .readonly();

export const networkGetCommand = defineTargetCommand(
  {
    description: "Get a single network request with full detail",
    flags: [
      req("--reqid <id>", "request index"),
      opt("--request-file <path>", "save request body to file"),
      opt("--response-file <path>", "save response body to file"),
    ],
    name: "network-get",
    toPayload: (o) => ({
      reqid: Number(o["reqid"]),
      requestFile: o["requestFile"],
      responseFile: o["responseFile"],
    }),
  },
  NetworkGetParams,
  ({ state }, target, { reqid, requestFile, responseFile }) => {
    const key = targetKey(target);
    const capture = state.networkCaptures.get(key);
    if (!capture) throw new Error(`no active network capture on ${key}`);
    return getEntry(capture, reqid, requestFile, responseFile);
  },
);

export const networkStopCommand = defineTargetCommand(
  {
    description: "Stop capturing network requests",
    flags: [],
    name: "network-stop",
    toPayload: () => ({}),
  },
  noParams,
  async ({ getSession, state }, target) => {
    const key = targetKey(target);
    const capture = state.networkCaptures.get(key);
    if (!capture) throw new Error(`no active network capture on ${key}`);
    const { page } = await getSession(target);
    const result = await stopCapture(page, capture);
    state.networkCaptures.delete(key);
    return result;
  },
);
