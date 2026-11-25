import { log } from "./lib/log.ts";
import { Glob } from "bun";

const parseId = (data: unknown): number => {
  if (typeof data !== "object" || data === null || !("id" in data))
    throw new Error("missing id in response");
  const { id } = data;
  if (typeof id !== "number") throw new Error("id is not a number");
  return id;
};

const run = async (cmd: string[]): Promise<{ ok: boolean; stdout: string }> => {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { ok: code === 0, stdout: stdout.trim() };
};

const repoFromRemote = async (): Promise<string> => {
  const result = await run(["git", "remote", "get-url", "origin"]);
  if (!result.ok) throw new Error("failed to get origin remote URL");
  const match = /codeberg\.org[:/](.+?)(?:\.git)?$/.exec(result.stdout);
  if (!match?.[1])
    throw new Error(`cannot parse repo from remote: ${result.stdout}`);
  return match[1];
};

const nameFromRepo = (repo: string): string => {
  const name = repo.split("/").pop();
  if (!name) throw new Error(`cannot parse name from repo: ${repo}`);
  return name;
};

const headers = (token: string) => ({
  Authorization: `token ${token}`,
});

const ensureRelease = async (
  tag: string,
  token: string,
  repo: string,
): Promise<number> => {
  const url = `https://codeberg.org/api/v1/repos/${repo}/releases/tags/${tag}`;
  const res = await fetch(url, { headers: headers(token) });

  if (res.ok) {
    const data: unknown = await res.json();
    const id = parseId(data);
    log.info(`release ${tag} already exists (id: ${id})`);
    return id;
  }

  if (res.status !== 404) {
    const text = await res.text();
    throw new Error(`check release: ${res.status} ${text}`);
  }

  log.info(`creating release ${tag}...`);
  const createRes = await fetch(
    `https://codeberg.org/api/v1/repos/${repo}/releases`,
    {
      method: "POST",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({ tag_name: tag, name: tag }),
    },
  );

  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`create release: ${createRes.status} ${text}`);
  }

  const createData: unknown = await createRes.json();
  const id = parseId(createData);
  log.info(`created release ${tag} (id: ${id})`);
  return id;
};

const upload = async (
  file: string,
  releaseId: number,
  token: string,
  repo: string,
): Promise<void> => {
  const url = `https://codeberg.org/api/v1/repos/${repo}/releases/${releaseId}/assets?name=${file}`;
  const body = await Bun.file(`dist/${file}`).arrayBuffer();

  const res = await fetch(url, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/octet-stream" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`upload ${file}: ${res.status} ${text}`);
  }
};

const main = async () => {
  const tag = process.argv[2];
  if (!tag) {
    log.error("usage: bun scripts/release-upload.ts <tag>");
    process.exit(1);
  }
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    log.error(`invalid tag format: ${tag} (expected v0.0.0)`);
    process.exit(1);
  }

  const token = process.env["CODEBERG_TOKEN"];
  if (!token) throw new Error("CODEBERG_TOKEN is not set");

  const repo = await repoFromRemote();
  const name = nameFromRepo(repo);

  const pattern = `${name}-*`;
  const glob = new Glob(pattern);
  const scanned = glob.scanSync("dist");
  const files = Array.from(scanned);

  if (files.length === 0) {
    log.error(`no ${name}-* files found`);
    process.exit(1);
  }

  const releaseId = await ensureRelease(tag, token, repo);

  const uploads = files.map(async (file) => {
    log.info(`uploading ${file}...`);
    await upload(file, releaseId, token, repo);
    log.info(`uploaded ${file}`);
  });
  await Promise.all(uploads);

  log.info("release upload complete");
};

await main();
