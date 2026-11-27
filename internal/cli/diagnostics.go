package cli

import (
	"fmt"
	"time"

	"github.com/jruz/chrome-cli/internal/protocol"
)

type consoleCmd struct {
	target `embed:""`
	All    bool `help:"Show every message instead of deduplicated errors and warnings."`
}

func (c consoleCmd) Run(a *app) error {
	var console protocol.Console
	params := protocol.ConsoleParams{All: c.All}
	if err := a.client.Send(a.ctx, protocol.ActionConsole, c.protocol(), params, &console); err != nil {
		return err
	}
	return a.printer.Print(console, consoleLines(console, c.All)...)
}

func consoleLines(console protocol.Console, all bool) []string {
	if len(console.Messages) == 0 && !all {
		return []string{"no console errors or warnings"}
	}
	lines := make([]string, len(console.Messages))
	for index, message := range console.Messages {
		lines[index] = fmt.Sprintf("[%s] %s", message.Level, message.Text)
		if message.Count > 1 {
			lines[index] += fmt.Sprintf(" (×%d)", message.Count)
		}
	}
	return lines
}

type networkCmd struct {
	target `embed:""`
	All    bool `help:"Show every request instead of failed ones."`
}

func (c networkCmd) Run(a *app) error {
	var network protocol.Network
	params := protocol.NetworkParams{All: c.All}
	if err := a.client.Send(a.ctx, protocol.ActionNetwork, c.protocol(), params, &network); err != nil {
		return err
	}
	return a.printer.Print(network, networkLines(network, c.All)...)
}

func networkLines(network protocol.Network, all bool) []string {
	if len(network.Requests) == 0 && !all {
		return []string{"no failed requests"}
	}
	lines := make([]string, len(network.Requests))
	for index, request := range network.Requests {
		lines[index] = requestLine(request)
	}
	return lines
}

func requestLine(request protocol.NetworkRequest) string {
	switch {
	case request.Error != "":
		return fmt.Sprintf("failed %s %s (%s)", request.Method, request.URL, request.Error)
	case request.Status == 0:
		return fmt.Sprintf("pending %s %s", request.Method, request.URL)
	}
	return fmt.Sprintf("%d %s %s", request.Status, request.Method, request.URL)
}

type textCmd struct {
	target `embed:""`
	Target string `arg:"" optional:"" help:"Element uid or role and name; defaults to main or body."`
	Max    int    `default:"4000" help:"Maximum characters to print."`
}

func (c textCmd) Run(a *app) error {
	var text protocol.Text
	params := protocol.TextParams{Target: c.Target, Max: c.Max}
	if err := a.client.Send(a.ctx, protocol.ActionText, c.protocol(), params, &text); err != nil {
		return err
	}
	if text.Truncated == 0 {
		return a.printer.Print(text, text.Text)
	}
	return a.printer.Print(text, text.Text, fmt.Sprintf("… %d more characters (raise --max)", text.Truncated))
}

type pagesCmd struct {
	target `embed:""`
}

func (c pagesCmd) Run(a *app) error {
	var pages protocol.Pages
	if err := a.client.Send(a.ctx, protocol.ActionPages, c.protocol(), nil, &pages); err != nil {
		return err
	}
	lines := make([]string, len(pages.Pages))
	for index, info := range pages.Pages {
		marker := " "
		if info.Selected {
			marker = "*"
		}
		lines[index] = fmt.Sprintf("%s %s — %s", marker, info.Title, info.URL)
	}
	return a.printer.Print(pages, lines...)
}

type newPageCmd struct {
	target          `embed:""`
	URL             string        `arg:"" help:"URL to open."`
	Background      bool          `help:"Open the tab without bringing it to the front."`
	IsolatedContext string        `help:"Open in a named browser context with its own cookies and storage."`
	Timeout         time.Duration `default:"10s" help:"How long to wait for the page."`
}

func (c newPageCmd) Run(a *app) error {
	var navigated protocol.Navigated
	params := protocol.NewPageParams{URL: c.URL, Background: c.Background, IsolatedContext: c.IsolatedContext, Timeout: c.Timeout}
	if err := a.client.Send(a.ctx, protocol.ActionNewPage, c.protocol(), params, &navigated); err != nil {
		return err
	}
	return a.printer.Print(navigated, location(navigated))
}
