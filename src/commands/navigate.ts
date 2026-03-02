import type { Page } from "puppeteer-core";

export const navigate = async (
  page: Page,
  url: string,
  timeout: number,
): Promise<string> => {
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout,
  });
  if (!response) {
    throw new Error(`no response from ${url}`);
  }
  return JSON.stringify({
    url: page.url(),
    status: response.status(),
    title: await page.title(),
  });
};

export const navigateBack = async (page: Page): Promise<string> => {
  await page.goBack({ waitUntil: "domcontentloaded" });
  return JSON.stringify({ url: page.url(), title: await page.title() });
};

export const navigateForward = async (page: Page): Promise<string> => {
  await page.goForward({ waitUntil: "domcontentloaded" });
  return JSON.stringify({ url: page.url(), title: await page.title() });
};

export const reload = async (page: Page): Promise<string> => {
  await page.reload({ waitUntil: "domcontentloaded" });
  return JSON.stringify({ url: page.url(), title: await page.title() });
};
