check:
    just ts-check
    just ts-lint

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
    bun build cli.ts --compile --outfile dist/chrome-cli

chrome-install:
    mkdir -p ~/.local/bin
    cp dist/chrome-cli ~/.local/bin/chrome-cli

chrome-bench:
    bun run bench.ts

ts-check:
    bun run tsc --noEmit

ts-lint:
    bun run eslint .

ts-test:
    bun test

deps-install:
    bun install
