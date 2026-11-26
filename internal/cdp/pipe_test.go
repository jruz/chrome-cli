package cdp_test

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"testing"
	"time"

	"github.com/jruz/chrome-cli/internal/cdp"
)

type request struct {
	ID        int64           `json:"id"`
	Method    string          `json:"method"`
	Params    json.RawMessage `json:"params"`
	SessionID string          `json:"sessionId"`
}

type peer struct {
	requests *bufio.Reader
	replies  io.WriteCloser
}

func connect(t *testing.T) (*cdp.Conn, peer) {
	t.Helper()
	toPeer, fromClient := io.Pipe()
	toClient, fromPeer := io.Pipe()
	conn := cdp.NewConn(cdp.NewPipe(fromClient, toClient))
	t.Cleanup(func() { conn.Close() })
	return conn, peer{requests: bufio.NewReader(toPeer), replies: fromPeer}
}

func (p peer) next(t *testing.T) request {
	t.Helper()
	frame, err := p.requests.ReadBytes(0)
	if err != nil {
		t.Errorf("read request: %v", err)
		return request{}
	}
	var decoded request
	if err := json.Unmarshal(frame[:len(frame)-1], &decoded); err != nil {
		t.Errorf("decode request: %v", err)
	}
	return decoded
}

func (p peer) send(t *testing.T, payload string) {
	t.Helper()
	if _, err := p.replies.Write(append([]byte(payload), 0)); err != nil {
		t.Errorf("write reply: %v", err)
	}
}

type evaluated struct {
	Value int `json:"value"`
}

func call(conn *cdp.Conn, method string) <-chan error {
	done := make(chan error, 1)
	go func() {
		var result evaluated
		done <- conn.Call(context.Background(), "", method, map[string]int{}, &result)
	}()
	return done
}

func TestCallRoutesOutOfOrderResponsesByID(t *testing.T) {
	conn, peer := connect(t)
	results := make(chan evaluated, 2)
	for range 2 {
		go func() {
			var result evaluated
			if err := conn.Call(context.Background(), "", "Runtime.evaluate", nil, &result); err != nil {
				t.Errorf("call: %v", err)
			}
			results <- result
		}()
	}
	first, second := peer.next(t), peer.next(t)

	peer.send(t, `{"id":`+itoa(second.ID)+`,"result":{"value":2}}`)
	peer.send(t, `{"id":`+itoa(first.ID)+`,"result":{"value":1}}`)

	got := map[int]bool{(<-results).Value: true, (<-results).Value: true}
	if !got[1] || !got[2] {
		t.Fatalf("results = %v, want values 1 and 2", got)
	}
}

func TestCallSendsSessionID(t *testing.T) {
	conn, peer := connect(t)
	go conn.Call(context.Background(), "page-1", "Page.enable", nil, nil)

	got := peer.next(t)

	if got.SessionID != "page-1" || got.Method != "Page.enable" {
		t.Fatalf("request = %+v, want Page.enable on page-1", got)
	}
}

func TestCallReturnsProtocolErrors(t *testing.T) {
	conn, peer := connect(t)
	done := call(conn, "Page.navigate")
	sent := peer.next(t)

	peer.send(t, `{"id":`+itoa(sent.ID)+`,"error":{"code":-32000,"message":"boom"}}`)

	var protocolError *cdp.Error
	if err := <-done; !errors.As(err, &protocolError) || protocolError.Message != "boom" {
		t.Fatalf("err = %v, want cdp error boom", err)
	}
}

func TestSubscribeRoutesEventsBySessionID(t *testing.T) {
	conn, peer := connect(t)
	events, cancel := conn.Subscribe("page-1")
	defer cancel()

	peer.send(t, `{"method":"Page.loadEventFired","sessionId":"page-2","params":{}}`)
	peer.send(t, `{"method":"Page.frameNavigated","sessionId":"page-1","params":{}}`)

	select {
	case event := <-events:
		if event.Method != "Page.frameNavigated" {
			t.Fatalf("event = %s, want Page.frameNavigated", event.Method)
		}
	case <-time.After(time.Second):
		t.Fatal("no event for page-1")
	}
}

func TestPendingCallFailsWhenPeerCloses(t *testing.T) {
	conn, peer := connect(t)
	done := call(conn, "Browser.close")
	peer.next(t)

	peer.replies.Close()

	if err := <-done; !errors.Is(err, cdp.ErrClosed) {
		t.Fatalf("err = %v, want ErrClosed", err)
	}
	<-conn.Done()
}

func itoa(id int64) string {
	return strconv.FormatInt(id, 10)
}
