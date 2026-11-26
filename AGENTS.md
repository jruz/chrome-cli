# chrome-cli

CLI tool for controlling Chrome via CDP (Chrome DevTools Protocol). Designed for parallel use by multiple Claude Code instances.

## Stack

- Runtime: Bun
- Language: TypeScript
- CDP client: puppeteer-core
- CLI framework: commander
- No MCP — direct CLI invocation via Unix socket daemon

## Architecture

- `cli.ts` — thin CLI client, parses flags with commander, sends JSON to daemon, prints response
- `src/client.ts` — `send()` POSTs JSON to Unix socket, `ensureDaemon()` auto-starts daemon on first call
- `src/daemon.ts` — long-lived Bun HTTP server on `/tmp/chrome-cli-<uid>/daemon.sock`, holds sessions map, routes commands
- `src/browser.ts` — `launch()` owns Chrome via a CDP pipe and a temporary profile
- `connect()` attaches to external Chrome by port
- `src/target.ts` — validates session and port targets
- `src/config.ts` — private per-user runtime directory with socket and lock paths, browser limit
- `src/capacity.ts` — reserves browser slots before launch and releases them after confirmed exit
- `src/activity.ts` — tracks last use and in-flight commands so idle owned browsers can be reaped
- `src/daemon-lock.ts` — `flock` ownership lock so one daemon binds the socket
- `src/commands/*.ts` — pure functions: take Page/Browser, return JSON string
- `src/log.ts` — structured JSON logging with `severity` field: `log.info()`, `log.warn()`, `log.error()`

## Flow

1. CLI parses flags into `{ action, ...params }`, including either `session` or `port` for browser commands
2. Sends JSON to daemon over Unix socket
3. Daemon looks up owned browsers by session ID or attaches to external Chrome by port
4. Daemon calls command function, returns result
5. CLI prints result

## Development

- `just chrome-run <command> [options]` — run CLI
- `just ts::tsc-check` — type check
- `just setup` — install locked dependencies with pnpm
- `just test` — run Oxlint rule tests, Bun script and daemon startup tests, and Vitest lifecycle tests
- `just check` — lint, format-check, and type-check the project
- `just tools::check` — validate repository configuration
- `just chrome-bench` — run benchmark
- `just install` — build and copy to `~/.local/bin/`

## Claude Code Skill

`skills/chrome/SKILL.md` — bundled skill for Claude Code users of chrome-cli. Keep it in sync with the commands below when adding or changing commands.

## Release

CI release workflow via Woodpecker. To release a new version:

1. `just release-bump <version>` — bumps `package.json` and commits
2. `git push` — pushes to main
3. CI auto-creates git tag from `package.json` version (`.woodpecker/tag.yml`)
4. Tag event triggers release pipeline (`.woodpecker/release.yml`)
5. CI cross-compiles 4 binaries (linux-x64, linux-arm64, darwin-x64, darwin-arm64) via `bun build --compile`
6. CI creates Codeberg release and uploads binaries

### Release scripts

- `scripts/release-bump.nu` — bumps `package.json` version and commits
- `scripts/release-upload.ts` — creates Codeberg release and uploads binaries from `dist/`
- `scripts/release-delete.ts` — deletes tag + release (local, remote, and Codeberg)

## Commands

`launch` returns `{ "session": "<id>" }`. For external Chrome, replace `--session <id>` with `--port <port>`.

```
chrome-cli oneshot --url <url> --mode snapshot|screenshot [--timeout <ms>] [--path <file>] [--verbose] [--full-page] [--format <format>] [--quality <n>] [--width <px>] [--height <px>]
chrome-cli launch [--headed]
chrome-cli kill --session <id>
chrome-cli kill-all [--include-orphans]
chrome-cli navigate --session <id> --url <url> --timeout <ms> [--init-script <code>]
chrome-cli back|forward --session <id>
chrome-cli reload --session <id> [--ignore-cache]
chrome-cli snapshot --session <id> [--verbose] [--path <file>]
chrome-cli screenshot --session <id> --format png|jpeg|webp [--path <file>] [--full-page] [--quality <n>] [--uid <uid>]
chrome-cli click --session <id> --uid <uid> [--dbl-click]
chrome-cli hover --session <id> --uid <uid>
chrome-cli fill --session <id> --uid <uid> --value <text>
chrome-cli type --session <id> --text <text> [--submit-key <key>]
chrome-cli press --session <id> --key <key>
chrome-cli drag --session <id> --from <uid> --to <uid>
chrome-cli upload --session <id> --uid <uid> --file <path>
chrome-cli fill-form --session <id> --fields '[{"uid":"1","value":"x"}]'
chrome-cli resize --session <id> --width 1024 --height 768
chrome-cli eval --session <id> --expression <code> [--args '<json>']
chrome-cli pages --session <id>
chrome-cli new-page --session <id> --url <url> [--background] [--isolated-context <name>]
chrome-cli close-page --session <id> --page-id <id>
chrome-cli select-page --session <id> --page-id <id>
chrome-cli emulate --session <id> [--viewport WxH] [--user-agent <str>] [--geolocation lat,lng] [--color-scheme dark|light] [--cpu-throttling <rate>] [--network-conditions <preset>]
chrome-cli wait --session <id> --text <texts> --timeout <ms>
chrome-cli dialog --session <id> --action accept|dismiss [--prompt-text <text>]
chrome-cli network-start --session <id>
chrome-cli network-list --session <id> [--type <type>] [--page-size <n>] [--page-idx <n>]
chrome-cli network-get --session <id> --reqid <id> [--request-file <path>] [--response-file <path>]
chrome-cli network-stop --session <id>
chrome-cli console-start --session <id>
chrome-cli console-list --session <id> [--type <type>] [--include-preserved] [--page-size <n>] [--page-idx <n>]
chrome-cli console-get --session <id> --msgid <id>
chrome-cli console-stop --session <id>
chrome-cli trace-start --session <id> [--path <file>] [--reload] [--auto-stop]
chrome-cli trace-stop --session <id> [--path <file>]
chrome-cli trace-analyze --path <file>
chrome-cli trace-analyze-insight --path <file> --insight-set-id <id> --insight-name <name>
chrome-cli heap-snapshot --session <id> --path <file>
chrome-cli daemon-start
chrome-cli daemon-status
chrome-cli daemon-stop
```
