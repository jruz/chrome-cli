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
	"github.com/jruz/chrome-cli/internal/commands"
	"github.com/jruz/chrome-cli/internal/page"
	"github.com/jruz/chrome-cli/internal/protocol"
)

const (
	closeTimeout  = 10 * time.Second
	launchTimeout = 15 * time.Second
)

type daemon struct {
	store    store
	log      *slog.Logger
	stop     chan struct{}
	stopOnce *sync.Once
}

func (d daemon) launch(ctx context.Context, params protocol.LaunchParams) (protocol.Launched, error) {
	launched, err := d.launchSession(ctx, params.Headless)
	if err != nil || params.URL == "" {
		return protocol.Launched{Session: launched.target.Session}, err
	}
	navigation := protocol.NavigateParams{URL: params.URL, Timeout: params.Timeout}
	navigated, err := tracked(d, launched.target, func() (protocol.Navigated, error) {
		return commands.Navigate(ctx, launched.page, navigation)
	})
	if err != nil {
		return protocol.Launched{}, errors.Join(err, d.killTarget(ctx, launched.target))
	}
	return protocol.Launched{Session: launched.target.Session, Navigated: &navigated}, nil
}

func (d daemon) launchSession(ctx context.Context, headless bool) (session, error) {
	if err := ask(d.store, func(reply chan error) event { return launchReserved{reply: reply} }); err != nil {
		return session{}, err
	}
	starting, cancel := context.WithTimeout(ctx, launchTimeout)
	defer cancel()
	owned, first, err := d.startBrowser(starting, headless)
	if err != nil {
		ask(d.store, func(reply chan struct{}) event { return launchFailed{reply: reply} })
		return session{}, err
	}
	launched := ask(d.store, func(reply chan session) event { return launchConfirmed{owned: owned, page: first, reply: reply} })
	go d.watch(launched.target, owned)
	d.log.Info("launched", "session", launched.target.Session, "pid", owned.Pid)
	return launched, nil
}

func (d daemon) startBrowser(ctx context.Context, headless bool) (*browser.Owned, *page.Page, error) {
	owned, err := browser.Launch(ctx, headless)
	if err != nil {
		return nil, nil, err
	}
	first, err := page.First(ctx, owned.Conn, d.reportPageError)
	if err != nil {
		return nil, nil, errors.Join(err, owned.Kill())
	}
	return owned, first, nil
}

func (d daemon) watch(target protocol.Target, owned *browser.Owned) {
	<-owned.Exited()
	d.remove(target)
	d.log.Info("browser exited", "session", target.Session, "pid", owned.Pid)
}

func (d daemon) resolve(ctx context.Context, target protocol.Target) (session, error) {
	found := ask(d.store, func(reply chan lookup) event { return sessionLookedUp{key: target.Key(), reply: reply} })
	if found.found && !closed(found.session) {
		return found.session, nil
	}
	if found.found {
		d.remove(target)
	}
	if target.Session != "" {
		return session{}, fmt.Errorf("session %s not found (run chrome-cli launch)", target.Session)
	}
	return d.connect(ctx, target)
}

func closed(current session) bool {
	select {
	case <-current.page.Done():
		return true
	default:
		return false
	}
}

func (d daemon) connect(ctx context.Context, target protocol.Target) (session, error) {
	external, err := browser.Connect(ctx, target.Port)
	if err != nil {
		return session{}, err
	}
	first, err := page.First(ctx, external.Conn, d.reportPageError)
	if err != nil {
		return session{}, errors.Join(err, external.Disconnect())
	}
	candidate := session{target: target, external: external, page: first}
	registered := ask(d.store, func(reply chan session) event { return externalRegistered{candidate: candidate, reply: reply} })
	if registered.external != external {
		return registered, external.Disconnect()
	}
	return registered, nil
}

func (d daemon) kill(ctx context.Context, current session, _ struct{}) (protocol.Killed, error) {
	if err := d.closeSession(ctx, current); err != nil {
		return protocol.Killed{}, err
	}
	return protocol.Killed{Killed: []protocol.Target{current.target}}, nil
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
	current, err := d.resolve(ctx, target)
	if err != nil {
		return err
	}
	return d.closeSession(ctx, current)
}

func (d daemon) closeSession(ctx context.Context, current session) error {
	closing, cancel := context.WithTimeout(ctx, closeTimeout)
	defer cancel()
	if err := d.closeBrowser(closing, current); err != nil {
		return err
	}
	d.remove(current.target)
	return nil
}

func (d daemon) closeBrowser(ctx context.Context, current session) error {
	if current.owned == nil {
		return current.external.Close(ctx)
	}
	err := current.owned.Close(ctx)
	if err == nil {
		return nil
	}
	d.log.Warn("close failed, killing browser", "session", current.target.Session, "pid", current.owned.Pid, "error", err)
	return current.owned.Kill()
}

func (d daemon) reportPageError(err error) {
	d.log.Error("page event handling failed", "error", err)
}

func (d daemon) remove(target protocol.Target) {
	ask(d.store, func(reply chan struct{}) event { return sessionRemoved{key: target.Key(), reply: reply} })
}

func tracked[R any](d daemon, target protocol.Target, run func() (R, error)) (R, error) {
	key := target.Key()
	ask(d.store, func(reply chan struct{}) event { return commandStarted{key: key, reply: reply} })
	defer ask(d.store, func(reply chan struct{}) event { return commandFinished{key: key, reply: reply} })
	return run()
}
