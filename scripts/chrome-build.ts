import { z } from "zod";

const BuildEnvironment = z.object({
  CHROME_CLI_NATIVE_BUN: z.string().min(1),
  REVISION: z.string().min(1),
});
const env = BuildEnvironment.parse(process.env);
const buildTime = new Date().toISOString();
const result = Bun.spawnSync(
  [
    env.CHROME_CLI_NATIVE_BUN,
    "build",
    "cli.ts",
    "--compile",
    "--outfile=dist/chrome-cli",
    "--define",
    `CHROME_CLI_BUILD_REVISION=${JSON.stringify(env.REVISION)}`,
    "--define",
    `process.env.BUILD_TIME=${JSON.stringify(buildTime)}`,
  ],
  { stderr: "inherit", stdout: "inherit" },
);
process.exit(result.exitCode);
