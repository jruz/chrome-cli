import type { Page } from "puppeteer-core";

export const evaluate = async (
  page: Page,
  expression: string,
): Promise<string> => {
  const result = await page.evaluate(expression);
  return JSON.stringify({ result });
};
