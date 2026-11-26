package daemon

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"time"

	"github.com/jruz/chrome-cli/internal/browser"
	"github.com/jruz/chrome-cli/internal/protocol"
)

const closeTimeout = 10 * time.Second

type daemon struct {
	store    store
	log      *slog.Logger
	stop     chan struct{}
	stopOnce *sync.Once
}

func (d daemon) launch(ctx context.Context, params protocol.LaunchParams) (protocol.Launched, error) {
	if err := ask(d.store, func(reply chan error) event { return launchReserved{reply: reply} }); err != nil {
		return protocol.Launched{}, err
	}
	owned, err := browser.Launch(ctx, params.Headless)
	if err != nil {
		ask(d.store, func(reply chan struct{}) event { return launchFailed{reply: reply} })
		return protocol.Launched{}, err
	}
	id := ask(d.store, func(reply chan string) event { return launchConfirmed{owned: owned, reply: reply} })
	go d.watch(id, owned)
	d.log.Info("launched", "session", id, "pid", owned.Pid)
	return protocol.Launched{Session: id}, nil
}

func (d daemon) watch(id string, owned *browser.Owned) {
	<-owned.Exited()
	d.removeSession(id)
	d.log.Info("browser exited", "session", id, "pid", owned.Pid)
}

func (d daemon) kill(ctx context.Context, params protocol.KillParams) (protocol.Killed, error) {
	if err := d.killTarget(ctx, params.Target); err != nil {
		return protocol.Killed{}, err
	}
	return protocol.Killed{Killed: []protocol.Target{params.Target}}, nil
}

func (d daemon) killAll(ctx context.Context, _ struct{}) (protocol.Killed, error) {
	targets := ask(d.store, func(reply chan []protocol.Target) event { return targetsQueried{reply: reply} })
	return protocol.Killed{Killed: targets}, d.killEach(ctx, targets)
}

func (d daemon) status(_ context.Context, _ struct{}) (protocol.Status, error) {
	status := ask(d.store, func(reply chan protocol.Status) event { return statusQueried{reply: reply} })
	status.Pid = os.Getpid()
	return status, nil
}

func (d daemon) shutdown(ctx context.Context, _ struct{}) (protocol.Killed, error) {
	killed, err := d.killAll(ctx, struct{}{})
	d.requestStop()
	return killed, err
}

func (d daemon) reap(ctx context.Context) {
	targets := ask(d.store, func(reply chan []protocol.Target) event { return idleQueried{reply: reply} })
	if len(targets) == 0 {
		return
	}
	if err := d.killEach(ctx, targets); err != nil {
		d.log.Error("idle reaping failed", "error", err)
		return
	}
	d.log.Info("reaped idle browsers", "targets", targets)
}

func (d daemon) track(key string, run func() (any, error)) (any, error) {
	ask(d.store, func(reply chan struct{}) event { return commandStarted{key: key, reply: reply} })
	defer ask(d.store, func(reply chan struct{}) event { return commandFinished{key: key, reply: reply} })
	return run()
}

func (d daemon) requestStop() {
	d.stopOnce.Do(func() { close(d.stop) })
}

func (d daemon) killEach(ctx context.Context, targets []protocol.Target) error {
	errs := make([]error, len(targets))
	var group sync.WaitGroup
	for index, target := range targets {
		group.Go(func() { errs[index] = d.killTarget(ctx, target) })
	}
	group.Wait()
	return errors.Join(errs...)
}

func (d daemon) killTarget(ctx context.Context, target protocol.Target) error {
	if target.Session != "" {
		return d.killSession(ctx, target.Session)
	}
	return d.killPort(ctx, target.Port)
}

func (d daemon) killSession(ctx context.Context, id string) error {
	owned := ask(d.store, func(reply chan *browser.Owned) event { return sessionLookedUp{id: id, reply: reply} })
	if owned == nil {
		return fmt.Errorf("session %s not found (run chrome-cli launch)", id)
	}
	if err := d.closeOwned(ctx, id, owned); err != nil {
		return err
	}
	d.removeSession(id)
	return nil
}

func (d daemon) closeOwned(ctx context.Context, id string, owned *browser.Owned) error {
	closing, cancel := context.WithTimeout(ctx, closeTimeout)
	defer cancel()
	err := owned.Close(closing)
	if err == nil {
		return nil
	}
	d.log.Warn("close failed, killing browser", "session", id, "pid", owned.Pid, "error", err)
	return owned.Kill()
}

func (d daemon) killPort(ctx context.Context, port int) error {
	external, err := d.external(ctx, port)
	if err != nil {
		return err
	}
	closing, cancel := context.WithTimeout(ctx, closeTimeout)
	defer cancel()
	if err := external.Close(closing); err != nil {
		return err
	}
	ask(d.store, func(reply chan struct{}) event { return externalRemoved{port: port, reply: reply} })
	return nil
}

func (d daemon) external(ctx context.Context, port int) (*browser.External, error) {
	registered := ask(d.store, func(reply chan *browser.External) event { return externalLookedUp{port: port, reply: reply} })
	if registered != nil {
		return registered, nil
	}
	return browser.Connect(ctx, port)
}

func (d daemon) removeSession(id string) {
	ask(d.store, func(reply chan struct{}) event { return sessionRemoved{id: id, reply: reply} })
}
