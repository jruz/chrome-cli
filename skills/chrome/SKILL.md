---
name: chrome
description: Debug UI with chrome-cli via CDP. Use when visually verifying changes, taking screenshots, inspecting DOM, console errors, failed requests, or browser automation.
---

# UI Debugging with chrome-cli

Use `chrome-cli` to drive headless Chrome for visual verification during development.

## One-shot

- Text: `chrome-cli oneshot snapshot <url>`
- Screenshot: `chrome-cli oneshot screenshot <url>` prints the saved path
- Matrix: `chrome-cli oneshot screenshot <url> --viewport mobile,desktop --color-scheme light,dark`

## Session Workflow

1. `s=$(chrome-cli launch --url http://localhost:3000)` prints a session ID such as `k3f9`
2. `chrome-cli snapshot -s $s` prints the accessibility tree with uids
3. `chrome-cli click -s $s 'button "Save"' --wait-for Saved`
4. `chrome-cli screenshot -s $s` prints a path to `Read`
5. `chrome-cli console -s $s` and `chrome-cli network -s $s` show errors since launch
6. `chrome-cli kill -s $s`

## Commands

| Command       | Purpose                                         | Key flags                                                                                                     |
| ------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `launch`      | Start Chrome and print the session ID           | `[--url] [--headed]`                                                                                          |
| `kill`        | Close a browser                                 |                                                                                                               |
| `kill-all`    | Close every tracked browser                     | `[--include-orphans]`                                                                                         |
| `navigate`    | Load a URL, print `title — url`                 | `<url> [--timeout] [--init-script]`                                                                           |
| `back`        | Go back in history                              |                                                                                                               |
| `reload`      | Reload the page                                 | `[--ignore-cache]`                                                                                            |
| `snapshot`    | Accessibility tree with uids                    | `[--verbose] [--path]`                                                                                        |
| `screenshot`  | Save images and print paths                     | `[--format] [--full-page] [--quality] [--path] [--viewport list] [--color-scheme list]`                       |
| `text`        | Visible text of `main`, `body`, or an element   | `[target] [--max]`                                                                                            |
| `eval`        | Run JavaScript and print the value              | `<expression> [--args uid,…]`                                                                                 |
| `click`       | Click an element                                | `<target> [--dbl-click]`                                                                                      |
| `fill`        | Set a text input, select option, or checkbox    | `<target> <value>`                                                                                            |
| `fill-form`   | Fill fields by label                            | `'Label=value' … [--submit target]`                                                                           |
| `press`       | Press a key                                     | `<key>`                                                                                                       |
| `hover`       | Hover an element                                | `<target>`                                                                                                    |
| `drag`        | Drag one element onto another                   | `<from> <to>`                                                                                                 |
| `scroll`      | Scroll and print `scrollY <y> / <height>`       | `[top \| bottom \| target] [--by px]`                                                                         |
| `wait`        | Wait for any of the texts                       | `<text>… [--timeout]`                                                                                         |
| `emulate`     | Emulate device, color scheme, location, network | `[--viewport] [--device-scale-factor] [--color-scheme] [--user-agent] [--geolocation] [--cpu-throttling] [--network-conditions]` |
| `console`     | Deduplicated errors and warnings since launch   | `[--all]`                                                                                                     |
| `network`     | Failed requests since launch                    | `[--all]`                                                                                                     |
| `pages`       | List tabs, `*` marks the selected one           |                                                                                                               |
| `new-page`    | Open and select a tab                           | `<url> [--background] [--isolated-context]`                                                                   |
| `oneshot`     | Launch, capture, and close                      | `snapshot\|screenshot <url>` plus snapshot and screenshot flags                                               |
| `daemon-*`    | `daemon-start`, `daemon-status`, `daemon-stop`  |                                                                                                               |

## Key Rules

- Pass `-s <id>` for a launched browser or `--port <port>` for an external Chrome.
- Targets are a uid from `snapshot` or a role and name such as `'button "Save"'`.
- Ambiguous targets fail with every matching uid, so pass one of them.
- Actions wait for navigation, network idle, and a quiet DOM.
- `--no-wait` returns right after the action.
- Add `--wait-for <text>`, `--snapshot`, or `--screenshot` to any action instead of a follow-up command.
- Dialogs are accepted automatically and their text appears in the action output.
- `navigate` retries refused connections until `--timeout`, so start the dev server and navigate without polling.
- `--viewport` takes `mobile` (390x844, touch), `desktop` (1440x900), or `WxH`.
- `screenshot` writes to `$TMPDIR/chrome-cli/<session>/` unless `--path` is set.
- Add `--json` before the command for machine-readable output.
- On Linux, `kill-all --include-orphans` stops every chrome-cli daemon and browser of the current user, including other agents' sessions.
