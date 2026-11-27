package commands

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jruz/chrome-cli/internal/page"
	"github.com/jruz/chrome-cli/internal/protocol"
	"github.com/jruz/chrome-cli/internal/target"
)

const (
	pageText    = `(document.querySelector("main") ?? document.body).innerText`
	elementText = `function() { return this.innerText ?? this.textContent; }`
)

func Text(ctx context.Context, p *page.Page, params protocol.TextParams) (protocol.Text, error) {
	text, err := readText(ctx, p, params.Target)
	if err != nil {
		return protocol.Text{}, err
	}
	runes := []rune(text)
	if len(runes) <= params.Max {
		return protocol.Text{Text: text}, nil
	}
	return protocol.Text{Text: string(runes[:params.Max]), Truncated: len(runes) - params.Max}, nil
}

func readText(ctx context.Context, p *page.Page, spec string) (string, error) {
	if spec == "" {
		var text string
		return text, p.EvaluateInto(ctx, pageText, &text)
	}
	element, err := target.Resolve(ctx, p, spec)
	if err != nil {
		return "", err
	}
	objectID, err := p.ObjectID(ctx, element.BackendNodeID)
	if err != nil {
		return "", err
	}
	result, err := p.CallWith(ctx, objectID, elementText)
	if err != nil {
		return "", err
	}
	var text string
	if err := json.Unmarshal(result.Value, &text); err != nil {
		return "", fmt.Errorf("read text of %s: %w", element.Label, err)
	}
	return text, nil
}
