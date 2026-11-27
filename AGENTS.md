# chrome-cli

CLI tool for controlling Chrome via CDP (Chrome DevTools Protocol). Designed for parallel use by multiple Claude Code instances.

## Stack

- Language: Go, built with `CGO_ENABLED=0` into a static binary
- CLI framework: kong
- CDP: raw JSON over `--remote-debugging-pipe` for owned browsers and a websocket for `--port`
- No MCP — direct CLI invocation via Unix socket daemon

## Architecture

- `cmd/chrome-cli` — entry point calling `cli.Main`
- `internal/cli` — kong command structs, one per command, sending requests through the client
- `internal/client` — HTTP over the daemon socket, auto-starts `daemon-serve`
- `internal/daemon` — single-owner daemon with a store goroutine applying typed events
- `internal/daemon/lock.go` — `flock` ownership so one daemon binds the socket
- `internal/daemon/capacity.go` — reserves browser slots before launch and releases them after confirmed exit
- `internal/daemon/activity.go` — tracks last use and in-flight commands for idle reaping
- `internal/cdp` — CDP connection routing responses by ID and events by session
- `internal/browser` — owned Chrome over a pipe and external Chrome by port
- `internal/page` — attached page targets, evaluation, and dialog auto-accept
- `internal/commands` — CDP logic for each command
- `internal/target` — resolves uids and `role "name"` targets
- `internal/settle` — waits for navigation, network idle, and a quiet DOM after actions
- `internal/recorder` — console and network history per page
- `internal/protocol` — request and result types shared by the CLI and daemon
- `internal/output` — plain text or `--json` output and one-line errors
- `internal/orphans` — `kill-all --include-orphans` cleanup on Linux

## Flow

1. The CLI parses flags into a protocol request with an optional target
2. The client sends it to `/tmp/chrome-cli-<uid>/daemon.sock`
3. The daemon resolves the target and tracks the command for idle reaping
4. The command runs against the selected page
5. The CLI prints plain text or JSON

## Development

- `just check` — gofmt, go vet, and staticcheck in the sandbox
- `just test` — Go tests against sandboxed Chromium
- `just fix` — format Go files
- `just chrome-run <command> [options]` — build and run the CLI
- `just install` — build and copy to `~/.local/bin/`
- `just tools::check` — validate repository configuration

## Claude Code Skill

`skills/chrome/SKILL.md` — bundled skill for Claude Code users of chrome-cli. Keep it in sync with the commands in `internal/cli`.

## Release

1. `just release bump patch|minor|major` starts the Woodpecker manual pipeline
2. `.woodpecker/release.yml` runs `scripts/release.nu publish <version>`
3. The pipeline cross-compiles four binaries, records their hashes in `release.json`, and publishes a GitHub release
4. `just release delete <tag>` removes a release and its tag
