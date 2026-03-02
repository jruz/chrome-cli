import type { Page } from "puppeteer-core";

type EmulateOptions = {
  viewport?: { width: number; height: number };
  userAgent?: string;
  geolocation?: { latitude: number; longitude: number };
  colorScheme?: "dark" | "light";
};

export const emulate = async (
  page: Page,
  options: EmulateOptions,
): Promise<string> => {
  const applied: string[] = [];

  if (options.viewport) {
    await page.setViewport(options.viewport);
    applied.push("viewport");
  }

  if (options.userAgent) {
    const client = await page.createCDPSession();
    await client.send("Emulation.setUserAgentOverride", { userAgent: options.userAgent });
    await client.detach();
    applied.push("userAgent");
  }

  if (options.geolocation) {
    const client = await page.createCDPSession();
    await client.send("Emulation.setGeolocationOverride", {
      latitude: options.geolocation.latitude,
      longitude: options.geolocation.longitude,
      accuracy: 1,
    });
    await client.detach();
    applied.push("geolocation");
  }

  if (options.colorScheme) {
    await page.emulateMediaFeatures([
      { name: "prefers-color-scheme", value: options.colorScheme },
    ]);
    applied.push("colorScheme");
  }

  return JSON.stringify({ applied });
};

export const resizePage = async (
  page: Page,
  width: number,
  height: number,
): Promise<string> => {
  await page.setViewport({ width, height });
  return JSON.stringify({ resized: { width, height } });
};
