package cli

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/signal"

	"github.com/alecthomas/kong"

	"github.com/jruz/chrome-cli/internal/client"
	"github.com/jruz/chrome-cli/internal/output"
	"github.com/jruz/chrome-cli/internal/protocol"
	"github.com/jruz/chrome-cli/internal/rundir"
	"github.com/jruz/chrome-cli/internal/version"
)

type Env struct {
	Out        io.Writer
	Err        io.Writer
	RuntimeDir string
	Daemon     []string
}

type app struct {
	ctx     context.Context
	client  client.Client
	printer output.Printer
}

type root struct {
	Version kong.VersionFlag `help:"Print version, revision, and build time."`
	JSON    bool             `help:"Print results as JSON."`

	Launch       launchCmd       `cmd:"" help:"Launch an owned Chrome and print its session ID."`
	Kill         killCmd         `cmd:"" help:"Close a browser by session or port."`
	KillAll      killAllCmd      `cmd:"" name:"kill-all" help:"Close every browser the daemon tracks."`
	Navigate     navigateCmd     `cmd:"" help:"Load a URL and print the page title and URL."`
	Reload       reloadCmd       `cmd:"" help:"Reload the current page."`
	Back         backCmd         `cmd:"" help:"Go back one page in history."`
	Snapshot     snapshotCmd     `cmd:"" help:"Print the accessibility tree with element uids."`
	Screenshot   screenshotCmd   `cmd:"" help:"Save screenshots and print their paths."`
	Eval         evalCmd         `cmd:"" help:"Evaluate JavaScript in the page and print the value."`
	Emulate      emulateCmd      `cmd:"" help:"Emulate a device, color scheme, location, or network."`
	Click        clickCmd        `cmd:"" help:"Click an element and wait for the page to settle."`
	Fill         fillCmd         `cmd:"" help:"Replace an input's value, pick an option, or set a checkbox."`
	FillForm     fillFormCmd     `cmd:"" name:"fill-form" help:"Fill fields by label and optionally submit."`
	Press        pressCmd        `cmd:"" help:"Press a key in the focused element."`
	Hover        hoverCmd        `cmd:"" help:"Move the mouse over an element."`
	Drag         dragCmd         `cmd:"" help:"Drag one element onto another."`
	Scroll       scrollCmd       `cmd:"" help:"Scroll the page and print the scroll position."`
	Wait         waitCmd         `cmd:"" help:"Wait until any of the texts appears."`
	Oneshot      oneshotCmd      `cmd:"" help:"Launch, load a URL, capture a snapshot or screenshot, and close."`
	DaemonStart  daemonStartCmd  `cmd:"" name:"daemon-start" help:"Start the background daemon."`
	DaemonStatus daemonStatusCmd `cmd:"" name:"daemon-status" help:"Show the daemon and its sessions."`
	DaemonStop   daemonStopCmd   `cmd:"" name:"daemon-stop" help:"Close every browser and stop the daemon."`
	DaemonServe  daemonServeCmd  `cmd:"" name:"daemon-serve" hidden:"" help:"Run the daemon in the foreground."`
}

type target struct {
	Session string `short:"s" xor:"target" required:"" help:"Session ID printed by launch."`
	Port    int    `xor:"target" required:"" help:"Remote debugging port of an external Chrome."`
}

func (t target) protocol() *protocol.Target {
	return &protocol.Target{Session: t.Session, Port: t.Port}
}

func DefaultEnv() (Env, error) {
	executable, err := os.Executable()
	if err != nil {
		return Env{}, fmt.Errorf("locate chrome-cli executable: %w", err)
	}
	dir := rundir.Default()
	return Env{
		Out:        os.Stdout,
		Err:        os.Stderr,
		RuntimeDir: dir,
		Daemon:     []string{executable, "daemon-serve", "--runtime-dir", dir},
	}, nil
}

func Main(args []string, env Env) int {
	var commands root
	parser, err := kong.New(
		&commands,
		kong.Name("chrome-cli"),
		kong.Description("Control Chrome via CDP from parallel agents."),
		kong.Vars{"version": version.Current().String()},
		kong.Writers(env.Out, env.Err),
	)
	if err != nil {
		return fail(env, err)
	}
	selected, err := parser.Parse(args)
	if err != nil {
		return fail(env, err)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	current := &app{
		ctx:     ctx,
		client:  client.New(env.RuntimeDir, env.Daemon),
		printer: output.Printer{Out: env.Out, JSON: commands.JSON},
	}
	if err := selected.Run(current); err != nil {
		return fail(env, err)
	}
	return 0
}

func fail(env Env, err error) int {
	output.Error(env.Err, err)
	return 1
}
