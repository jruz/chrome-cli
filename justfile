setup:
    just deps-install

check:
    #!/usr/bin/env nu
    ^just sandbox-check
    ^just ts-check
    ^just ts-lint
    ^just woodpecker-check

sandbox-check:
    sandbox bun scripts/sandbox-check.ts

woodpecker-check:
    woodpecker-cli lint \
        --strict \
        .woodpecker/

install:
    #!/usr/bin/env nu
    let running = (^chrome-cli daemon-status
        | from json
        | get running)
    if $running {
        print $"(ansi red)ERROR: daemon is running(ansi reset)"
        print "stop it first with: chrome-cli daemon-stop"
        exit 1
    }
    ^just chrome-build
    ^just chrome-install

chrome-run *ARGS:
    sandbox bun run cli.ts {{ARGS}}

chrome-launch:
    sandbox bun run cli.ts launch

chrome-launch-headed:
    sandbox bun run cli.ts launch --headed

chrome-build:
    #!/usr/bin/env nu
    if ($env.REVISION? | is-empty) {
        error make {msg: "ERROR: REVISION is not set"}
    }
    let bt = (date now | format date "%Y-%m-%d %H:%M:%S UTC")
    (^sandbox bun build cli.ts
        --compile
        --outfile dist/chrome-cli
        --define $"process.env.REVISION='($env.REVISION)'"
        --define $"process.env.BUILD_TIME='($bt)'")

chrome-install:
    mkdir -p ~/.local/bin
    cp dist/chrome-cli ~/.local/bin/chrome-cli

chrome-bench:
    sandbox bun run bench.ts

ts-check:
    sandbox bun run tsc --noEmit

ts-lint:
    sandbox bun run eslint .

fix:
    just ts-fix

ts-fix:
    sandbox bun run eslint --fix .

ts-test:
    sandbox bun test

deps-install:
    sandbox bun install

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
        --define $"process.env.REVISION='($env.REVISION)'"
        --define $"process.env.BUILD_TIME='($bt)'")

release-bump VERSION:
    nu scripts/release-bump.nu {{ VERSION }}

release-upload TAG:
    sandbox bun scripts/release-upload.ts {{ TAG }}

release-delete TAG:
    sandbox bun scripts/release-delete.ts {{ TAG }}
