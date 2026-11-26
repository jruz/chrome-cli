---
name: chrome
description: Debug UI with chrome-cli via CDP. Use when visually verifying changes, taking screenshots, inspecting DOM, network capture, or browser automation.
---

# UI Debugging with chrome-cli

Use `chrome-cli` to control Chrome via CDP for visual verification during development.

## One-shot

For quick content retrieval without managing browser lifecycle:

- Text: `chrome-cli oneshot --url <url> --mode snapshot`
- Screenshot: `chrome-cli oneshot --url <url> --mode screenshot --path /tmp/page.png`
- Verbose text: `chrome-cli oneshot --url <url> --mode snapshot --verbose`

Defaults: timeout 30s, viewport 1366x768, png format, full-page screenshots.
Uses `networkidle0` wait strategy — works with SPAs.

## Multi-step Debug Workflow

1. Launch: `chrome-cli launch` (returns `{ "session": "<id>" }`)
2. Navigate: `chrome-cli navigate --session <id> --url <url> --timeout 10000`
3. Snapshot: `chrome-cli snapshot --session <id>` (get uids)
4. Screenshot: `chrome-cli screenshot --session <id> --format png --path /tmp/debug.png`
5. Interact using uids from snapshot
6. Kill: `chrome-cli kill --session <id>`

`kill` waits for the requested browser to close before reporting success.
`kill-all` and `daemon-stop` close only sessions tracked by that daemon.

On Linux, use `kill-all --include-orphans` for emergency cleanup without the socket. It stops the current user’s Chrome CLI daemons and browsers, including other agents’ sessions.

## Commands

| Command                 | Purpose                       | Key Flags                                                                                                          |
| ----------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `oneshot`               | One-shot page capture         | `--url --mode [--timeout] [--path] [--verbose] [--full-page] [--format] [--quality] [--width] [--height]`          |
| `launch`                | Start Chrome instance         | `--headed`                                                                                                         |
| `kill`                  | Stop Chrome instance          | `--session`                                                                                                        |
| `kill-all`              | Stop tracked instances        | `[--include-orphans]`                                                                                              |
| `navigate`              | Go to URL                     | `--session --url --timeout [--init-script]`                                                                        |
| `back`                  | Navigate back                 | `--session`                                                                                                        |
| `forward`               | Navigate forward              | `--session`                                                                                                        |
| `reload`                | Reload page                   | `--session [--ignore-cache]`                                                                                       |
| `snapshot`              | Accessibility tree (get uids) | `--session [--verbose] [--path]`                                                                                   |
| `screenshot`            | Capture image                 | `--session --format [--path] [--full-page] [--quality] [--uid]`                                                    |
| `click`                 | Click element                 | `--session --uid [--dbl-click]`                                                                                    |
| `hover`                 | Hover element                 | `--session --uid`                                                                                                  |
| `fill`                  | Type into input               | `--session --uid --value`                                                                                          |
| `type`                  | Type into focused element     | `--session --text [--submit-key]`                                                                                  |
| `press`                 | Press key                     | `--session --key`                                                                                                  |
| `drag`                  | Drag element                  | `--session --from --to`                                                                                            |
| `upload`                | Upload file                   | `--session --uid --file`                                                                                           |
| `fill-form`             | Batch fill inputs             | `--session --fields '[{"uid":"1","value":"x"}]'`                                                                   |
| `resize`                | Set viewport size             | `--session --width --height`                                                                                       |
| `eval`                  | Run JavaScript                | `--session --expression [--args]`                                                                                  |
| `pages`                 | List open pages               | `--session`                                                                                                        |
| `new-page`              | Open new tab                  | `--session --url [--background] [--isolated-context] [--timeout]`                                                  |
| `close-page`            | Close tab                     | `--session --page-id`                                                                                              |
| `select-page`           | Switch tab                    | `--session --page-id`                                                                                              |
| `emulate`               | Device emulation              | `--session [--viewport] [--color-scheme] [--cpu-throttling] [--network-conditions] [--user-agent] [--geolocation]` |
| `wait`                  | Wait for text                 | `--session --text --timeout`                                                                                       |
| `dialog`                | Handle dialog                 | `--session --action [--prompt-text]`                                                                               |
| `network-start`         | Start capture                 | `--session`                                                                                                        |
| `network-list`          | List requests                 | `--session [--type] [--page-size] [--page-idx]`                                                                    |
| `network-get`           | Get request detail            | `--session --reqid [--request-file] [--response-file]`                                                             |
| `network-stop`          | Stop capture                  | `--session`                                                                                                        |
| `console-start`         | Start capture                 | `--session`                                                                                                        |
| `console-list`          | List messages                 | `--session [--type] [--include-preserved] [--page-size] [--page-idx]`                                              |
| `console-get`           | Get message detail            | `--session --msgid`                                                                                                |
| `console-stop`          | Stop capture                  | `--session`                                                                                                        |
| `trace-start`           | Start perf trace              | `--session [--path] [--reload] [--auto-stop]`                                                                      |
| `trace-stop`            | Stop perf trace               | `--session [--path]`                                                                                               |
| `trace-analyze`         | Analyze trace file            | `--path`                                                                                                           |
| `trace-analyze-insight` | Drill into insight            | `--path --insight-set-id --insight-name`                                                                           |
| `heap-snapshot`         | Memory snapshot               | `--session --path`                                                                                                 |
| `daemon-start`          | Start daemon                  |                                                                                                                    |
| `daemon-status`         | Check daemon                  |                                                                                                                    |
| `daemon-stop`           | Stop daemon                   |                                                                                                                    |

## Key Rules

- Always pass `--timeout` on `navigate` (default: 10000)
- Get uids from `snapshot` before interacting — uids come from the accessibility tree
- Use `--session <id>` for a browser started by `launch`.
- Use `--port <port>` instead for external Chrome with a local debugging port.
- `eval --args` takes JSON array of `{"uid":"<id>"}` objects to pass elements to the expression
- `fill-form --fields` takes a JSON string array of `{"uid":"<id>","value":"<text>"}` objects
- `wait --text` accepts comma-separated values, resolves when any appears
- `emulate --viewport` format is `WxH` (e.g., `375x812`)
- `emulate --geolocation` format is `lat,lng`
- Screenshots save to file with `--path`, otherwise return base64
- Network/console capture must be explicitly started before listing
