package page

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jruz/chrome-cli/internal/cdp"
)

type lifecycle struct {
	FrameID  string `json:"frameId"`
	LoaderID string `json:"loaderId"`
	Name     string `json:"name"`
}

type frameTree struct {
	FrameTree struct {
		Frame struct {
			ID string `json:"id"`
		} `json:"frame"`
	} `json:"frameTree"`
}

func (p *Page) MainFrame(ctx context.Context) (string, error) {
	var tree frameTree
	if err := p.Call(ctx, "Page.getFrameTree", nil, &tree); err != nil {
		return "", err
	}
	return tree.FrameTree.Frame.ID, nil
}

func WaitForLoad(ctx context.Context, events <-chan cdp.Event, frameID, loaderID string) error {
	for {
		select {
		case event, open := <-events:
			if !open {
				return cdp.ErrClosed
			}
			done, err := loaded(event, frameID, loaderID)
			if err != nil || done {
				return err
			}
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func loaded(event cdp.Event, frameID, loaderID string) (bool, error) {
	if event.Method != "Page.lifecycleEvent" {
		return false, nil
	}
	var current lifecycle
	if err := json.Unmarshal(event.Params, &current); err != nil {
		return false, fmt.Errorf("decode Page.lifecycleEvent: %w", err)
	}
	matchesLoader := loaderID == "" || current.LoaderID == loaderID
	return current.Name == "DOMContentLoaded" && current.FrameID == frameID && matchesLoader, nil
}

func (p *Page) Settled(ctx context.Context) error {
	_, err := p.Evaluate(ctx, "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
	if err != nil {
		return fmt.Errorf("wait for paint: %w", err)
	}
	return nil
}
