use lib/targets.nu [TARGETS]

const NAME = 'chrome-cli'
const PACKAGE = 'github.com/jruz/chrome-cli/internal/version'

def ldflags []: nothing -> string {
    let version = (open release.json | get version)
    let build_time = (date now
        | date to-timezone UTC
        | format date '%Y-%m-%dT%H:%M:%SZ')
    [
        $"-X ($PACKAGE).version=($version)"
        $"-X ($PACKAGE).revision=($env.REVISION)"
        $"-X ($PACKAGE).buildTime=($build_time)"
    ] | str join ' '
}

def build [goos: string, goarch: string, output: path]: nothing -> nothing {
    mkdir ($output | path dirname)
    (^sandbox
        --env CGO_ENABLED=0
        --env $"GOOS=($goos)"
        --env $"GOARCH=($goarch)"
        --
        go build
        -trimpath
        -ldflags (ldflags)
        -o $output
        ./cmd/chrome-cli)
}

def host-system []: nothing -> string {
    let os = if $nu.os-info.name == 'macos' { 'darwin' } else { $nu.os-info.name }
    $"($nu.os-info.arch)-($os)"
}

# Build a static binary for this machine in dist/
def "main host" []: nothing -> nothing {
    let system = (host-system)
    let target = ($TARGETS | where system == $system | first)
    build $target.goos $target.goarch $"dist/($NAME)"
}

# Cross-compile every release binary into dist/
def "main all" []: nothing -> nothing {
    for target in $TARGETS {
        build $target.goos $target.goarch $"dist/($NAME)-($target.goos)-($target.goarch)"
    }
}

def main []: nothing -> string {
    help main
}
