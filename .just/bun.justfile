set working-directory := '..'

check:
    just bun::test

test:
    sandbox bun test ./scripts ./src/daemon-startup.bun.test.ts
