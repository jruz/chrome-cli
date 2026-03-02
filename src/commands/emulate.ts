import type { Page } from "puppeteer-core";

type ViewportOptions = {
  width: number;
  height: number;
  hasTouch?: boolean;
  isMobile?: boolean;
  isLandscape?: boolean;
  deviceScaleFactor?: number;
};

type NetworkPreset = "Offline" | "Slow 3G" | "Fast 3G" | "Slow 4G" | "Fast 4G";

type NetworkParams = {
  offline: boolean;
  downloadThroughput: number;
  uploadThroughput: number;
  latency: number;
};

const networkPresets: Record<NetworkPreset, NetworkParams> = {
  "Offline": { offline: true, downloadThroughput: 0, uploadThroughput: 0, latency: 0 },
  "Slow 3G": { offline: false, downloadThroughput: 50000, uploadThroughput: 50000, latency: 2000 },
  "Fast 3G": { offline: false, downloadThroughput: 180000, uploadThroughput: 84375, latency: 562 },
  "Slow 4G": { offline: false, downloadThroughput: 400000, uploadThroughput: 150000, latency: 300 },
  "Fast 4G": { offline: false, downloadThroughput: 3000000, uploadThroughput: 1500000, latency: 100 },
};

const isNetworkPreset = (v: string): v is NetworkPreset => v in networkPresets;

type EmulateOptions = {
  viewport?: ViewportOptions;
  userAgent?: string;
  geolocation?: { latitude: number; longitude: number };
  colorScheme?: "dark" | "light";
  cpuThrottlingRate?: number;
  networkConditions?: string;
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

  if (options.cpuThrottlingRate !== undefined) {
    const client = await page.createCDPSession();
    await client.send("Emulation.setCPUThrottlingRate", { rate: options.cpuThrottlingRate });
    await client.detach();
    applied.push("cpuThrottlingRate");
  }

  if (options.networkConditions) {
    if (!isNetworkPreset(options.networkConditions)) {
      throw new Error(`invalid network preset: ${options.networkConditions}`);
    }
    const client = await page.createCDPSession();
    await client.send("Network.enable");
    await client.send("Network.emulateNetworkConditions", networkPresets[options.networkConditions]);
    await client.detach();
    applied.push("networkConditions");
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
