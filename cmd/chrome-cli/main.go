package main

import (
	"github.com/alecthomas/kong"

	"github.com/jruz/chrome-cli/internal/version"
)

type cli struct {
	Version kong.VersionFlag `help:"Print version, revision, and build time."`
}

func main() {
	kong.Parse(
		&cli{},
		kong.Name("chrome-cli"),
		kong.Description("Control Chrome via CDP from parallel agents."),
		kong.Vars{"version": version.Current().String()},
	)
}
