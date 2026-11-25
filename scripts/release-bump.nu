use std/log

def bump-package-json [version: string]: nothing -> nothing {
    let pkg = (open package.json)
    $pkg | upsert version $version | save --force package.json
}

def main [version: string]: nothing -> nothing {
    if ($version !~ '^\d+\.\d+\.\d+$') {
        log error $"invalid version format: ($version) \(expected 0.0.0\)"
        exit 1
    }

    let current = (open package.json | get version)
    bump-package-json $version
    ^git add -- package.json
    ^git commit --message $"[tool] Version: Bump to ($version)"
    log info $"Bumped ($current) -> ($version)"
}
