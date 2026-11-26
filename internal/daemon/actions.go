package daemon

import (
	"context"

	"github.com/jruz/chrome-cli/internal/commands"
	"github.com/jruz/chrome-cli/internal/protocol"
)

type actionParams interface {
	Settings() protocol.ActionOptions
}

func acting[P actionParams](d daemon, build func(P) commands.Action) func(context.Context, session, P) (protocol.Acted, error) {
	return func(ctx context.Context, current session, params P) (protocol.Acted, error) {
		capture := func(ctx context.Context) (protocol.Screenshots, error) {
			return d.screenshot(ctx, current, protocol.ScreenshotParams{Format: "png"})
		}
		return commands.Act(ctx, current.page, params.Settings(), build(params), capture)
	}
}
