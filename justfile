mod tools '.just/tools.just'
mod go '.just/go.justfile'

export REVISION := env("REVISION", shell("git rev-parse --short HEAD"))

check:
    just go::check

fix:
    just go::fmt-fix

test:
    just go::test

install:
    just chrome-daemon-check
    just chrome-build
    just chrome-install

chrome-daemon-check:
    #!/usr/bin/env nu
    use std/log
    let binary = ("~/.local/bin/chrome-cli" | path expand)
    if not ($binary | path exists) { exit 0 }
    let running = (^$binary --json daemon-status | from json | get running)
    if not $running { exit 0 }
    log error "daemon is running; stop it with chrome-cli daemon-stop"
    exit 1

chrome-build:
    nu scripts/build.nu host

chrome-install:
    #!/usr/bin/env nu
    let bin = ("~/.local/bin" | path expand)
    mkdir $bin
    let staged = (^mktemp $"($bin)/.chrome-cli.XXXXXX" | str trim)
    ^install --mode=755 dist/chrome-cli $staged
    ^mv --no-target-directory $staged ($bin | path join chrome-cli)

chrome-run *ARGS:
    just chrome-build
    dist/chrome-cli {{ ARGS }}

release-build:
    nu scripts/build.nu all

release +ARGS:
    nu scripts/release.nu {{ ARGS }}
