package commands

import (
	"context"

	"github.com/jruz/chrome-cli/internal/page"
	"github.com/jruz/chrome-cli/internal/protocol"
)

func Oneshot(ctx context.Context, p *page.Page, params protocol.OneshotParams, auto string) (protocol.Oneshot, error) {
	navigation := protocol.NavigateParams{URL: params.URL, Timeout: params.Timeout}
	if _, err := Navigate(ctx, p, navigation); err != nil {
		return protocol.Oneshot{}, err
	}
	if params.Mode == "snapshot" {
		snapshot, err := Snapshot(ctx, p, params.Snapshot)
		return protocol.Oneshot{Snapshot: &snapshot}, err
	}
	screenshots, err := Screenshot(ctx, p, params.Screenshot, Emulation{}, auto)
	return protocol.Oneshot{Screenshots: &screenshots}, err
}
