package cli

import (
	"fmt"
	"strings"
	"time"

	"github.com/jruz/chrome-cli/internal/protocol"
)

type actionFlags struct {
	NoWait     bool          `help:"Return without waiting for the page to settle."`
	WaitFor    []string      `sep:"none" help:"After settling, wait for this text (repeat for alternatives)."`
	Timeout    time.Duration `default:"10s" help:"How long --wait-for waits."`
	Snapshot   bool          `help:"Print a snapshot after the action."`
	Screenshot bool          `help:"Save a screenshot after the action and print its path."`
}

func (f actionFlags) options() protocol.ActionOptions {
	return protocol.ActionOptions{
		NoWait:     f.NoWait,
		WaitFor:    f.WaitFor,
		Timeout:    f.Timeout,
		Snapshot:   f.Snapshot,
		Screenshot: f.Screenshot,
	}
}

func act(a *app, action string, t target, params any, noWait bool) error {
	var acted protocol.Acted
	if err := a.client.Send(a.ctx, action, t.protocol(), params, &acted); err != nil {
		return err
	}
	return a.printer.Print(acted, actedLines(acted, noWait)...)
}

type clickCmd struct {
	target      `embed:""`
	actionFlags `embed:""`
	Target      string `arg:"" help:"Element uid or role and name such as 'button \"Save\"'."`
	DblClick    bool   `help:"Double-click."`
}

func (c clickCmd) Run(a *app) error {
	params := protocol.ClickParams{Target: c.Target, Double: c.DblClick, Options: c.options()}
	return act(a, protocol.ActionClick, c.target, params, c.NoWait)
}

type hoverCmd struct {
	target      `embed:""`
	actionFlags `embed:""`
	Target      string `arg:"" help:"Element uid or role and name such as 'link \"Docs\"'."`
}

func (c hoverCmd) Run(a *app) error {
	params := protocol.HoverParams{Target: c.Target, Options: c.options()}
	return act(a, protocol.ActionHover, c.target, params, c.NoWait)
}

type fillCmd struct {
	target      `embed:""`
	actionFlags `embed:""`
	Target      string `arg:"" help:"Element uid or role and name such as 'textbox \"Email\"'."`
	Value       string `arg:"" help:"Text to enter, option to select, or true/false for checkboxes."`
}

func (c fillCmd) Run(a *app) error {
	params := protocol.FillParams{Target: c.Target, Value: c.Value, Options: c.options()}
	return act(a, protocol.ActionFill, c.target, params, c.NoWait)
}

type fillFormCmd struct {
	target      `embed:""`
	actionFlags `embed:""`
	Fields      []string `arg:"" help:"Label=value pairs; the label is an accessible name, uid, or role and name."`
	Submit      string   `help:"Click this element after filling."`
}

func (c fillFormCmd) Run(a *app) error {
	fields, err := parseFields(c.Fields)
	if err != nil {
		return err
	}
	params := protocol.FillFormParams{Fields: fields, Submit: c.Submit, Options: c.options()}
	return act(a, protocol.ActionFillForm, c.target, params, c.NoWait)
}

func parseFields(pairs []string) ([]protocol.Field, error) {
	fields := make([]protocol.Field, len(pairs))
	for index, pair := range pairs {
		label, value, found := strings.Cut(pair, "=")
		if !found || label == "" {
			return nil, fmt.Errorf("invalid field %q (use Label=value such as Email=a@b.com)", pair)
		}
		fields[index] = protocol.Field{Target: label, Value: value}
	}
	return fields, nil
}

type pressCmd struct {
	target      `embed:""`
	actionFlags `embed:""`
	Key         string `arg:"" help:"Key such as Enter, Tab, Escape, a, or Control+a."`
}

func (c pressCmd) Run(a *app) error {
	params := protocol.PressParams{Key: c.Key, Options: c.options()}
	return act(a, protocol.ActionPress, c.target, params, c.NoWait)
}

type dragCmd struct {
	target      `embed:""`
	actionFlags `embed:""`
	From        string `arg:"" help:"Element to drag."`
	To          string `arg:"" help:"Element to drop onto."`
}

func (c dragCmd) Run(a *app) error {
	params := protocol.DragParams{From: c.From, To: c.To, Options: c.options()}
	return act(a, protocol.ActionDrag, c.target, params, c.NoWait)
}

type scrollCmd struct {
	target      `embed:""`
	actionFlags `embed:""`
	Target      string `arg:"" optional:"" help:"top, bottom, or an element to scroll into view."`
	By          int    `help:"Scroll by this many pixels (negative scrolls up)."`
}

func (c scrollCmd) Run(a *app) error {
	params := protocol.ScrollParams{Target: c.Target, By: c.By, Options: c.options()}
	return act(a, protocol.ActionScroll, c.target, params, c.NoWait)
}

type waitCmd struct {
	target  `embed:""`
	Texts   []string      `arg:"" help:"Texts to wait for; any one is enough."`
	Timeout time.Duration `default:"10s" help:"How long to wait."`
}

func (c waitCmd) Run(a *app) error {
	var found protocol.Found
	params := protocol.WaitParams{Texts: c.Texts, Timeout: c.Timeout}
	if err := a.client.Send(a.ctx, protocol.ActionWait, c.protocol(), params, &found); err != nil {
		return err
	}
	return a.printer.Print(found, fmt.Sprintf("found %q", found.Text))
}

func actedLines(acted protocol.Acted, noWait bool) []string {
	lines := []string{acted.Action}
	if !acted.Settled && !noWait {
		lines = append(lines, "page still busy after 5s")
	}
	for _, dialog := range acted.Dialogs {
		lines = append(lines, fmt.Sprintf("dialog %s: %s", dialog.Type, dialog.Message))
	}
	if acted.Found != "" {
		lines = append(lines, fmt.Sprintf("found %q", acted.Found))
	}
	if acted.Snapshot != nil {
		lines = append(lines, snapshotText(*acted.Snapshot))
	}
	if acted.Screenshots != nil {
		lines = append(lines, acted.Screenshots.Paths...)
	}
	return lines
}
