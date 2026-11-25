# chrome-cli

CLI tool for controlling Chrome via CDP (Chrome DevTools Protocol). Designed for parallel use by multiple Claude Code instances.

## Why this over Chrome MCP?

- **Parallel by design** — each Chrome instance gets its own port, so multiple Claude Code agents can browse simultaneously without conflicts
- **No context pollution** — browser state stays in the daemon, outside the model’s context window
- **No MCP setup** — run the CLI directly from your shell
- **Fast** — Unix socket daemon stays warm between calls, no per-request startup cost
- **Composable** — pipe, script, and chain commands like any CLI tool

## Install

### Nix (flake)

```
nix run codeberg:jruz/chrome-cli -- launch
```

Or add to your flake inputs:

```nix
chrome-cli.url = "codeberg:jruz/chrome-cli";
```

### Pre-built binaries

Download from [Codeberg releases](https://codeberg.org/jruz/chrome-cli/releases).

## Usage

```bash
# launch a headless Chrome instance
chrome-cli launch

# navigate to a URL
chrome-cli navigate --port 9222 --url https://example.com --timeout 10000

# take an accessibility snapshot
chrome-cli snapshot --port 9222

# take a screenshot
chrome-cli screenshot --port 9222 --format png --path screenshot.png

# interact with elements (by uid from snapshot)
chrome-cli click --port 9222 --uid 5
chrome-cli fill --port 9222 --uid 3 --value "hello"
chrome-cli type --port 9222 --text "search query" --submit-key Enter

# evaluate JavaScript
chrome-cli eval --port 9222 --expression "document.title"

# manage pages
chrome-cli pages --port 9222
chrome-cli new-page --port 9222 --url https://example.com
chrome-cli close-page --port 9222 --page-id <id>

# kill the instance
chrome-cli kill --port 9222
```

### Stop Chrome sessions

- `chrome-cli kill-all` closes sessions tracked by the current daemon.
- `chrome-cli daemon-stop` also stops the current daemon.

On Linux, pause agents before running `chrome-cli kill-all --include-orphans`.
The flag stops your Chrome CLI daemons and their browsers even if the socket is dead.

## How it works

A long-lived daemon runs on a Unix socket (`/tmp/chrome-cli-<uid>/daemon.sock`). The CLI sends JSON commands to the daemon, which manages Chrome sessions via puppeteer-core. The daemon starts automatically on first use.

The daemon holds an exclusive lock on `daemon.lock` in the same private directory. Concurrent cold starts share the daemon that wins the lock.

### Upgrading from `/tmp/chrome-cli.sock`

Run `chrome-cli daemon-stop` with the old binary before installing.
A daemon left on the old socket can be stopped with `chrome-cli kill-all --include-orphans` on Linux.

```
CLI → Unix socket → Daemon → CDP → Chrome
```

Multiple CLI invocations can control different Chrome instances in parallel by using different `--port` values.

The daemon owns at most 8 browsers, counting `launch` and `oneshot` launches in progress.
A launch over the limit fails until `kill` or `kill-all` closes a browser.

The daemon closes browsers it launched after 30 minutes without a command, unless a command is still running.
`SIGTERM` and `SIGINT` close tracked browsers before the daemon exits.

## Claude Code skill

A [Claude Code skill](https://docs.anthropic.com/en/docs/claude-code/skills) is included in `skills/chrome/SKILL.md`. Copy it to your skills directory to give Claude Code full knowledge of chrome-cli commands and usage patterns:

```bash
cp -r skills/chrome ~/.claude/skills/
```

## AI disclaimer

This project was built with the assistance of Claude Code. All code adheres to strict my own quality standards and is enforced by the [Oxlint configuration](.oxlintrc.json) and [slop-detector](https://codeberg.org/jruz/slop-detector).

## License

[EUPL-1.2](LICENSE)
