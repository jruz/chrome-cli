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
  "Fast 3G": {
    downloadThroughput: 180000,
    latency: 562,
    offline: false,
    uploadThroughput: 84375,
  },
  "Fast 4G": {
    downloadThroughput: 3000000,
    latency: 100,
    offline: false,
    uploadThroughput: 1500000,
  },
  Offline: {
    downloadThroughput: 0,
    latency: 0,
    offline: true,
    uploadThroughput: 0,
  },
  "Slow 3G": {
    downloadThroughput: 50000,
    latency: 2000,
    offline: false,
    uploadThroughput: 50000,
  },
  "Slow 4G": {
    downloadThroughput: 400000,
    latency: 300,
    offline: false,
    uploadThroughput: 150000,
  },
};

const isNetworkPreset = (v: string): v is NetworkPreset => v in networkPresets;

type EmulateOptions = {
  viewport?: ViewportOptions | "reset";
  userAgent?: string;
  geolocation?: { latitude: number; longitude: number } | "reset";
  colorScheme?: "dark" | "light" | "auto";
  cpuThrottlingRate?: number;
  networkConditions?: string;
};

const applyViewport = async (
  page: Page,
  viewport: ViewportOptions | "reset",
): Promise<void> => {
  if (viewport === "reset") {
    const client = await page.createCDPSession();
    await client.send("Emulation.clearDeviceMetricsOverride");
    await client.detach();
    return;
  }
  await page.setViewport(viewport);
};

const applyUserAgent = async (page: Page, userAgent: string): Promise<void> => {
  const client = await page.createCDPSession();
  if (userAgent === "reset") {
    await client.send("Emulation.setUserAgentOverride", { userAgent: "" });
  } else {
    await client.send("Emulation.setUserAgentOverride", { userAgent });
  }
  await client.detach();
};

const applyGeolocation = async (
  page: Page,
  geolocation: { latitude: number; longitude: number } | "reset",
): Promise<void> => {
  const client = await page.createCDPSession();
  if (geolocation === "reset") {
    await client.send("Emulation.clearGeolocationOverride");
  } else {
    await client.send("Emulation.setGeolocationOverride", {
      accuracy: 1,
      latitude: geolocation.latitude,
      longitude: geolocation.longitude,
    });
  }
  await client.detach();
};

const applyColorScheme = async (
  page: Page,
  colorScheme: "dark" | "light" | "auto",
): Promise<void> => {
  if (colorScheme === "auto") {
    await page.emulateMediaFeatures([]);
    return;
  }
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: colorScheme },
  ]);
};

const applyNetwork = async (page: Page, conditions: string): Promise<void> => {
  const client = await page.createCDPSession();
  await client.send("Network.enable");

  if (conditions === "No emulation") {
    await client.send("Network.emulateNetworkConditions", {
      downloadThroughput: -1,
      latency: 0,
      offline: false,
      uploadThroughput: -1,
    });
    await client.detach();
    return;
  }

  if (!isNetworkPreset(conditions)) {
    await client.detach();
    throw new Error(`invalid network preset: ${conditions}`);
  }

  await client.send(
    "Network.emulateNetworkConditions",
    networkPresets[conditions],
  );
  await client.detach();
};

export const emulate = async (
  page: Page,
  options: EmulateOptions,
): Promise<string> => {
  const applied: string[] = [];

  if (options.viewport !== undefined) {
    await applyViewport(page, options.viewport);
    applied.push("viewport");
  }

  if (options.userAgent !== undefined) {
    await applyUserAgent(page, options.userAgent);
    applied.push("userAgent");
  }

  if (options.geolocation !== undefined) {
    await applyGeolocation(page, options.geolocation);
    applied.push("geolocation");
  }

  if (options.colorScheme !== undefined) {
    await applyColorScheme(page, options.colorScheme);
    applied.push("colorScheme");
  }

  if (options.cpuThrottlingRate !== undefined) {
    const client = await page.createCDPSession();
    await client.send("Emulation.setCPUThrottlingRate", {
      rate: options.cpuThrottlingRate,
    });
    await client.detach();
    applied.push("cpuThrottlingRate");
  }

  if (options.networkConditions !== undefined) {
    await applyNetwork(page, options.networkConditions);
    applied.push("networkConditions");
  }

  return JSON.stringify({ applied });
};

export const resizePage = async (
  page: Page,
  width: number,
  height: number,
): Promise<string> => {
  await page.setViewport({ height, width });
  return JSON.stringify({ resized: { height, width } });
};
