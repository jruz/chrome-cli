package cli_test

import (
	"strings"
	"testing"

	"github.com/jruz/chrome-cli/internal/protocol"
)

func TestConsoleDeduplicatesErrorsAndWarnings(t *testing.T) {
	h := start(t)
	server, _ := app(t)
	id := h.open(t, server, "/console")

	expect(t, h.run(t, "console", "-s", id), "[error] boom (×50)\n[warning] careful")
	var console protocol.Console
	h.json(t, &console, "console", "-s", id, "--all")
	if len(console.Messages) != 52 || console.Messages[51].Text != "hi" {
		t.Fatalf("--all returned %d messages ending %+v", len(console.Messages), console.Messages[len(console.Messages)-1])
	}
}

func TestNetworkListsFailedRequestsOnly(t *testing.T) {
	h := start(t)
	server, _ := app(t)
	id := h.open(t, server, "/assets")
	h.run(t, "eval", "-s", id, `new Promise(loaded => document.readyState === "complete" ? loaded() : addEventListener("load", loaded))`)

	got := h.run(t, "network", "-s", id)

	expectContains(t, got, "404 GET "+server.URL+"/missing.png")
	if strings.Contains(got, "ok.png") || strings.Contains(got, "200 ") {
		t.Fatalf("network printed successful requests: %q", got)
	}
	expectContains(t, h.run(t, "network", "-s", id, "--all"), "200 GET "+server.URL+"/ok.png")
}

func TestTextPrintsOnlyTheTargetElement(t *testing.T) {
	h := start(t)
	server, _ := app(t)
	id := h.open(t, server, "/dialog")

	expect(t, h.run(t, "text", "-s", id, `dialog "Confirm"`), "Delete forever?")
	expect(t, h.run(t, "text", "-s", id), "Main text")
	expect(t, h.run(t, "text", "-s", id, "--max", "4"), "Main\n… 5 more characters (raise --max)")
}

func TestNewPageSelectsTheNewTab(t *testing.T) {
	h := start(t)
	server, _ := app(t)
	id := h.open(t, server, "/save")

	expect(t, h.run(t, "new-page", "-s", id, server.URL+"/dupes"), "dupes — "+server.URL+"/dupes")

	listed := h.run(t, "pages", "-s", id)
	expectContains(t, listed, "  save — "+server.URL+"/save")
	expectContains(t, listed, "* dupes — "+server.URL+"/dupes")
	expect(t, h.run(t, "eval", "-s", id, "document.title"), "dupes")
	expect(t, h.run(t, "new-page", "-s", id, "--isolated-context", "guest", server.URL+"/form"), "form — "+server.URL+"/form")
}
