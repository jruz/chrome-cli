import pkg from "../package.json";

const revision = process.env.REVISION;
if (!revision) throw new Error("REVISION environment variable is not set");

const buildTime = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

export const versionString = (): string =>
  `\nversion:    ${pkg.version}\nrevision:   ${revision}\nbuild-time: ${buildTime}`;
