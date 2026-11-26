package commands

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jruz/chrome-cli/internal/cdp"
	"github.com/jruz/chrome-cli/internal/page"
	"github.com/jruz/chrome-cli/internal/protocol"
)

const textPollInterval = 100 * time.Millisecond

func WaitForText(ctx context.Context, p *page.Page, params protocol.WaitParams) (protocol.Found, error) {
	expression, err := findText(params.Texts)
	if err != nil {
		return protocol.Found{}, err
	}
	deadline, cancel := context.WithTimeout(ctx, params.Timeout)
	defer cancel()
	ticker := time.NewTicker(textPollInterval)
	defer ticker.Stop()
	for {
		var found string
		err := p.EvaluateInto(deadline, expression, &found)
		if err == nil && found != "" {
			return protocol.Found{Text: found}, nil
		}
		var protocolErr *cdp.Error
		if err != nil && !errors.Is(err, context.DeadlineExceeded) && !errors.As(err, &protocolErr) {
			return protocol.Found{}, err
		}
		select {
		case <-ticker.C:
		case <-deadline.Done():
			return protocol.Found{}, fmt.Errorf("none of %s appeared within %s", quoted(params.Texts), params.Timeout)
		}
	}
}

func findText(texts []string) (string, error) {
	encoded, err := json.Marshal(texts)
	if err != nil {
		return "", fmt.Errorf("encode texts: %w", err)
	}
	return fmt.Sprintf(`(texts => texts.find(text => document.body && document.body.innerText.includes(text)) ?? "")(%s)`, encoded), nil
}

func quoted(texts []string) string {
	parts := make([]string, len(texts))
	for index, text := range texts {
		parts[index] = fmt.Sprintf("%q", text)
	}
	return strings.Join(parts, ", ")
}
