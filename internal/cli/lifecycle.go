package cli

import (
	"errors"
	"fmt"
	"time"

	"github.com/jruz/chrome-cli/internal/daemon"
	"github.com/jruz/chrome-cli/internal/orphans"
	"github.com/jruz/chrome-cli/internal/protocol"
)

type launchCmd struct {
	Headed bool `help:"Show the browser window."`
}

func (c launchCmd) Run(a *app) error {
	var launched protocol.Launched
	params := protocol.LaunchParams{Headless: !c.Headed}
	if err := a.client.Send(a.ctx, protocol.ActionLaunch, params, &launched); err != nil {
		return err
	}
	_, err := fmt.Fprintln(a.out, launched.Session)
	return err
}

type killCmd struct {
	target `embed:""`
}

func (c killCmd) Run(a *app) error {
	var killed protocol.Killed
	params := protocol.KillParams{Target: c.protocol()}
	if err := a.client.Send(a.ctx, protocol.ActionKill, params, &killed); err != nil {
		return err
	}
	return printKilled(a, killed)
}

type killAllCmd struct {
	IncludeOrphans bool `help:"Also stop every chrome-cli daemon and orphaned browser (Linux)."`
}

func (c killAllCmd) Run(a *app) error {
	if c.IncludeOrphans {
		return stopOrphans(a)
	}
	var killed protocol.Killed
	if err := a.client.Send(a.ctx, protocol.ActionKillAll, nil, &killed); err != nil {
		return err
	}
	return printKilled(a, killed)
}

func stopOrphans(a *app) error {
	stopped, err := orphans.Stop()
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(a.out, "stopped daemons %v browsers %v\n", stopped.Daemons, stopped.Browsers)
	return err
}

type daemonStartCmd struct{}

func (daemonStartCmd) Run(a *app) error {
	started, err := a.client.Start(a.ctx)
	if err != nil {
		return err
	}
	status, _, err := a.client.Status(a.ctx)
	if err != nil {
		return err
	}
	if started {
		_, err = fmt.Fprintf(a.out, "started daemon %d\n", status.Pid)
		return err
	}
	_, err = fmt.Fprintf(a.out, "daemon already running %d\n", status.Pid)
	return err
}

type daemonStatusCmd struct{}

func (daemonStatusCmd) Run(a *app) error {
	status, running, err := a.client.Status(a.ctx)
	if err != nil {
		return err
	}
	if !running {
		_, err = fmt.Fprintln(a.out, "daemon not running")
		return err
	}
	return printStatus(a, status)
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
	if err := printKilled(a, killed); err != nil {
		return err
	}
	_, err = fmt.Fprintln(a.out, "stopped daemon")
	return err
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

func printKilled(a *app, killed protocol.Killed) error {
	for _, target := range killed.Killed {
		if _, err := fmt.Fprintf(a.out, "killed %s\n", target.Key()); err != nil {
			return err
		}
	}
	return nil
}

func printStatus(a *app, status protocol.Status) error {
	if _, err := fmt.Fprintf(a.out, "daemon running %d\n", status.Pid); err != nil {
		return err
	}
	for _, session := range status.Sessions {
		if _, err := fmt.Fprintf(a.out, "session %s pid %d\n", session.ID, session.Pid); err != nil {
			return err
		}
	}
	for _, port := range status.Ports {
		if _, err := fmt.Fprintf(a.out, "port %d\n", port); err != nil {
			return err
		}
	}
	return nil
}
