import { afterEach, expect, test, vi } from "vitest";
import { killAllIncludingOrphans } from "./emergency-cleanup.ts";

type ProcessFixture = Readonly<{ argv: readonly string[]; uid: number }>;

const processes = vi.hoisted(() => new Map<string, ProcessFixture>());

const readProcess = (path: string): ProcessFixture => {
  const pid = path.split("/")[2];
  const entry = pid ? processes.get(pid) : undefined;
  if (!entry)
    throw Object.assign(new Error("Process exited"), { code: "ENOENT" });
  return entry;
};

vi.mock("node:fs", () => ({
  readFileSync: (path: string) => `${readProcess(path).argv.join("\0")}\0`,
  readdirSync: () => ["self", ...processes.keys()],
  statSync: (path: string) => ({
    ino: Number(path.split("/")[2]),
    uid: readProcess(path).uid,
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  processes.clear();
});

test.skipIf(process.platform !== "linux")(
  "signals same-user daemons before their browsers and ignores unrelated processes",
  async () => {
    const uid = process.geteuid?.();
    if (uid === undefined) throw new Error("Expected a Linux effective UID");
    const chromium = [
      "/nix/store/bin/.chromium-wrapped",
      "--user-data-dir=/tmp/nix test/chrome-cli-aB12Xz",
      "--remote-debugging-port=9870",
    ];
    processes.set("10", {
      argv: [
        "/home/user/bin/chrome-cli",
        "/$bunfs/root/chrome-cli",
        "--__daemon",
      ],
      uid,
    });
    processes.set("11", {
      argv: ["/bin/bun", "/app/cli.ts", "--__daemon"],
      uid,
    });
    processes.set("20", { argv: chromium, uid });
    processes.set("21", { argv: [...chromium, "--type=renderer"], uid });
    processes.set("22", { argv: chromium, uid: uid + 1 });
    processes.set("23", {
      argv: [
        "chromium",
        "--user-data-dir=/tmp/other-profile",
        "--remote-debugging-port=9871",
      ],
      uid,
    });
    processes.set("24", {
      argv: ["chrome-cli", "kill-all", "--include-orphans"],
      uid,
    });
    const kill = vi.spyOn(process, "kill").mockImplementation((pid) => {
      const key = String(pid);
      processes.delete(key);
      return true;
    });

    const result = await killAllIncludingOrphans();
    expect(result).toBe('{"browsers":[20],"daemons":[10,11]}');
    expect(kill.mock.calls).toEqual([
      [10, "SIGTERM"],
      [11, "SIGTERM"],
      [20, "SIGTERM"],
    ]);
  },
);

test.skipIf(process.platform !== "linux")(
  "reports an empty cleanup without signaling any process",
  async () => {
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    const result = await killAllIncludingOrphans();
    expect(result).toBe('{"browsers":[],"daemons":[]}');
    expect(kill).not.toHaveBeenCalled();
  },
);

test.skipIf(process.platform !== "linux")(
  "reports Chrome still running after the grace period",
  async () => {
    const uid = process.geteuid?.();
    if (uid === undefined) throw new Error("Expected a Linux effective UID");
    processes.set("20", {
      argv: [
        "chrome",
        "--user-data-dir=/tmp/chrome-cli-ABC123",
        "--remote-debugging-port=0",
      ],
      uid,
    });
    vi.spyOn(process, "kill").mockReturnValue(true);
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(5000);
    const result = killAllIncludingOrphans();
    await expect(result).rejects.toThrow(
      "Chrome CLI processes still running: 20",
    );
  },
);
