package recorder

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jruz/chrome-cli/internal/cdp"
	"github.com/jruz/chrome-cli/internal/page"
	"github.com/jruz/chrome-cli/internal/protocol"
)

const (
	consoleLimit = 5000
	networkLimit = 5000
)

type Recorder struct {
	queries chan chan history
	done    chan struct{}
}

type history struct {
	console  []protocol.ConsoleMessage
	requests []protocol.NetworkRequest
}

type state struct {
	console  []protocol.ConsoleMessage
	order    []string
	requests map[string]protocol.NetworkRequest
	report   func(error)
}

type consoleCalled struct {
	Type string              `json:"type"`
	Args []page.RemoteObject `json:"args"`
}

type exceptionThrown struct {
	ExceptionDetails struct {
		Text      string            `json:"text"`
		Exception page.RemoteObject `json:"exception"`
	} `json:"exceptionDetails"`
}

type logEntry struct {
	Entry struct {
		Level string `json:"level"`
		Text  string `json:"text"`
		URL   string `json:"url"`
	} `json:"entry"`
}

type networkEvent struct {
	RequestID string `json:"requestId"`
	Type      string `json:"type"`
	Request   struct {
		Method string `json:"method"`
		URL    string `json:"url"`
	} `json:"request"`
	Response struct {
		Status int `json:"status"`
	} `json:"response"`
	ErrorText string `json:"errorText"`
	Canceled  bool   `json:"canceled"`
}

func Start(p *page.Page, report func(error)) *Recorder {
	events, _ := p.Subscribe()
	r := &Recorder{queries: make(chan chan history), done: make(chan struct{})}
	go r.run(events, &state{requests: map[string]protocol.NetworkRequest{}, report: report})
	return r
}

func (r *Recorder) History() ([]protocol.ConsoleMessage, []protocol.NetworkRequest, error) {
	reply := make(chan history, 1)
	select {
	case r.queries <- reply:
	case <-r.done:
		return nil, nil, fmt.Errorf("page closed: %w", cdp.ErrClosed)
	}
	recorded := <-reply
	return recorded.console, recorded.requests, nil
}

func (r *Recorder) run(events <-chan cdp.Event, current *state) {
	defer close(r.done)
	for {
		select {
		case event, open := <-events:
			if !open {
				return
			}
			if err := current.apply(event); err != nil {
				current.report(err)
			}
		case reply := <-r.queries:
			reply <- current.snapshot()
		}
	}
}

func (s *state) snapshot() history {
	requests := make([]protocol.NetworkRequest, len(s.order))
	for index, id := range s.order {
		requests[index] = s.requests[id]
	}
	return history{console: append([]protocol.ConsoleMessage{}, s.console...), requests: requests}
}

func (s *state) apply(event cdp.Event) error {
	switch event.Method {
	case "Runtime.consoleAPICalled":
		return decodeInto(event, func(called consoleCalled) { s.log(level(called.Type), joinArgs(called.Args)) })
	case "Runtime.exceptionThrown":
		return decodeInto(event, func(thrown exceptionThrown) { s.log("error", exceptionText(thrown)) })
	case "Log.entryAdded":
		return decodeInto(event, func(entry logEntry) { s.log(entry.Entry.Level, logText(entry)) })
	case "Network.requestWillBeSent":
		return decodeInto(event, s.started)
	case "Network.responseReceived":
		return decodeInto(event, s.responded)
	case "Network.loadingFailed":
		return decodeInto(event, s.failed)
	}
	return nil
}

func decodeInto[T any](event cdp.Event, use func(T)) error {
	var decoded T
	if err := json.Unmarshal(event.Params, &decoded); err != nil {
		return fmt.Errorf("decode %s: %w", event.Method, err)
	}
	use(decoded)
	return nil
}

func (s *state) log(level, text string) {
	s.console = append(s.console, protocol.ConsoleMessage{Level: level, Text: text, Count: 1})
	if len(s.console) > consoleLimit {
		s.console = s.console[1:]
	}
}

func (s *state) started(event networkEvent) {
	if _, seen := s.requests[event.RequestID]; !seen {
		s.order = append(s.order, event.RequestID)
	}
	s.requests[event.RequestID] = protocol.NetworkRequest{Method: event.Request.Method, URL: event.Request.URL, Type: event.Type}
	if len(s.order) > networkLimit {
		delete(s.requests, s.order[0])
		s.order = s.order[1:]
	}
}

func (s *state) responded(event networkEvent) {
	request, found := s.requests[event.RequestID]
	if !found {
		return
	}
	request.Status = event.Response.Status
	s.requests[event.RequestID] = request
}

func (s *state) failed(event networkEvent) {
	request, found := s.requests[event.RequestID]
	if !found || event.Canceled {
		return
	}
	request.Error = event.ErrorText
	s.requests[event.RequestID] = request
}

func level(kind string) string {
	switch kind {
	case "error", "assert":
		return "error"
	case "warning":
		return "warning"
	}
	return kind
}

func joinArgs(args []page.RemoteObject) string {
	parts := make([]string, len(args))
	for index, arg := range args {
		parts[index] = describe(arg)
	}
	return strings.Join(parts, " ")
}

func describe(object page.RemoteObject) string {
	if len(object.Value) > 0 {
		var text string
		if err := json.Unmarshal(object.Value, &text); err == nil {
			return text
		}
		return string(object.Value)
	}
	if object.Description != "" {
		return object.Description
	}
	return object.Type
}

func exceptionText(thrown exceptionThrown) string {
	if thrown.ExceptionDetails.Exception.Description != "" {
		return thrown.ExceptionDetails.Exception.Description
	}
	return thrown.ExceptionDetails.Text
}

func logText(entry logEntry) string {
	if entry.Entry.URL == "" {
		return entry.Entry.Text
	}
	return entry.Entry.Text + " " + entry.Entry.URL
}
