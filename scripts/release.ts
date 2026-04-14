import { log } from "./log";

type Target = {
  os: string;
  arch: string;
  nixSystem: string;
};

const TARGETS: Target[] = [
  { os: "linux", arch: "x64", nixSystem: "x86_64-linux" },
  { os: "linux", arch: "arm64", nixSystem: "aarch64-linux" },
  { os: "darwin", arch: "x64", nixSystem: "x86_64-darwin" },
  { os: "darwin", arch: "arm64", nixSystem: "aarch64-darwin" },
];

const run = async (
  cmd: string[],
  env?: Record<string, string>,
): Promise<string> => {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "inherit",
    env: { ...process.env, ...env },
  });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`command failed: ${cmd.join(" ")}`);
  return stdout.trim();
};

const gitRevision = async (): Promise<string> =>
  run(["git", "rev-parse", "HEAD"]);

const gitIsClean = async (): Promise<boolean> => {
  const status = await run(["git", "status", "--porcelain"]);
  return status === "";
};

const tagExists = async (tag: string): Promise<boolean> => {
  const proc = Bun.spawn(["git", "tag", "--list", tag], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout.trim() !== "";
};

const bumpVersion = async (version: string): Promise<void> => {
  const text = await Bun.file("package.json").text();
  let pkg: unknown;
  try {
    pkg = JSON.parse(text);
  } catch (e) {
    throw new Error("failed to parse package.json", { cause: e });
  }
  if (typeof pkg !== "object" || pkg === null || !("version" in pkg))
    throw new Error("missing version in package.json");
  const updated = { ...pkg, version };
  await Bun.write("package.json", JSON.stringify(updated, null, 2) + "\n");
};

const buildTarget = async (
  os: string,
  arch: string,
  revision: string,
): Promise<void> => {
  log.info(`building ${os}-${arch}...`);
  await run(["scripts/release-build.sh", os, arch], { REVISION: revision });
  log.ok(`built ${os}-${arch}`);
};

const nixHash = async (file: string): Promise<string> =>
  run(["nix", "hash", "file", "--sri", file]);

const nixEdit = async (file: string, attr: string, value: string): Promise<void> => {
  await run(["nix-editor", file, attr, "--val", `"${value}"`, "--inplace"]);
};

const updateNixHashes = async (
  version: string,
  hashes: Map<string, string>,
): Promise<void> => {
  await nixEdit("default.nix", "version", version);

  const edits = TARGETS.map(async (target) => {
      const hash = hashes.get(target.nixSystem);
      if (!hash) throw new Error(`missing hash for ${target.nixSystem}`);
      await nixEdit("hashes.nix", target.nixSystem, hash);
    });
  await Promise.all(edits);
};

const gitCommitTagPush = async (
  tag: string,
): Promise<void> => {
  await run(["git", "add", "package.json", "default.nix", "hashes.nix"]);
  await run(["git", "commit", "--message", `[rele] Release ${tag}`]);
  await run(["git", "tag", tag]);
  await run(["git", "push", "origin", "main", tag]);
};

const uploadRelease = async (tag: string): Promise<void> => {
  await run(["bun", "scripts/release-upload.ts", tag]);
};

const parseVersion = (arg: string | undefined): string => {
  if (!arg) {
    log.error("usage: bun scripts/release.ts <version> (e.g. 0.2.0)");
    process.exit(1);
  }
  if (!/^\d+\.\d+\.\d+$/.test(arg)) {
    log.error(`invalid version format: ${arg} (expected 0.0.0)`);
    process.exit(1);
  }
  return arg;
};

const main = async () => {
  const version = parseVersion(process.argv[2]);
  const tag = `v${version}`;

  log.info(`releasing ${tag}`);

  if (await tagExists(tag)) throw new Error(`tag ${tag} already exists`);
  if (!(await gitIsClean())) throw new Error("working tree is not clean");

  await bumpVersion(version);
  log.ok(`bumped package.json to ${version}`);

  const revision = await gitRevision();
  log.info(`revision: ${revision}`);

  const initial = Promise.resolve();
  await TARGETS.reduce(async (prev, target) => {
    await prev;
    await buildTarget(target.os, target.arch, revision);
  }, initial);

  const name = "chrome-cli";
  const hashTasks = TARGETS.map(async (target) => {
      const file = `dist/${name}-${target.os}-${target.arch}`;
      const hash = await nixHash(file);
      log.info(`${target.nixSystem}: ${hash}`);
      const entry: [string, string] = [target.nixSystem, hash];
      return entry;
    });
  const entries: [string, string][] = await Promise.all(hashTasks);
  const hashes = new Map(entries);

  await updateNixHashes(version, hashes);
  log.ok("updated default.nix and hashes.nix");

  await gitCommitTagPush(tag);
  log.ok(`committed, tagged ${tag}, and pushed`);

  await uploadRelease(tag);
  log.ok(`release ${tag} complete`);
};

await main();
