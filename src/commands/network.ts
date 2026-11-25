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

export const startCapture = async (page: Page): Promise<NetworkCapture> => {
  const cdpSession = await page.createCDPSession();
  const entries: NetworkEntry[] = [];
  const preserved: NetworkEntry[][] = [];
  const pending = new Map<string, NetworkEntry>();

  cdpSession.on("Network.requestWillBeSent", (params: RequestWillBeSent) => {
    const entry: NetworkEntry = {
      requestId: params.requestId,
      url: params.request.url,
      method: params.request.method,
      resourceType: params.type,
      status: null,
      encodedDataLength: null,
      requestHeaders: params.request.headers,
      responseHeaders: {},
      postData: params.request.postData,
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

  return { cdpSession, entries, preserved, frameListener };
};

export const listEntries = (
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
    total: filtered.length,
    pageIdx,
    pageSize,
  });
};

export const getEntry = async (
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
    responseBody: responseFilePath
      ? `saved to ${responseFilePath}`
      : responseBody,
    requestBody: requestFilePath
      ? `saved to ${requestFilePath}`
      : entry.postData,
  });
};

export const stopCapture = async (
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
