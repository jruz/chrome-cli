package cli

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/signal"

	"github.com/alecthomas/kong"

	"github.com/jruz/chrome-cli/internal/client"
	"github.com/jruz/chrome-cli/internal/protocol"
	"github.com/jruz/chrome-cli/internal/rundir"
	"github.com/jruz/chrome-cli/internal/version"
)

type app struct {
	ctx    context.Context
	client client.Client
	out    io.Writer
}

type root struct {
	Version kong.VersionFlag `help:"Print version, revision, and build time."`

	Launch       launchCmd       `cmd:"" help:"Launch an owned Chrome and print its session ID."`
	Kill         killCmd         `cmd:"" help:"Close a browser by session or port."`
	KillAll      killAllCmd      `cmd:"" name:"kill-all" help:"Close every browser the daemon tracks."`
	DaemonStart  daemonStartCmd  `cmd:"" name:"daemon-start" help:"Start the background daemon."`
	DaemonStatus daemonStatusCmd `cmd:"" name:"daemon-status" help:"Show the daemon and its sessions."`
	DaemonStop   daemonStopCmd   `cmd:"" name:"daemon-stop" help:"Close every browser and stop the daemon."`
	DaemonServe  daemonServeCmd  `cmd:"" name:"daemon-serve" hidden:"" help:"Run the daemon in the foreground."`
}

type target struct {
	Session string `short:"s" xor:"target" required:"" help:"Session ID printed by launch."`
	Port    int    `xor:"target" required:"" help:"Remote debugging port of an external Chrome."`
}

func (t target) protocol() protocol.Target {
	return protocol.Target{Session: t.Session, Port: t.Port}
}

func Run(args []string) int {
	var commands root
	parser, err := kong.New(
		&commands,
		kong.Name("chrome-cli"),
		kong.Description("Control Chrome via CDP from parallel agents."),
		kong.Vars{"version": version.Current().String()},
	)
	if err != nil {
		return fail(err)
	}
	selected, err := parser.Parse(args)
	if err != nil {
		return fail(err)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	current, err := newApp(ctx)
	if err != nil {
		return fail(err)
	}
	if err := selected.Run(current); err != nil {
		return fail(err)
	}
	return 0
}

func newApp(ctx context.Context) (*app, error) {
	executable, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("locate chrome-cli executable: %w", err)
	}
	dir := rundir.Default()
	daemon := []string{executable, "daemon-serve", "--runtime-dir", dir}
	return &app{ctx: ctx, client: client.New(dir, daemon), out: os.Stdout}, nil
}

func fail(err error) int {
	fmt.Fprintf(os.Stderr, "error: %s\n", err)
	return 1
}
