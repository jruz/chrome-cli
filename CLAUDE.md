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
- `src/daemon.ts` — long-lived Bun HTTP server on `/tmp/chrome-cli.sock`, holds sessions map, routes commands
- `src/browser.ts` — `launch()` spawns detached Chrome with temp user-data-dir, `connect()` uses puppeteer
- `src/commands/*.ts` — pure functions: take Page/Browser, return JSON string
- `src/log.ts` — `log.info()`, `log.warn()`, `log.error()`

## Flow

1. CLI parses flags into `{ action, port, ...params }`
2. Sends JSON to daemon over Unix socket
3. Daemon looks up session by port (or creates one)
4. Daemon calls command function, returns result
5. CLI prints result

## Development

- `bun run cli.ts <command> [options]` — run CLI
- `bun run tsc --noEmit` — type check
- `bun run bench.ts` — benchmark CLI vs daemon vs raw CDP
- `bun test` — run tests
- `just check` — lint
- `just chrome-bench` — run benchmark
- `just chrome-build` — compile to `dist/chrome-cli`
- `just chrome-install` — build and copy to `~/.local/bin/`

## Commands

```
chrome-cli launch [--headed]
chrome-cli kill --port <port>
chrome-cli kill-all
chrome-cli navigate --port <port> --url <url> --timeout <ms> [--init-script <code>]
chrome-cli back|forward --port <port>
chrome-cli reload --port <port> [--ignore-cache]
chrome-cli snapshot --port <port> [--verbose] [--path <file>]
chrome-cli screenshot --port <port> [--path <file>] [--full-page] [--format png|jpeg|webp] [--quality <n>] [--uid <uid>]
chrome-cli click --port <port> --uid <uid> [--dbl-click]
chrome-cli hover --port <port> --uid <uid>
chrome-cli fill --port <port> --uid <uid> --value <text>
chrome-cli type --port <port> --text <text> [--submit-key <key>]
chrome-cli press --port <port> --key <key>
chrome-cli drag --port <port> --from <uid> --to <uid>
chrome-cli upload --port <port> --uid <uid> --file <path>
chrome-cli fill-form --port <port> --fields '[{"uid":"1","value":"x"}]'
chrome-cli resize --port <port> --width 1024 --height 768
chrome-cli eval --port <port> --expression <code> [--args '<json>']
chrome-cli pages --port <port>
chrome-cli new-page --port <port> --url <url> [--background] [--isolated-context <name>]
chrome-cli close-page --port <port> --page-id <id>
chrome-cli select-page --port <port> --page-id <id>
chrome-cli emulate --port <port> [--viewport WxH] [--user-agent <str>] [--geolocation lat,lng] [--color-scheme dark|light] [--cpu-throttling <rate>] [--network-conditions <preset>]
chrome-cli wait --port <port> --text <texts> --timeout <ms>
chrome-cli dialog --port <port> --action accept|dismiss [--prompt-text <text>]
chrome-cli network-start --port <port>
chrome-cli network-list --port <port> [--type <type>] [--page-size <n>] [--page-idx <n>]
chrome-cli network-get --port <port> --reqid <id> [--request-file <path>] [--response-file <path>]
chrome-cli network-stop --port <port>
chrome-cli console-start --port <port>
chrome-cli console-list --port <port> [--type <type>] [--include-preserved] [--page-size <n>] [--page-idx <n>]
chrome-cli console-get --port <port> --msgid <id>
chrome-cli console-stop --port <port>
chrome-cli trace-start --port <port> [--path <file>]
chrome-cli trace-stop --port <port> [--path <file>]
chrome-cli heap-snapshot --port <port> --path <file>
chrome-cli daemon-start
chrome-cli daemon-status
chrome-cli daemon-stop
```
