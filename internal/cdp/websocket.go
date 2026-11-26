package cdp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/coder/websocket"
)

const readLimit = 512 << 20

type socket struct {
	conn *websocket.Conn
}

type version struct {
	WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
}

func DialPort(ctx context.Context, port int) (*Conn, error) {
	endpoint, err := debuggerURL(ctx, port)
	if err != nil {
		return nil, err
	}
	conn, _, err := websocket.Dial(ctx, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("connect to Chrome on port %d: %w", port, err)
	}
	conn.SetReadLimit(readLimit)
	return NewConn(&socket{conn: conn}), nil
}

func PortResponds(ctx context.Context, port int) bool {
	_, err := debuggerURL(ctx, port)
	return err == nil
}

func debuggerURL(ctx context.Context, port int) (string, error) {
	url := fmt.Sprintf("http://127.0.0.1:%d/json/version", port)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return "", fmt.Errorf("no Chrome on port %d: %w", port, err)
	}
	defer response.Body.Close()
	var decoded version
	if err := json.NewDecoder(response.Body).Decode(&decoded); err != nil {
		return "", fmt.Errorf("read Chrome version on port %d: %w", port, err)
	}
	return decoded.WebSocketDebuggerURL, nil
}

func (s *socket) Write(message []byte) error {
	return s.conn.Write(context.Background(), websocket.MessageText, message)
}

func (s *socket) Read() ([]byte, error) {
	_, payload, err := s.conn.Read(context.Background())
	return payload, err
}

func (s *socket) Close() error {
	return s.conn.CloseNow()
}
