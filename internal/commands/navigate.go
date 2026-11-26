package commands

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jruz/chrome-cli/internal/page"
	"github.com/jruz/chrome-cli/internal/protocol"
)

const (
	refusedError  = "net::ERR_CONNECTION_REFUSED"
	retryInterval = 250 * time.Millisecond
)

type navigation struct {
	FrameID   string `json:"frameId"`
	LoaderID  string `json:"loaderId"`
	ErrorText string `json:"errorText"`
}

type history struct {
	CurrentIndex int `json:"currentIndex"`
	Entries      []struct {
		ID int `json:"id"`
	} `json:"entries"`
}

func Navigate(ctx context.Context, p *page.Page, params protocol.NavigateParams) (protocol.Navigated, error) {
	deadline, cancel := context.WithTimeout(ctx, params.Timeout)
	defer cancel()
	if err := addInitScript(deadline, p, params.InitScript); err != nil {
		return protocol.Navigated{}, err
	}
	if err := navigateWithRetry(deadline, p, params.URL); err != nil {
		return protocol.Navigated{}, navigationError(err, params)
	}
	return Location(ctx, p)
}

func Reload(ctx context.Context, p *page.Page, params protocol.ReloadParams) (protocol.Navigated, error) {
	deadline, cancel := context.WithTimeout(ctx, params.Timeout)
	defer cancel()
	reload := func() error {
		return p.Call(deadline, "Page.reload", map[string]bool{"ignoreCache": params.IgnoreCache}, nil)
	}
	if err := waitAfter(deadline, p, reload); err != nil {
		return protocol.Navigated{}, fmt.Errorf("reload: %w", err)
	}
	return Location(ctx, p)
}

func Back(ctx context.Context, p *page.Page, params protocol.BackParams) (protocol.Navigated, error) {
	deadline, cancel := context.WithTimeout(ctx, params.Timeout)
	defer cancel()
	var entries history
	if err := p.Call(deadline, "Page.getNavigationHistory", nil, &entries); err != nil {
		return protocol.Navigated{}, err
	}
	if entries.CurrentIndex == 0 {
		return protocol.Navigated{}, errors.New("no previous page in history")
	}
	previous := entries.Entries[entries.CurrentIndex-1].ID
	back := func() error {
		return p.Call(deadline, "Page.navigateToHistoryEntry", map[string]int{"entryId": previous}, nil)
	}
	if err := waitAfter(deadline, p, back); err != nil {
		return protocol.Navigated{}, fmt.Errorf("back: %w", err)
	}
	return Location(ctx, p)
}

func Location(ctx context.Context, p *page.Page) (protocol.Navigated, error) {
	var location [2]string
	if err := p.EvaluateInto(ctx, "[document.title, location.href]", &location); err != nil {
		return protocol.Navigated{}, err
	}
	return protocol.Navigated{Title: location[0], URL: location[1]}, nil
}

func addInitScript(ctx context.Context, p *page.Page, script string) error {
	if script == "" {
		return nil
	}
	return p.Call(ctx, "Page.addScriptToEvaluateOnNewDocument", map[string]string{"source": script}, nil)
}

func navigateWithRetry(ctx context.Context, p *page.Page, url string) error {
	refused := false
	for {
		err := navigateOnce(ctx, p, url)
		if refused && errors.Is(err, context.DeadlineExceeded) {
			return errRefused
		}
		if !errors.Is(err, errRefused) {
			return err
		}
		refused = true
		select {
		case <-time.After(retryInterval):
		case <-ctx.Done():
			return errRefused
		}
	}
}

var errRefused = errors.New(refusedError)

func navigateOnce(ctx context.Context, p *page.Page, url string) error {
	events, unsubscribe := p.Subscribe()
	defer unsubscribe()
	var result navigation
	if err := p.Call(ctx, "Page.navigate", map[string]string{"url": url}, &result); err != nil {
		return err
	}
	if result.ErrorText == refusedError {
		return errRefused
	}
	if result.ErrorText != "" {
		return errors.New(result.ErrorText)
	}
	return page.WaitForLoad(ctx, events, result.FrameID, result.LoaderID)
}

func waitAfter(ctx context.Context, p *page.Page, trigger func() error) error {
	frameID, err := p.MainFrame(ctx)
	if err != nil {
		return err
	}
	events, unsubscribe := p.Subscribe()
	defer unsubscribe()
	if err := trigger(); err != nil {
		return err
	}
	return page.WaitForLoad(ctx, events, frameID, "")
}

func navigationError(err error, params protocol.NavigateParams) error {
	if errors.Is(err, errRefused) {
		return fmt.Errorf("%s not reachable after %s", params.URL, params.Timeout)
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return fmt.Errorf("%s did not load within %s (raise --timeout)", params.URL, params.Timeout)
	}
	return fmt.Errorf("navigate to %s: %w", params.URL, err)
}
