import type { Page, CDPSession } from "puppeteer-core";

export type NetworkEntry = {
  requestId: string;
  url: string;
  method: string;
  resourceType: string;
  status: number | null;
  encodedDataLength: number | null;
};

export type NetworkCapture = {
  cdpSession: CDPSession;
  entries: NetworkEntry[];
};

export const startCapture = async (page: Page): Promise<NetworkCapture> => {
  const cdpSession = await page.createCDPSession();
  const entries: NetworkEntry[] = [];
  const pending = new Map<string, NetworkEntry>();

  cdpSession.on("Network.requestWillBeSent", (params: any) => {
    const entry: NetworkEntry = {
      requestId: params.requestId,
      url: params.request.url,
      method: params.request.method,
      resourceType: params.type,
      status: null,
      encodedDataLength: null,
    };
    pending.set(params.requestId, entry);
    entries.push(entry);
  });

  cdpSession.on("Network.responseReceived", (params: any) => {
    const entry = pending.get(params.requestId);
    if (!entry) return;
    entry.status = params.response.status;
    entry.resourceType = params.type;
  });

  cdpSession.on("Network.loadingFinished", (params: any) => {
    const entry = pending.get(params.requestId);
    if (!entry) return;
    entry.encodedDataLength = params.encodedDataLength;
    pending.delete(params.requestId);
  });

  cdpSession.on("Network.loadingFailed", (params: any) => {
    pending.delete(params.requestId);
  });

  await cdpSession.send("Network.enable");

  return { cdpSession, entries };
};

export const listEntries = (
  entries: NetworkEntry[],
  typeFilter: string | undefined,
): string => {
  const filtered = typeFilter
    ? entries.filter((e) => e.resourceType.toLowerCase() === typeFilter.toLowerCase())
    : entries;
  return JSON.stringify(filtered);
};

export const stopCapture = async (capture: NetworkCapture): Promise<string> => {
  await capture.cdpSession.detach();
  return JSON.stringify({ stopped: true, totalEntries: capture.entries.length });
};
