import type { Page, CDPSession } from "puppeteer-core";
import { writeFile } from "fs/promises";

type Headers = Record<string, string>;

export type NetworkEntry = {
  requestId: string;
  url: string;
  method: string;
  resourceType: string;
  status: number | null;
  encodedDataLength: number | null;
  requestHeaders: Headers;
  responseHeaders: Headers;
  postData: string | undefined;
};

export type NetworkCapture = {
  cdpSession: CDPSession;
  entries: NetworkEntry[];
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
  const pending = new Map<string, NetworkEntry>();

  cdpSession.on("Network.requestWillBeSent", (params: RequestWillBeSent) => {
    const entry: NetworkEntry = {
      requestId: params.requestId,
      url: params.request.url,
      method: params.request.method,
      resourceType: params.type ?? "unknown",
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

  await cdpSession.send("Network.enable");

  return { cdpSession, entries };
};

export const listEntries = (
  entries: NetworkEntry[],
  typeFilter: string | undefined,
  pageIdx: number | undefined,
  pageSize: number | undefined,
): string => {
  const filtered = typeFilter
    ? entries.filter((e) => e.resourceType.toLowerCase() === typeFilter.toLowerCase())
    : entries;

  if (pageSize === undefined) return JSON.stringify(filtered);

  const idx = pageIdx ?? 0;
  const start = idx * pageSize;
  const page = filtered.slice(start, start + pageSize);
  return JSON.stringify({ entries: page, total: filtered.length, pageIdx: idx, pageSize });
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
    const resp = await capture.cdpSession.send("Network.getResponseBody", { requestId: entry.requestId });
    responseBody = resp.base64Encoded ? Buffer.from(resp.body, "base64").toString() : resp.body;
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
    responseBody: responseFilePath ? `saved to ${responseFilePath}` : responseBody,
    requestBody: requestFilePath ? `saved to ${requestFilePath}` : entry.postData,
  });
};

export const stopCapture = async (capture: NetworkCapture): Promise<string> => {
  await capture.cdpSession.detach();
  return JSON.stringify({ stopped: true, totalEntries: capture.entries.length });
};
