package commands

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jruz/chrome-cli/internal/page"
	"github.com/jruz/chrome-cli/internal/protocol"
	"github.com/jruz/chrome-cli/internal/settle"
	"github.com/jruz/chrome-cli/internal/target"
)

const dragSteps = 5

const prepareFill = `function(value) {
	if (this instanceof HTMLSelectElement) {
		const option = [...this.options].find(o => o.value === value || o.label === value || o.text === value);
		if (!option) throw new Error("no option " + JSON.stringify(value));
		this.value = option.value;
		this.dispatchEvent(new Event("input", { bubbles: true }));
		this.dispatchEvent(new Event("change", { bubbles: true }));
		return "select";
	}
	if (this instanceof HTMLInputElement && (this.type === "checkbox" || this.type === "radio")) {
		const checked = ["true", "on", "checked"].includes(value);
		if (this.checked !== checked) this.click();
		return "toggle";
	}
	this.focus();
	if (typeof this.select === "function") {
		this.select();
	} else {
		const range = document.createRange();
		range.selectNodeContents(this);
		getSelection().removeAllRanges();
		getSelection().addRange(range);
	}
	return "text";
}`

const scrollState = `[Math.round(scrollY), document.scrollingElement.scrollHeight]`

type Action func(context.Context, *page.Page) (string, error)

type Capture func(context.Context) (protocol.Screenshots, error)

func Act(ctx context.Context, p *page.Page, options protocol.ActionOptions, action Action, screenshot Capture) (protocol.Acted, error) {
	observer, err := settle.Observe(ctx, p)
	if err != nil {
		return protocol.Acted{}, err
	}
	description, err := action(ctx, p)
	if err != nil {
		_, stopErr := observer.Settle(ctx, false)
		return protocol.Acted{}, errors.Join(err, stopErr)
	}
	report, err := observer.Settle(ctx, !options.NoWait)
	if err != nil {
		return protocol.Acted{}, err
	}
	acted := protocol.Acted{Action: description, Settled: report.Settled, Dialogs: report.Dialogs}
	return follow(ctx, p, options, acted, screenshot)
}

func follow(ctx context.Context, p *page.Page, options protocol.ActionOptions, acted protocol.Acted, screenshot Capture) (protocol.Acted, error) {
	if len(options.WaitFor) > 0 {
		found, err := WaitForText(ctx, p, protocol.WaitParams{Texts: options.WaitFor, Timeout: options.Timeout})
		if err != nil {
			return acted, err
		}
		acted.Found = found.Text
	}
	if options.Snapshot {
		snapshot, err := Snapshot(ctx, p, protocol.SnapshotParams{})
		if err != nil {
			return acted, err
		}
		acted.Snapshot = &snapshot
	}
	if options.Screenshot {
		shots, err := screenshot(ctx)
		if err != nil {
			return acted, err
		}
		acted.Screenshots = &shots
	}
	return acted, nil
}

func Click(params protocol.ClickParams) Action {
	return func(ctx context.Context, p *page.Page) (string, error) {
		element, err := target.Resolve(ctx, p, params.Target)
		if err != nil {
			return "", err
		}
		return clickElement(ctx, p, element, params.Double)
	}
}

func clickElement(ctx context.Context, p *page.Page, element target.Element, double bool) (string, error) {
	at, err := center(ctx, p, element)
	if err != nil {
		return "", err
	}
	clicks, verb := 1, "clicked "
	if double {
		clicks, verb = 2, "double-clicked "
	}
	return verb + element.Label, clickAt(ctx, p, at, clicks)
}

func Hover(params protocol.HoverParams) Action {
	return func(ctx context.Context, p *page.Page) (string, error) {
		element, err := target.Resolve(ctx, p, params.Target)
		if err != nil {
			return "", err
		}
		at, err := center(ctx, p, element)
		if err != nil {
			return "", err
		}
		return "hovered " + element.Label, mouse(ctx, p, "mouseMoved", at, 0)
	}
}

func Fill(params protocol.FillParams) Action {
	return func(ctx context.Context, p *page.Page) (string, error) {
		element, err := target.Resolve(ctx, p, params.Target)
		if err != nil {
			return "", err
		}
		return "filled " + element.Label, fillElement(ctx, p, element, params.Value)
	}
}

