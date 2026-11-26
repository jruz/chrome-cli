package browser

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jruz/chrome-cli/internal/cdp"
)

const portPollInterval = 50 * time.Millisecond

type External struct {
	Port int
	Conn *cdp.Conn
}

func Connect(ctx context.Context, port int) (*External, error) {
	conn, err := cdp.DialPort(ctx, port)
	if err != nil {
		return nil, err
	}
	return &External{Port: port, Conn: conn}, nil
}

func (e *External) Close(ctx context.Context) error {
	err := e.Conn.Call(ctx, "", "Browser.close", nil, nil)
	if err != nil && !errors.Is(err, cdp.ErrClosed) {
		return err
	}
	return waitForClosedPort(ctx, e.Port)
}

func (e *External) Disconnect() error {
	return e.Conn.Close()
}

func waitForClosedPort(ctx context.Context, port int) error {
	ticker := time.NewTicker(portPollInterval)
	defer ticker.Stop()
	for cdp.PortResponds(ctx, port) {
		select {
		case <-ticker.C:
		case <-ctx.Done():
			return fmt.Errorf("port %d still responds after Browser.close: %w", port, ctx.Err())
		}
	}
	return nil
}
