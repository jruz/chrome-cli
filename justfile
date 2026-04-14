setup:
    just deps-install

check:
    just ts-check
    just ts-lint
    just woodpecker-check

woodpecker-check:
    woodpecker-cli lint \
        --strict \
        .woodpecker/

install:
    just chrome-build
    just chrome-install

chrome-run *ARGS:
    bun run cli.ts {{ARGS}}

chrome-launch:
    bun run cli.ts launch

chrome-launch-headed:
    bun run cli.ts launch --headed

chrome-build:
    #!/usr/bin/env nu
    if ($env.REVISION? | is-empty) {
        error make {msg: "ERROR: REVISION is not set"}
    }
    let bt = (date now | format date "%Y-%m-%d %H:%M:%S UTC")
    (^bun build cli.ts
        --compile
        --outfile dist/chrome-cli
        --define $"process.env.REVISION='($env.REVISION)'"
        --define $"process.env.BUILD_TIME='($bt)'")

chrome-install:
    mkdir -p ~/.local/bin
    cp dist/chrome-cli ~/.local/bin/chrome-cli

chrome-bench:
    bun run bench.ts

ts-check:
    bun run tsc --noEmit

ts-lint:
    bun run eslint .

fix:
    just ts-fix

ts-fix:
    bun run eslint --fix .

ts-test:
    bun test

deps-install:
    bun install

release VERSION:
    bun scripts/release.ts {{ VERSION }}

release-upload TAG:
    bun scripts/release-upload.ts {{ TAG }}

release-delete TAG:
    bun scripts/release-delete.ts {{ TAG }}