func FillForm(params protocol.FillFormParams) Action {
	return func(ctx context.Context, p *page.Page) (string, error) {
		tree, err := target.Load(ctx, p)
		if err != nil {
			return "", err
		}
		labels := make([]string, len(params.Fields))
		for index, field := range params.Fields {
			element, err := tree.Field(field.Target)
			if err != nil {
				return "", err
			}
			if err := fillElement(ctx, p, element, field.Value); err != nil {
				return "", err
			}
			labels[index] = element.Label
		}
		description := "filled " + strings.Join(labels, ", ")
		return submit(ctx, p, tree, params.Submit, description)
	}
}

func submit(ctx context.Context, p *page.Page, tree target.Tree, spec, description string) (string, error) {
	if spec == "" {
		return description, nil
	}
	element, err := tree.Find(spec)
	if err != nil {
		return "", err
	}
	clicked, err := clickElement(ctx, p, element, false)
	return description + "; " + clicked, err
}

func fillElement(ctx context.Context, p *page.Page, element target.Element, value string) error {
	objectID, err := p.ObjectID(ctx, element.BackendNodeID)
	if err != nil {
		return err
	}
	prepared, err := p.CallWith(ctx, objectID, prepareFill, value)
	if err != nil {
		return fmt.Errorf("fill %s: %w", element.Label, err)
	}
	var kind string
	if err := json.Unmarshal(prepared.Value, &kind); err != nil {
		return fmt.Errorf("fill %s: %w", element.Label, err)
	}
	if kind != "text" {
		return nil
	}
	if value == "" {
		return press(ctx, p, "Delete")
	}
	return p.Call(ctx, "Input.insertText", map[string]string{"text": value}, nil)
}

func Press(params protocol.PressParams) Action {
	return func(ctx context.Context, p *page.Page) (string, error) {
		return "pressed " + params.Key, press(ctx, p, params.Key)
	}
}

func Drag(params protocol.DragParams) Action {
	return func(ctx context.Context, p *page.Page) (string, error) {
		tree, err := target.Load(ctx, p)
		if err != nil {
			return "", err
		}
		from, err := tree.Find(params.From)
		if err != nil {
			return "", err
		}
		to, err := tree.Find(params.To)
		if err != nil {
			return "", err
		}
		return "dragged " + from.Label + " to " + to.Label, dragBetween(ctx, p, from, to)
	}
}

func dragBetween(ctx context.Context, p *page.Page, from, to target.Element) error {
	start, err := center(ctx, p, from)
	if err != nil {
		return err
	}
	end, err := center(ctx, p, to)
	if err != nil {
		return err
	}
	if err := mouse(ctx, p, "mouseMoved", start, 0); err != nil {
		return err
	}
	if err := mouse(ctx, p, "mousePressed", start, 1); err != nil {
		return err
	}
	for step := 1; step <= dragSteps; step++ {
		fraction := float64(step) / dragSteps
		at := point{x: start.x + (end.x-start.x)*fraction, y: start.y + (end.y-start.y)*fraction}
		if err := mouse(ctx, p, "mouseMoved", at, 0); err != nil {
			return err
		}
	}
	return mouse(ctx, p, "mouseReleased", end, 1)
}

func Scroll(params protocol.ScrollParams) Action {
	return func(ctx context.Context, p *page.Page) (string, error) {
		if err := scrollTo(ctx, p, params); err != nil {
			return "", err
		}
		var position [2]int
		if err := p.EvaluateInto(ctx, scrollState, &position); err != nil {
			return "", err
		}
		return fmt.Sprintf("scrollY %d / %d", position[0], position[1]), nil
	}
}

func scrollTo(ctx context.Context, p *page.Page, params protocol.ScrollParams) error {
	switch {
	case params.By != 0:
		return scrollWindow(ctx, p, fmt.Sprintf("scrollBy({ top: %d, behavior: 'instant' })", params.By))
	case params.Target == "top":
		return scrollWindow(ctx, p, "scrollTo({ top: 0, behavior: 'instant' })")
	case params.Target == "bottom":
		return scrollWindow(ctx, p, "scrollTo({ top: document.scrollingElement.scrollHeight, behavior: 'instant' })")
	case params.Target != "":
		element, err := target.Resolve(ctx, p, params.Target)
		if err != nil {
			return err
		}
		return p.Call(ctx, "DOM.scrollIntoViewIfNeeded", map[string]int{"backendNodeId": element.BackendNodeID}, nil)
	}
	return errors.New("nothing to scroll to (pass top, bottom, a target, or --by <px>)")
}

func scrollWindow(ctx context.Context, p *page.Page, expression string) error {
	_, err := p.Evaluate(ctx, expression)
	return err
}
