package cli_test

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

const page = `<!doctype html><meta name="viewport" content="width=device-width"><title>%s</title>%s`

var pages = map[string]string{
	"/save":  `<button onclick="setTimeout(() => document.body.insertAdjacentHTML('beforeend', '<p>Saved</p>'), 500)">Save</button>`,
	"/dupes": `<button>Move</button><button>Move</button>`,
	"/form": `<form method="post" action="/submitted">
		<label>Email <input name="email"></label>
		<label>Password <input type="password" name="password"></label>
		<label><input type="checkbox" name="remember"> Remember me</label>
		<button>Sign in</button></form>`,
	"/confirm": `<button onclick="document.body.dataset.answer = confirm('Delete it?')">Delete</button>`,
	"/long":    `<div style="height: 5000px">Top</div><p>Bottom</p>`,
	"/inputs": `<label>Name <input id="name"></label>
		<select aria-label="Size"><option>Small</option><option>Large</option></select>
		<button onmouseenter="this.textContent = 'Hovered'">Hover me</button>
		<button id="source" onmousedown="document.body.dataset.from = 'source'">Source</button>
		<button id="sink" onmouseup="document.body.dataset.to = 'sink'">Sink</button>`,
	"/later": `<script>setTimeout(() => document.body.append('Ready'), 300)</script>`,
	"/console": `<script>
		for (let i = 0; i < 50; i++) console.error("boom");
		console.warn("careful");
		console.log("hi");
	</script>`,
	"/assets": `<img src="/missing.png"><img src="/ok.png">`,
	"/ok.png": ``,
	"/dialog": `<main>Main text</main><div role="dialog" aria-label="Confirm"><p>Delete forever?</p></div>`,
}

type submissions chan url.Values

func app(t *testing.T) (*httptest.Server, submissions) {
	t.Helper()
	submitted := make(submissions, 1)
	mux := http.NewServeMux()
	for path, body := range pages {
		mux.HandleFunc(path, func(w http.ResponseWriter, _ *http.Request) {
			fmt.Fprintf(w, page, strings.TrimPrefix(path, "/"), body)
		})
	}
	mux.HandleFunc("/favicon.ico", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.HandleFunc("POST /submitted", func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Errorf("parse form: %v", err)
		}
		submitted <- r.PostForm
		fmt.Fprintf(w, page, "Welcome", "<p>Welcome</p>")
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server, submitted
}

func (h harness) open(t *testing.T, server *httptest.Server, path string) string {
	t.Helper()
	return h.run(t, "launch", "--url", server.URL+path)
}

func TestClickWaitsForTextAfterSettling(t *testing.T) {
	h := start(t)
	server, _ := app(t)
	id := h.open(t, server, "/save")

	got := h.run(t, "click", "-s", id, `button "Save"`, "--wait-for", "Saved")

	expectMatch(t, got, `^clicked button "Save" \[uid=\w+\]\nfound "Saved"$`)
}

func TestAmbiguousTargetsListEveryCandidate(t *testing.T) {
	h := start(t)
	server, _ := app(t)
	id := h.open(t, server, "/dupes")

	got := h.fail(t, "click", "-s", id, `button "Move"`)

	expectMatch(t, got, `^error: button "Move" matches 2 elements: uid=\w+, uid=\w+ \(pass one uid\)$`)
}

func TestFillFormByLabelsSubmitsTheForm(t *testing.T) {
	h := start(t)
	server, submitted := app(t)
	id := h.open(t, server, "/form")

	got := h.run(t, "fill-form", "-s", id, "Email=a@b.com", "Password=secret", "Remember me=true", "--submit", `button "Sign in"`)

	expectMatch(t, got, `^filled textbox "Email" .*; clicked button "Sign in" \[uid=\w+\]$`)
	form := <-submitted
	expect(t, form.Get("email")+" "+form.Get("password")+" "+form.Get("remember"), "a@b.com secret on")
	expect(t, h.run(t, "eval", "-s", id, "document.title"), "Welcome")
}

func TestClickReportsDialogText(t *testing.T) {
	h := start(t)
	server, _ := app(t)
	id := h.open(t, server, "/confirm")

	got := h.run(t, "click", "-s", id, `button "Delete"`)

	expectMatch(t, got, `^clicked button "Delete" \[uid=\w+\]\ndialog confirm: Delete it\?$`)
	expect(t, h.run(t, "eval", "-s", id, "document.body.dataset.answer"), "true")
}

var scrollLine = regexp.MustCompile(`^scrollY (\d+) / (\d+)$`)

func TestScrollBottomReachesTheEnd(t *testing.T) {
	h := start(t)
	server, _ := app(t)
	id := h.open(t, server, "/long")

	got := h.run(t, "scroll", "-s", id, "bottom")

	match := scrollLine.FindStringSubmatch(got)
	if match == nil {
		t.Fatalf("scroll printed %q", got)
	}
	y, _ := strconv.Atoi(match[1])
	height, _ := strconv.Atoi(match[2])
	viewport, err := strconv.Atoi(h.run(t, "eval", "-s", id, "innerHeight"))
	if err != nil || y+viewport < height {
		t.Fatalf("scrollY %d + innerHeight %d < height %d (%v)", y, viewport, height, err)
	}
	expect(t, h.run(t, "scroll", "-s", id, "top"), "scrollY 0 / "+match[2])
}

func TestFillPressHoverAndDrag(t *testing.T) {
	h := start(t)
	server, _ := app(t)
	id := h.open(t, server, "/inputs")

	expectMatch(t, h.run(t, "fill", "-s", id, `textbox "Name"`, "Ada"), `^filled textbox "Name" \[uid=\w+\]$`)
	h.run(t, "press", "-s", id, "!")
	h.run(t, "fill", "-s", id, `combobox "Size"`, "Large")
	h.run(t, "hover", "-s", id, `button "Hover me"`)
	h.run(t, "drag", "-s", id, `button "Source"`, `button "Sink"`)

	state := `[document.getElementById("name").value, document.querySelector("select").value, document.body.dataset.from, document.body.dataset.to].join()`
	expect(t, h.run(t, "eval", "-s", id, state), "Ada!,Large,source,sink")
	expectContains(t, h.run(t, "snapshot", "-s", id), `button "Hovered"`)
}

func TestActionsPrintSnapshotsAndScreenshots(t *testing.T) {
	h := start(t)
	server, _ := app(t)
	id := h.open(t, server, "/inputs")

	got := h.run(t, "hover", "-s", id, `button "Hover me"`, "--snapshot", "--screenshot")

	lines := strings.Split(got, "\n")
	expectContains(t, got, `button "Hovered"`)
	pngWidth(t, lines[len(lines)-1])
}

func TestWaitFindsLateText(t *testing.T) {
	h := start(t)
	server, _ := app(t)
	id := h.run(t, "launch")
	h.run(t, "navigate", "-s", id, server.URL+"/later")

	expect(t, h.run(t, "wait", "-s", id, "Missing", "Ready"), `found "Ready"`)
	expect(t, h.fail(t, "wait", "-s", id, "--timeout", "300ms", "Missing"), `error: none of "Missing" appeared within 300ms`)
}

func expectMatch(t *testing.T, got, pattern string) {
	t.Helper()
	if !regexp.MustCompile(pattern).MatchString(got) {
		t.Fatalf("got %q, want match for %s", got, pattern)
	}
}
