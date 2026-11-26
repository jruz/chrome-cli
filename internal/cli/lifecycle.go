package cli

import (
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/jruz/chrome-cli/internal/daemon"
	"github.com/jruz/chrome-cli/internal/orphans"
	"github.com/jruz/chrome-cli/internal/protocol"
)

type launchCmd struct {
	Headed  bool          `help:"Show the browser window."`
	URL     string        `help:"Load this URL after launching."`
	Timeout time.Duration `default:"10s" help:"How long to wait for --url to load."`
}

func (c launchCmd) Run(a *app) error {
	var launched protocol.Launched
	params := protocol.LaunchParams{Headless: !c.Headed, URL: c.URL, Timeout: c.Timeout}
	if err := a.client.Send(a.ctx, protocol.ActionLaunch, nil, params, &launched); err != nil {
		return err
	}
	return a.printer.Print(launched, launched.Session)
}

type killCmd struct {
	target `embed:""`
}

func (c killCmd) Run(a *app) error {
	var killed protocol.Killed
	if err := a.client.Send(a.ctx, protocol.ActionKill, c.protocol(), nil, &killed); err != nil {
		return err
	}
	return a.printer.Print(killed, killedLines(killed)...)
}

type killAllCmd struct {
	IncludeOrphans bool `help:"Also stop every chrome-cli daemon and orphaned browser (Linux)."`
}

func (c killAllCmd) Run(a *app) error {
	if c.IncludeOrphans {
		return stopOrphans(a)
	}
	var killed protocol.Killed
	if err := a.client.Send(a.ctx, protocol.ActionKillAll, nil, nil, &killed); err != nil {
		return err
	}
	return a.printer.Print(killed, killedLines(killed)...)
}

func stopOrphans(a *app) error {
	stopped, err := orphans.Stop()
	if err != nil {
		return err
	}
	return a.printer.Print(stopped, fmt.Sprintf("stopped daemons %v browsers %v", stopped.Daemons, stopped.Browsers))
}

type daemonStartCmd struct{}

type started struct {
	Started bool `json:"started"`
	Pid     int  `json:"pid"`
}

func (daemonStartCmd) Run(a *app) error {
	fresh, err := a.client.Start(a.ctx)
	if err != nil {
		return err
	}
	status, _, err := a.client.Status(a.ctx)
	if err != nil {
		return err
	}
	result := started{Started: fresh, Pid: status.Pid}
	if fresh {
		return a.printer.Print(result, fmt.Sprintf("started daemon %d", status.Pid))
	}
	return a.printer.Print(result, fmt.Sprintf("daemon already running %d", status.Pid))
}

type daemonStatusCmd struct{}

type daemonState struct {
	Running bool `json:"running"`
	protocol.Status
}

func (daemonStatusCmd) Run(a *app) error {
	status, running, err := a.client.Status(a.ctx)
	if err != nil {
		return err
	}
	if !running {
		return a.printer.Print(daemonState{Running: false}, "daemon not running")
	}
	return a.printer.Print(daemonState{Running: true, Status: status}, statusLines(status)...)
}

type daemonStopCmd struct{}

func (daemonStopCmd) Run(a *app) error {
	_, running, err := a.client.Status(a.ctx)
	if err != nil {
		return err
	}
	if !running {
		return errors.New("daemon is not running (start it with chrome-cli daemon-start)")
	}
	killed, err := a.client.Stop(a.ctx)
	if err != nil {
		return err
	}
	return a.printer.Print(killed, append(killedLines(killed), "stopped daemon")...)
}

type daemonServeCmd struct {
	RuntimeDir   string        `required:"" help:"Directory for the socket, lock, and log."`
	Limit        int           `default:"8" help:"Maximum owned browsers."`
	IdleTimeout  time.Duration `default:"30m" help:"Close owned browsers idle for this long."`
	ReapInterval time.Duration `default:"1m" help:"How often to look for idle browsers."`
}

func (c daemonServeCmd) Run() error {
	return daemon.Serve(daemon.Config{
		RuntimeDir:   c.RuntimeDir,
		Limit:        c.Limit,
		IdleTimeout:  c.IdleTimeout,
		ReapInterval: c.ReapInterval,
	})
}

func killedLines(killed protocol.Killed) []string {
	lines := make([]string, len(killed.Killed))
	for index, target := range killed.Killed {
		lines[index] = "killed " + target.Key()
	}
	return lines
}

func statusLines(status protocol.Status) []string {
	lines := []string{"daemon running " + strconv.Itoa(status.Pid)}
	for _, session := range status.Sessions {
		lines = append(lines, fmt.Sprintf("session %s pid %d", session.ID, session.Pid))
	}
	for _, port := range status.Ports {
		lines = append(lines, fmt.Sprintf("port %d", port))
	}
	return lines
}
