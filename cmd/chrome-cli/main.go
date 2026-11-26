package main

import (
	"os"

	"github.com/jruz/chrome-cli/internal/cli"
	"github.com/jruz/chrome-cli/internal/output"
)

func main() {
	env, err := cli.DefaultEnv()
	if err != nil {
		output.Error(os.Stderr, err)
		os.Exit(1)
	}
	os.Exit(cli.Main(os.Args[1:], env))
}
