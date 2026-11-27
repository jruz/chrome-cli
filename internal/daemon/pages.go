package daemon

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"

	"github.com/jruz/chrome-cli/internal/commands"
	"github.com/jruz/chrome-cli/internal/page"
	"github.com/jruz/chrome-cli/internal/protocol"
	"github.com/jruz/chrome-cli/internal/recorder"
)

func onPage[P, R any](run func(context.Context, *page.Page, P) (R, error)) func(context.Context, session, P) (R, error) {
	return func(ctx context.Context, current session, params P) (R, error) {
		return run(ctx, current.page, params)
	}
}

func onRecorder[P, R any](run func(*recorder.Recorder, P) (R, error)) func(context.Context, session, P) (R, error) {
	return func(_ context.Context, current session, params P) (R, error) {
		return run(current.recorder, params)
	}
}

func (d daemon) newPage(ctx context.Context, current session, params protocol.NewPageParams) (protocol.Navigated, error) {
	contextID, err := d.browserContext(ctx, current, params.IsolatedContext)
	if err != nil {
		return protocol.Navigated{}, err
	}
	opened, err := current.page.Open(ctx, params.Background, contextID, d.reportPageError)
	if err != nil {
		return protocol.Navigated{}, err
	}
	selected := d.record(opened)
	key := current.target.Key()
	ask(d.store, func(reply chan struct{}) event { return pageSelected{key: key, selected: selected, reply: reply} })
	return commands.Navigate(ctx, opened, protocol.NavigateParams{URL: params.URL, Timeout: params.Timeout})
}

func (d daemon) browserContext(ctx context.Context, current session, name string) (string, error) {
	if name == "" {
		return "", nil
	}
	if id, found := current.contexts[name]; found {
		return id, nil
	}
	id, err := current.page.CreateContext(ctx)
	if err != nil {
		return "", err
	}
	key := current.target.Key()
	ask(d.store, func(reply chan struct{}) event { return contextCreated{key: key, name: name, id: id, reply: reply} })
	return id, nil
}

func (d daemon) screenshot(ctx context.Context, current session, params protocol.ScreenshotParams) (protocol.Screenshots, error) {
	auto := d.autoPath(current.target)
	return commands.Screenshot(ctx, current.page, params, current.emulation, auto)
}

func (d daemon) emulate(ctx context.Context, current session, params protocol.EmulateParams) (protocol.Emulated, error) {
	next, emulated, err := commands.Emulate(ctx, current.page, params, current.emulation)
	key := current.target.Key()
	ask(d.store, func(reply chan struct{}) event { return emulationChanged{key: key, emulation: next, reply: reply} })
	return emulated, err
}

func (d daemon) oneshot(ctx context.Context, params protocol.OneshotParams) (protocol.Oneshot, error) {
	launched, err := d.launchSession(ctx, true)
	if err != nil {
		return protocol.Oneshot{}, err
	}
	result, err := tracked(d, launched.target, func() (protocol.Oneshot, error) {
		return commands.Oneshot(ctx, launched.page, params, d.autoPath(launched.target))
	})
	return result, errors.Join(err, d.closeSession(ctx, launched))
}

func (d daemon) autoPath(target protocol.Target) string {
	key := target.Key()
	number := ask(d.store, func(reply chan int) event { return shotNumbered{key: key, reply: reply} })
	return filepath.Join(os.TempDir(), "chrome-cli", target.Directory(), strconv.Itoa(number))
}
