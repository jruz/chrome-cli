package page

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jruz/chrome-cli/internal/cdp"
)

var errNoPage = errors.New("browser has no page target (open one with chrome-cli new-page)")

type Page struct {
	conn      *cdp.Conn
	TargetID  string
	SessionID string
}

type targetInfo struct {
	TargetID string `json:"targetId"`
	Type     string `json:"type"`
}

type targets struct {
	TargetInfos []targetInfo `json:"targetInfos"`
}

type attached struct {
	SessionID string `json:"sessionId"`
}

func First(ctx context.Context, conn *cdp.Conn, report func(error)) (*Page, error) {
	var found targets
	if err := conn.Call(ctx, "", "Target.getTargets", nil, &found); err != nil {
		return nil, err
	}
	for _, info := range found.TargetInfos {
		if info.Type == "page" {
			return Attach(ctx, conn, info.TargetID, report)
		}
	}
	return nil, errNoPage
}

func Attach(ctx context.Context, conn *cdp.Conn, targetID string, report func(error)) (*Page, error) {
	var session attached
	params := map[string]any{"targetId": targetID, "flatten": true}
	if err := conn.Call(ctx, "", "Target.attachToTarget", params, &session); err != nil {
		return nil, err
	}
	p := &Page{conn: conn, TargetID: targetID, SessionID: session.SessionID}
	events, _ := p.Subscribe()
	go p.acceptDialogs(events, report)
	if err := p.enable(ctx); err != nil {
		return nil, err
	}
	return p, nil
}

func (p *Page) acceptDialogs(events <-chan cdp.Event, report func(error)) {
	for event := range events {
		if event.Method != "Page.javascriptDialogOpening" {
			continue
		}
		params := map[string]bool{"accept": true}
		if err := p.Call(context.Background(), "Page.handleJavaScriptDialog", params, nil); err != nil {
			report(fmt.Errorf("accept dialog: %w", err))
		}
	}
}

func (p *Page) enable(ctx context.Context) error {
	steps := []struct {
		method string
		params any
	}{
		{"Page.enable", nil},
		{"Page.setLifecycleEventsEnabled", map[string]bool{"enabled": true}},
		{"Runtime.enable", nil},
		{"Network.enable", nil},
	}
	for _, step := range steps {
		if err := p.Call(ctx, step.method, step.params, nil); err != nil {
			return err
		}
	}
	return nil
}

func (p *Page) Call(ctx context.Context, method string, params, result any) error {
	return p.conn.Call(ctx, p.SessionID, method, params, result)
}

func (p *Page) Done() <-chan struct{} {
	return p.conn.Done()
}

func (p *Page) Subscribe() (<-chan cdp.Event, func()) {
	return p.conn.Subscribe(p.SessionID)
}

type RemoteObject struct {
	Type        string          `json:"type"`
	Subtype     string          `json:"subtype"`
	Value       json.RawMessage `json:"value"`
	Description string          `json:"description"`
	ObjectID    string          `json:"objectId"`
}

type exceptionDetails struct {
	Text      string       `json:"text"`
	Exception RemoteObject `json:"exception"`
}

type evaluation struct {
	Result           RemoteObject      `json:"result"`
	ExceptionDetails *exceptionDetails `json:"exceptionDetails"`
}

func (p *Page) Evaluate(ctx context.Context, expression string) (RemoteObject, error) {
	params := map[string]any{"expression": expression, "returnByValue": true, "awaitPromise": true}
	var result evaluation
	if err := p.Call(ctx, "Runtime.evaluate", params, &result); err != nil {
		return RemoteObject{}, err
	}
	return result.Result, thrown(result.ExceptionDetails)
}

func (p *Page) CallOn(ctx context.Context, function string, objectIDs []string) (RemoteObject, error) {
	arguments := make([]map[string]string, len(objectIDs))
	for index, id := range objectIDs {
		arguments[index] = map[string]string{"objectId": id}
	}
	params := map[string]any{
		"functionDeclaration": function,
		"objectId":            objectIDs[0],
		"arguments":           arguments,
		"returnByValue":       true,
		"awaitPromise":        true,
	}
	var result evaluation
	if err := p.Call(ctx, "Runtime.callFunctionOn", params, &result); err != nil {
		return RemoteObject{}, err
	}
	return result.Result, thrown(result.ExceptionDetails)
}

func (p *Page) EvaluateInto(ctx context.Context, expression string, target any) error {
	result, err := p.Evaluate(ctx, expression)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(result.Value, target); err != nil {
		return fmt.Errorf("decode %q: %w", expression, err)
	}
	return nil
}

func thrown(details *exceptionDetails) error {
	if details == nil {
		return nil
	}
	if details.Exception.Description != "" {
		return errors.New(details.Exception.Description)
	}
	return errors.New(details.Text)
}
