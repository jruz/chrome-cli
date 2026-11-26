package commands

import (
	"context"

	"github.com/jruz/chrome-cli/internal/page"
	"github.com/jruz/chrome-cli/internal/protocol"
)

func Evaluate(ctx context.Context, p *page.Page, params protocol.EvalParams) (protocol.Evaluated, error) {
	result, err := run(ctx, p, params)
	if err != nil {
		return protocol.Evaluated{}, err
	}
	return protocol.Evaluated{Type: result.Type, Value: result.Value}, nil
}

func run(ctx context.Context, p *page.Page, params protocol.EvalParams) (page.RemoteObject, error) {
	if len(params.Args) == 0 {
		return p.Evaluate(ctx, params.Expression)
	}
	objectIDs, err := p.ResolveUIDs(ctx, params.Args)
	if err != nil {
		return page.RemoteObject{}, err
	}
	return p.CallOn(ctx, params.Expression, objectIDs)
}
