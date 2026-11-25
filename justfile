mod ts '.just/ts.justfile'
mod bun '.just/bun.justfile'
mod tools '.just/tools.just'

setup:
    just ts::install

check:
    just ts::check

fix:
    just ts::fix

test:
    just ts::test
    just bun::test
    just chrome-test

install:
    just chrome-daemon-check
    just chrome-build
    just chrome-install

chrome-daemon-check:
    #!/usr/bin/env nu
    use std/log
    let binary = ("~/.local/bin/chrome-cli" | path expand)
    if not ($binary | path exists) { exit 0 }
    let running = (^$binary daemon-status | from json | get running)
    if not $running { exit 0 }
    log error "daemon is running; stop it with chrome-cli daemon-stop"
    exit 1

chrome-run *ARGS:
    sandbox bun run cli.ts {{ ARGS }}

chrome-launch:
    sandbox bun run cli.ts launch

chrome-launch-headed:
    sandbox bun run cli.ts launch --headed

chrome-build:
    #!/usr/bin/env nu
    (^sandbox --mount type=bind,src=/nix/store,dst=/nix/store,readonly
        --env CHROME_CLI_NATIVE_BUN --env REVISION
        -- bun scripts/chrome-build.ts)

chrome-install:
    #!/usr/bin/env nu
    let bin = ("~/.local/bin" | path expand)
    mkdir $bin
    let staged = (^mktemp $"($bin)/.chrome-cli.XXXXXX" | str trim)
    ^install --mode=755 dist/chrome-cli $staged
    ^mv --no-target-directory $staged ($bin | path join chrome-cli)

chrome-bench:
    sandbox bun run bench.ts

chrome-test:
    sandbox \
        --network=none \
        --init \
        --env CHROME_PATH=/usr/local/bin/chromium-test \
        -- pnpm exec vitest run src/

ts-check:
    just ts::tsc-check

ts-lint:
    just ts::oxlint-check

ts-fix:
    just ts::fix

ts-test:
    just test

deps-install:
    just ts::install

release-build OS ARCH:
    #!/usr/bin/env nu
    if ($env.REVISION? | is-empty) {
        error make {msg: "ERROR: REVISION is not set"}
    }
    let name = (open package.json | get name)
    let target = "bun-{{ OS }}-{{ ARCH }}"
    let outfile = $"dist/($name)-{{ OS }}-{{ ARCH }}"
    let bt = (date now | format date "%Y-%m-%d %H:%M:%S UTC")
    mkdir dist
    (^sandbox bun build cli.ts
        --compile
        --target $target
        --outfile $outfile
        --define $"CHROME_CLI_BUILD_REVISION='($env.REVISION)'"
        --define $"process.env.BUILD_TIME='($bt)'")

release-bump VERSION:
    nu scripts/release-bump.nu {{ VERSION }}

release-upload TAG:
    sandbox bun scripts/release-upload.ts {{ TAG }}

release-delete TAG:
    sandbox bun scripts/release-delete.ts {{ TAG }}
