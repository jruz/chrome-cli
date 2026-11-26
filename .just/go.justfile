set working-directory := '..'

packages := './cmd/... ./internal/...'

check:
    just go::fmt-check
    just go::vet-check
    just go::staticcheck-check

test:
    sandbox go test {{ packages }}

fmt-check:
    #!/usr/bin/env nu
    use std/log
    let unformatted = (^sandbox gofmt -l cmd internal | str trim)
    if ($unformatted | is-empty) { exit 0 }
    log error $"unformatted files:\n($unformatted)"
    exit 1

fmt-fix:
    sandbox gofmt -w cmd internal

vet-check:
    sandbox go vet {{ packages }}

staticcheck-check:
    sandbox go tool staticcheck {{ packages }}
