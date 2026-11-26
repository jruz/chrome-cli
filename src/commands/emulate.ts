import { z } from "zod";
import {
  definePageCommand,
  numberParam,
  opt,
  req,
  textParam,
} from "../command.ts";

import type { Page } from "puppeteer-core";

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

type EmulateOptions = z.infer<typeof EmulateParams>;
type ViewportOptions = z.infer<typeof Viewport>;

const applyViewport = async (
  page: Page,
  viewport: ViewportOptions,
): Promise<void> => {
  if (viewport === "reset") {
    const client = await page.createCDPSession();
    await client.send("Emulation.clearDeviceMetricsOverride");
    await client.detach();
    return;
  }
  const { deviceScaleFactor, hasTouch, isLandscape, isMobile, width, height } =
    viewport;
  await page.setViewport({
    ...(deviceScaleFactor !== undefined ? { deviceScaleFactor } : {}),
    ...(hasTouch !== undefined ? { hasTouch } : {}),
    ...(isLandscape !== undefined ? { isLandscape } : {}),
    ...(isMobile !== undefined ? { isMobile } : {}),
    height,
    width,
  });
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

const emulate = async (
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

const resizePage = async (
  page: Page,
  width: number,
  height: number,
): Promise<string> => {
  await page.setViewport({ height, width });
  return JSON.stringify({ resized: { height, width } });
};

const parseViewport = (v: string) => {
  const parts = v.split("x");
  return { height: Number(parts[1]), width: Number(parts[0]) };
};

const parseGeo = (v: string) => {
  const parts = v.split(",");
  return { latitude: Number(parts[0]), longitude: Number(parts[1]) };
};

const Reset = z.literal("reset");
const Viewport = z.union([
  Reset,
  z.object({
    deviceScaleFactor: z.number().optional(),
    hasTouch: z.boolean().optional(),
    height: z.number(),
    isLandscape: z.boolean().optional(),
    isMobile: z.boolean().optional(),
    width: z.number(),
  }),
]);
const Geo = z.union([
  Reset,
  z.object({ latitude: z.number(), longitude: z.number() }),
]);
const ViewportParam = Viewport.optional().catch(undefined);
const GeoParam = Geo.optional().catch(undefined);

const ResizeParams = z
  .object({ height: numberParam("height"), width: numberParam("width") })
  .readonly();

export const resizeCommand = definePageCommand(
  {
    description: "Resize the page viewport",
    flags: [
      req("--width <px>", "viewport width"),
      req("--height <px>", "viewport height"),
    ],
    name: "resize",
    toPayload: (o) => ({
      height: Number(o["height"]),
      width: Number(o["width"]),
    }),
  },
  ResizeParams,
  (page, { width, height }) => resizePage(page, width, height),
);

const EmulateParams = z
  .object({
    colorScheme: z.enum(["dark", "light", "auto"]).optional(),
    cpuThrottlingRate: numberParam("cpuThrottlingRate").optional(),
    geolocation: GeoParam,
    networkConditions: textParam("networkConditions").optional(),
    userAgent: textParam("userAgent").optional(),
    viewport: ViewportParam,
  })
  .readonly();

export const emulateCommand = definePageCommand(
  {
    description: "Emulate device features",
    flags: [
      opt("--viewport <WxH>", "viewport size (WxH or 'reset')"),
      opt("--has-touch", "enable touch events"),
      opt("--is-mobile", "enable mobile viewport"),
      opt("--is-landscape", "landscape orientation"),
      opt("--device-scale-factor <n>", "device pixel ratio"),
      opt("--user-agent <string>", "user agent string (or 'reset')"),
      opt("--geolocation <lat,lng>", "geolocation (or 'reset')"),
      opt("--color-scheme <scheme>", "dark, light, or auto"),
      opt("--cpu-throttling <rate>", "CPU slowdown factor (1 to disable)"),
      opt(
        "--network-conditions <preset>",
        "Offline, Slow 3G, Fast 3G, Slow 4G, Fast 4G, No emulation",
      ),
    ],
    name: "emulate",
    toPayload: (o) => {
      const resolveViewport = () => {
        if (!o["viewport"]) return undefined;
        if (o["viewport"] === "reset") return "reset";
        const vp = parseViewport(o["viewport"]);
        return {
          ...vp,
          ...(o["hasTouch"] ? { hasTouch: true } : {}),
          ...(o["isMobile"] ? { isMobile: true } : {}),
          ...(o["isLandscape"] ? { isLandscape: true } : {}),
          ...(o["deviceScaleFactor"]
            ? { deviceScaleFactor: Number(o["deviceScaleFactor"]) }
            : {}),
        };
      };

      const resolveGeo = () => {
        if (!o["geolocation"]) return undefined;
        if (o["geolocation"] === "reset") return "reset";
        return parseGeo(o["geolocation"]);
      };

      return {
        colorScheme: o["colorScheme"],
        cpuThrottlingRate: o["cpuThrottling"]
          ? Number(o["cpuThrottling"])
          : undefined,
        geolocation: resolveGeo(),
        networkConditions: o["networkConditions"],
        userAgent: o["userAgent"],
        viewport: resolveViewport(),
      };
    },
  },
  EmulateParams,
  (page, params) => emulate(page, params),
);
