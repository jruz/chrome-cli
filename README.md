# chrome-cli

CLI tool for controlling Chrome via CDP (Chrome DevTools Protocol). Designed for parallel use by multiple Claude Code instances.

## Why this over Chrome MCP?

- **Parallel by design** — each launched Chrome instance gets its own session ID, so multiple Claude Code agents can browse simultaneously without conflicts
- **No context pollution** — browser state stays in the daemon, outside the model’s context window
- **No MCP setup** — run the CLI directly from your shell
- **Fast** — Unix socket daemon stays warm between calls, no per-request startup cost
- **Composable** — pipe, script, and chain commands like any CLI tool

## Install

### Nix (flake)

```
nix run github:jruz/chrome-cli -- launch
```

Or add to your flake inputs:

```nix
chrome-cli.url = "github:jruz/chrome-cli";
```

### Pre-built binaries

Download a static binary from [GitHub releases](https://github.com/jruz/chrome-cli/releases).

## Usage

```bash
# launch a headless Chrome and load a page
s=$(chrome-cli launch --url http://localhost:3000)

# read the accessibility tree with element uids
chrome-cli snapshot -s "$s"

# act by role and name, waiting for the result
chrome-cli click -s "$s" 'button "Save"' --wait-for Saved
chrome-cli fill-form -s "$s" 'Email=a@b.com' 'Password=secret' --submit 'button "Sign in"'

# capture screenshots across viewports and color schemes
chrome-cli screenshot -s "$s" --viewport mobile,desktop --color-scheme light,dark

# inspect problems since launch
chrome-cli console -s "$s"
chrome-cli network -s "$s"

# evaluate JavaScript
chrome-cli eval -s "$s" "document.title"

# close the browser
chrome-cli kill -s "$s"
```

Add `--json` before any command for machine-readable output.

To control a Chrome you started with a local remote-debugging port, use `--port <port>` instead of `-s`.

### Stop Chrome sessions

- `chrome-cli kill-all` closes sessions tracked by the current daemon.
- `chrome-cli daemon-stop` also stops the current daemon.

On Linux, pause agents before running `chrome-cli kill-all --include-orphans`.
The flag stops your chrome-cli daemons and their browsers even if the socket is dead.

## How it works

```
CLI → Unix socket → Daemon → CDP pipe → Chrome
```

A long-lived daemon runs on a Unix socket (`/tmp/chrome-cli-<uid>/daemon.sock`) and starts automatically on first use.
It holds an exclusive lock on `daemon.lock` in the same private directory, so concurrent cold starts share one daemon.
Logs go to `daemon.log` in that directory.

The daemon owns each browser it launches through a private CDP pipe, so these browsers expose no debugging port.
It owns at most 8 browsers, counting launches in progress.

Browsers idle for 30 minutes are closed unless a command is still running.
`SIGTERM` and `SIGINT` close tracked browsers before the daemon exits.
After a `SIGKILL`, Chrome exits when the pipe closes, and its temporary profile can remain on disk.

## Claude Code skill

A [Claude Code skill](https://docs.anthropic.com/en/docs/claude-code/skills) is included in `skills/chrome/SKILL.md`. Copy it to your skills directory to give Claude Code full knowledge of chrome-cli commands and usage patterns:

```bash
cp -r skills/chrome ~/.claude/skills/
```

## AI disclaimer

This project was built with the assistance of Claude Code. All code adheres to my own strict quality standards, enforced by gofmt, go vet, staticcheck, and [slop-detector](https://github.com/jruz/slop-detector).

## License

[EUPL-1.2](LICENSE)
