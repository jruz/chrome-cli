package commands

import (
	"context"
	"fmt"
	"strings"

	"github.com/jruz/chrome-cli/internal/page"
	"github.com/jruz/chrome-cli/internal/target"
)

type point struct {
	x float64
	y float64
}

type quads struct {
	Quads [][]float64 `json:"quads"`
}

type key struct {
	key     string
	code    string
	keyCode int
	text    string
}

var namedKeys = map[string]key{
	"Enter":      {key: "Enter", code: "Enter", keyCode: 13, text: "\r"},
	"Tab":        {key: "Tab", code: "Tab", keyCode: 9},
	"Escape":     {key: "Escape", code: "Escape", keyCode: 27},
	"Backspace":  {key: "Backspace", code: "Backspace", keyCode: 8},
	"Delete":     {key: "Delete", code: "Delete", keyCode: 46},
	"Space":      {key: " ", code: "Space", keyCode: 32, text: " "},
	"ArrowUp":    {key: "ArrowUp", code: "ArrowUp", keyCode: 38},
	"ArrowDown":  {key: "ArrowDown", code: "ArrowDown", keyCode: 40},
	"ArrowLeft":  {key: "ArrowLeft", code: "ArrowLeft", keyCode: 37},
	"ArrowRight": {key: "ArrowRight", code: "ArrowRight", keyCode: 39},
	"Home":       {key: "Home", code: "Home", keyCode: 36},
	"End":        {key: "End", code: "End", keyCode: 35},
	"PageUp":     {key: "PageUp", code: "PageUp", keyCode: 33},
	"PageDown":   {key: "PageDown", code: "PageDown", keyCode: 34},
}

var modifierBits = map[string]int{"Alt": 1, "Control": 2, "Meta": 4, "Shift": 8}

func center(ctx context.Context, p *page.Page, element target.Element) (point, error) {
	node := map[string]int{"backendNodeId": element.BackendNodeID}
	if err := p.Call(ctx, "DOM.scrollIntoViewIfNeeded", node, nil); err != nil {
		return point{}, fmt.Errorf("scroll %s into view: %w", element.Label, err)
	}
	var found quads
	if err := p.Call(ctx, "DOM.getContentQuads", node, &found); err != nil {
		return point{}, fmt.Errorf("locate %s: %w", element.Label, err)
	}
	if len(found.Quads) == 0 {
		return point{}, fmt.Errorf("%s is not visible", element.Label)
	}
	quad := found.Quads[0]
	return point{x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4, y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4}, nil
}

func mouse(ctx context.Context, p *page.Page, kind string, at point, clicks int) error {
	params := map[string]any{"type": kind, "x": at.x, "y": at.y}
	if kind != "mouseMoved" {
		params["button"] = "left"
		params["clickCount"] = clicks
	}
	return p.Call(ctx, "Input.dispatchMouseEvent", params, nil)
}

func clickAt(ctx context.Context, p *page.Page, at point, clicks int) error {
	if err := mouse(ctx, p, "mouseMoved", at, 0); err != nil {
		return err
	}
	for count := 1; count <= clicks; count++ {
		if err := mouse(ctx, p, "mousePressed", at, count); err != nil {
			return err
		}
		if err := mouse(ctx, p, "mouseReleased", at, count); err != nil {
			return err
		}
	}
	return nil
}

func parseKey(combo string) (key, int, error) {
	parts := strings.Split(combo, "+")
	modifiers := 0
	for _, name := range parts[:len(parts)-1] {
		bit, found := modifierBits[name]
		if !found {
			return key{}, 0, fmt.Errorf("invalid modifier %q in %q (use Alt, Control, Meta, or Shift)", name, combo)
		}
		modifiers |= bit
	}
	last := parts[len(parts)-1]
	if named, found := namedKeys[last]; found {
		return named, modifiers, nil
	}
	if len([]rune(last)) == 1 {
		return character(last), modifiers, nil
	}
	return key{}, 0, fmt.Errorf("invalid key %q (use a character or Enter, Tab, Escape, Backspace, Delete, Space, arrows, Home, End, PageUp, PageDown)", last)
}

func character(text string) key {
	upper := strings.ToUpper(text)
	code := "Key" + upper
	if upper >= "0" && upper <= "9" {
		code = "Digit" + upper
	}
	return key{key: text, code: code, keyCode: int(upper[0]), text: text}
}

func press(ctx context.Context, p *page.Page, combo string) error {
	pressed, modifiers, err := parseKey(combo)
	if err != nil {
		return err
	}
	down := map[string]any{
		"type":                  "keyDown",
		"key":                   pressed.key,
		"code":                  pressed.code,
		"windowsVirtualKeyCode": pressed.keyCode,
		"modifiers":             modifiers,
	}
	if pressed.text != "" && modifiers&^modifierBits["Shift"] == 0 {
		down["text"] = pressed.text
	}
	if err := p.Call(ctx, "Input.dispatchKeyEvent", down, nil); err != nil {
		return err
	}
	up := map[string]any{"type": "keyUp", "key": pressed.key, "code": pressed.code, "windowsVirtualKeyCode": pressed.keyCode, "modifiers": modifiers}
	return p.Call(ctx, "Input.dispatchKeyEvent", up, nil)
}
