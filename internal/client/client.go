package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os/exec"
	"syscall"
	"time"

	"github.com/jruz/chrome-cli/internal/protocol"
	"github.com/jruz/chrome-cli/internal/rundir"
)

const (
	startTimeout = 5 * time.Second
	pollInterval = 50 * time.Millisecond
)

type Client struct {
	runtimeDir string
	daemon     []string
	http       *http.Client
}

func New(runtimeDir string, daemon []string) Client {
	socket := rundir.Socket(runtimeDir)
	dial := func(ctx context.Context, _, _ string) (net.Conn, error) {
		var dialer net.Dialer
		return dialer.DialContext(ctx, "unix", socket)
	}
	transport := &http.Transport{DialContext: dial, DisableKeepAlives: true}
	return Client{runtimeDir: runtimeDir, daemon: daemon, http: &http.Client{Transport: transport}}
}

func (c Client) Call(ctx context.Context, action string, params, result any) error {
	if err := rundir.Ensure(c.runtimeDir); err != nil {
		return err
	}
	body, err := encode(action, params)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://daemon/command", bytes.NewReader(body))
	if err != nil {
		return err
	}
	response, err := c.http.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	return decode(response, result)
}

func (c Client) Send(ctx context.Context, action string, params, result any) error {
	if err := c.Ensure(ctx); err != nil {
		return err
	}
	return c.Call(ctx, action, params, result)
}

func (c Client) Status(ctx context.Context) (protocol.Status, bool, error) {
	var status protocol.Status
	err := c.Call(ctx, protocol.ActionStatus, nil, &status)
	if unreachable(err) {
		return protocol.Status{}, false, nil
	}
	return status, err == nil, err
}

func (c Client) Ensure(ctx context.Context) error {
	_, err := c.Start(ctx)
	return err
}

func (c Client) Start(ctx context.Context) (bool, error) {
	_, running, err := c.Status(ctx)
	if err != nil || running {
		return false, err
	}
	if err := c.spawn(); err != nil {
		return false, err
	}
	return true, c.waitFor(ctx, true)
}

func (c Client) Stop(ctx context.Context) (protocol.Killed, error) {
	var killed protocol.Killed
	if err := c.Call(ctx, protocol.ActionShutdown, nil, &killed); err != nil {
		return protocol.Killed{}, err
	}
	return killed, c.waitFor(ctx, false)
}

func (c Client) spawn() error {
	command := exec.Command(c.daemon[0], c.daemon[1:]...)
	command.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := command.Start(); err != nil {
		return fmt.Errorf("start daemon: %w", err)
	}
	go command.Wait()
	return nil
}

func (c Client) waitFor(ctx context.Context, running bool) error {
	deadline, cancel := context.WithTimeout(ctx, startTimeout)
	defer cancel()
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()
	for {
		_, current, err := c.Status(deadline)
		if err != nil && !errors.Is(err, context.DeadlineExceeded) {
			return err
		}
		if current == running {
			return nil
		}
		select {
		case <-ticker.C:
		case <-deadline.Done():
			return fmt.Errorf("daemon did not %s within %s (see %s)", transition(running), startTimeout, rundir.Log(c.runtimeDir))
		}
	}
}

func transition(running bool) string {
	if running {
		return "start"
	}
	return "stop"
}

func unreachable(err error) bool {
	return errors.Is(err, syscall.ENOENT) || errors.Is(err, syscall.ECONNREFUSED) || errors.Is(err, syscall.ECONNRESET)
}

func encode(action string, params any) ([]byte, error) {
	raw, err := json.Marshal(params)
	if err != nil {
		return nil, fmt.Errorf("encode %s params: %w", action, err)
	}
	return json.Marshal(protocol.Request{Action: action, Params: raw})
}

func decode(response *http.Response, result any) error {
	if response.StatusCode != http.StatusOK {
		var failure protocol.Failure
		if err := json.NewDecoder(response.Body).Decode(&failure); err != nil {
			return fmt.Errorf("daemon returned %s: %w", response.Status, err)
		}
		return errors.New(failure.Error)
	}
	if err := json.NewDecoder(response.Body).Decode(result); err != nil {
		return fmt.Errorf("decode daemon response: %w", err)
	}
	return nil
}
