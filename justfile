set shell := ["nu", "-c"]

chrome-run *args:
    bun run cli.ts {{args}}

chrome-launch:
    bun run cli.ts launch

chrome-launch-headed:
    bun run cli.ts launch --headed

ts-check:
    bun run tsc --noEmit

ts-lint:
    bun run eslint .

ts-test:
    bun test

deps-install:
    bun install

chrome-build:
    bun build cli.ts --compile --outfile dist/chrome-cli

chrome-install:
    just chrome-build
    mkdir -p ~/.local/bin
    cp dist/chrome-cli ~/.local/bin/chrome-cli

chrome-bench:
    bun run bench.ts

check:
    just ts-check
    just ts-lint
