package cdp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync/atomic"
)

var ErrClosed = errors.New("cdp connection closed")

type Transport interface {
	Write(message []byte) error
	Read() ([]byte, error)
	Close() error
}

type Error struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *Error) Error() string {
	return fmt.Sprintf("cdp error %d: %s", e.Code, e.Message)
}

type Event struct {
	Method    string
	Params    json.RawMessage
	SessionID string
}

type message struct {
	ID        int64           `json:"id,omitempty"`
	Method    string          `json:"method,omitempty"`
	Params    json.RawMessage `json:"params,omitempty"`
	SessionID string          `json:"sessionId,omitempty"`
	Result    json.RawMessage `json:"result,omitempty"`
	Error     *Error          `json:"error,omitempty"`
}

type pending struct {
	id    int64
	reply chan message
}

type subscription struct {
	sessionID string
	events    chan Event
}

type Conn struct {
	transport   Transport
	nextID      atomic.Int64
	register    chan pending
	forget      chan int64
	subscribe   chan subscription
	unsubscribe chan chan Event
	done        chan struct{}
	err         error
}

const subscriberBuffer = 1024

func NewConn(transport Transport) *Conn {
	conn := &Conn{
		transport:   transport,
		register:    make(chan pending),
		forget:      make(chan int64),
		subscribe:   make(chan subscription),
		unsubscribe: make(chan chan Event),
		done:        make(chan struct{}),
	}
	incoming := make(chan message)
	go conn.read(incoming)
	go conn.route(incoming)
	return conn
}

func (c *Conn) Done() <-chan struct{} {
	return c.done
}

func (c *Conn) Err() error {
	<-c.done
	return c.err
}

func (c *Conn) Close() error {
	return c.transport.Close()
}

func (c *Conn) Call(ctx context.Context, sessionID, method string, params, result any) error {
	raw, err := c.send(ctx, sessionID, method, params)
	if err != nil {
		return err
	}
	if result == nil {
		return nil
	}
	return decodeResult(method, raw, result)
}

func (c *Conn) Subscribe(sessionID string) (<-chan Event, func()) {
	events := make(chan Event, subscriberBuffer)
	select {
	case c.subscribe <- subscription{sessionID: sessionID, events: events}:
	case <-c.done:
		close(events)
		return events, func() {}
	}
	return events, func() { c.cancelSubscription(events) }
}

func (c *Conn) cancelSubscription(events chan Event) {
	select {
	case c.unsubscribe <- events:
	case <-c.done:
	}
}

func (c *Conn) send(ctx context.Context, sessionID, method string, params any) (json.RawMessage, error) {
	encoded, err := encodeParams(method, params)
	if err != nil {
		return nil, err
	}
	id := c.nextID.Add(1)
	reply := make(chan message, 1)
	if err := c.enqueue(ctx, pending{id: id, reply: reply}); err != nil {
		return nil, err
	}
	request := message{ID: id, Method: method, Params: encoded, SessionID: sessionID}
	if err := c.write(request); err != nil {
		c.drop(id)
		return nil, err
	}
	return c.await(ctx, id, method, reply)
}

func (c *Conn) enqueue(ctx context.Context, call pending) error {
	select {
	case c.register <- call:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-c.done:
		return ErrClosed
	}
}

func (c *Conn) write(request message) error {
	payload, err := json.Marshal(request)
	if err != nil {
		return fmt.Errorf("encode %s: %w", request.Method, err)
	}
	if err := c.transport.Write(payload); err != nil {
		return fmt.Errorf("send %s: %w", request.Method, err)
	}
	return nil
}

func (c *Conn) await(ctx context.Context, id int64, method string, reply chan message) (json.RawMessage, error) {
	select {
	case response := <-reply:
		return responseResult(method, response)
	case <-ctx.Done():
		c.drop(id)
		return nil, fmt.Errorf("%s: %w", method, ctx.Err())
	case <-c.done:
		return nil, fmt.Errorf("%s: %w", method, ErrClosed)
	}
}

func (c *Conn) drop(id int64) {
	select {
	case c.forget <- id:
	case <-c.done:
	}
}

func (c *Conn) read(incoming chan<- message) {
	for {
		payload, err := c.transport.Read()
		if err != nil {
			c.err = err
			close(incoming)
			return
		}
		var decoded message
		if err := json.Unmarshal(payload, &decoded); err != nil {
			c.err = fmt.Errorf("decode cdp message: %w", err)
			close(incoming)
			return
		}
		incoming <- decoded
	}
}

func (c *Conn) route(incoming <-chan message) {
	calls := map[int64]chan message{}
	subscribers := map[chan Event]string{}
	defer func() {
		close(c.done)
		for events := range subscribers {
			close(events)
		}
	}()
	for {
		select {
		case call := <-c.register:
			calls[call.id] = call.reply
		case id := <-c.forget:
			delete(calls, id)
		case sub := <-c.subscribe:
			subscribers[sub.events] = sub.sessionID
		case events := <-c.unsubscribe:
			delete(subscribers, events)
			close(events)
		case received, open := <-incoming:
			if !open {
				return
			}
			deliver(received, calls, subscribers)
		}
	}
}

func deliver(received message, calls map[int64]chan message, subscribers map[chan Event]string) {
	if received.ID != 0 {
		reply, found := calls[received.ID]
		if !found {
			return
		}
		delete(calls, received.ID)
		reply <- received
		return
	}
	event := Event{Method: received.Method, Params: received.Params, SessionID: received.SessionID}
	for events, sessionID := range subscribers {
		if sessionID == event.SessionID {
			events <- event
		}
	}
}

func encodeParams(method string, params any) (json.RawMessage, error) {
	if params == nil {
		return nil, nil
	}
	encoded, err := json.Marshal(params)
	if err != nil {
		return nil, fmt.Errorf("encode %s params: %w", method, err)
	}
	return encoded, nil
}

func responseResult(method string, response message) (json.RawMessage, error) {
	if response.Error != nil {
		return nil, fmt.Errorf("%s: %w", method, response.Error)
	}
	return response.Result, nil
}

func decodeResult(method string, raw json.RawMessage, result any) error {
	if err := json.Unmarshal(raw, result); err != nil {
		return fmt.Errorf("decode %s result: %w", method, err)
	}
	return nil
}
