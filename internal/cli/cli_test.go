package cli_test

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/jruz/chrome-cli/internal/cli"
	"github.com/jruz/chrome-cli/internal/protocol"
)

func TestMain(m *testing.M) {
	if len(os.Args) > 1 && os.Args[1] == "daemon-serve" {
		os.Exit(cli.Main(os.Args[1:], cli.Env{Out: os.Stdout, Err: os.Stderr}))
	}
	os.Exit(m.Run())
}

const home = `<!doctype html><meta name="viewport" content="width=device-width"><title>Home</title><h1>Hello</h1><button>Save</button><a href="/next">Next</a>`

func site(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, home) })
	mux.HandleFunc("/next", func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, `<!doctype html><title>Next</title><p>Second page</p>`)
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

type harness struct {
	env cli.Env
}

func start(t *testing.T) harness {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatalf("locate test binary: %v", err)
	}
	dir := t.TempDir()
	if err := os.Chmod(dir, 0o700); err != nil {
		t.Fatalf("restrict runtime dir: %v", err)
	}
	h := harness{env: cli.Env{RuntimeDir: dir, Daemon: []string{executable, "daemon-serve", "--runtime-dir", dir}}}
	t.Cleanup(func() { h.exec("daemon-stop") })
	return h
}

func (h harness) exec(args ...string) (string, string, int) {
	var out, errOut bytes.Buffer
	env := h.env
	env.Out = &out
	env.Err = &errOut
	code := cli.Main(args, env)
	return strings.TrimSuffix(out.String(), "\n"), strings.TrimSuffix(errOut.String(), "\n"), code
}

func (h harness) run(t *testing.T, args ...string) string {
	t.Helper()
	out, errOut, code := h.exec(args...)
	if code != 0 {
		t.Fatalf("chrome-cli %s: exit %d: %s", strings.Join(args, " "), code, errOut)
	}
	return out
}

func (h harness) fail(t *testing.T, args ...string) string {
	t.Helper()
	_, errOut, code := h.exec(args...)
	if code != 1 {
		t.Fatalf("chrome-cli %s: exit %d, want 1", strings.Join(args, " "), code)
	}
	return errOut
}

func (h harness) json(t *testing.T, result any, args ...string) {
	t.Helper()
	out := h.run(t, append([]string{"--json"}, args...)...)
	if err := json.Unmarshal([]byte(out), result); err != nil {
		t.Fatalf("decode %q: %v", out, err)
	}
}

func (h harness) launch(t *testing.T) string {
	t.Helper()
	return h.run(t, "launch")
}

func expect(t *testing.T, got, want string) {
	t.Helper()
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func expectContains(t *testing.T, got, want string) {
	t.Helper()
	if !strings.Contains(got, want) {
		t.Fatalf("got %q, want it to contain %q", got, want)
	}
}

func TestLaunchWithURLLoadsThePage(t *testing.T) {
	h := start(t)
	server := site(t)

	id := h.run(t, "launch", "--url", server.URL)

	expect(t, h.run(t, "eval", "-s", id, "document.title"), "Home")
}

func TestNavigatePrintsTitleAndURL(t *testing.T) {
	h := start(t)
	server := site(t)
	id := h.launch(t)

	expect(t, h.run(t, "navigate", "-s", id, server.URL+"/next"), "Next — "+server.URL+"/next")
	var navigated protocol.Navigated
	h.json(t, &navigated, "navigate", "-s", id, server.URL)
	expect(t, navigated.Title+" "+navigated.URL, "Home "+server.URL+"/")
}

func TestNavigateWaitsForALateServer(t *testing.T) {
	h := start(t)
	id := h.launch(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve port: %v", err)
	}
	address := listener.Addr().String()
	listener.Close()
	go serveLater(t, address, 2*time.Second)

	got := h.run(t, "navigate", "-s", id, "http://"+address+"/")

	expect(t, got, "Home — http://"+address+"/")
}

func serveLater(t *testing.T, address string, delay time.Duration) {
	time.Sleep(delay)
	listener, err := net.Listen("tcp", address)
	if err != nil {
		t.Errorf("listen late: %v", err)
		return
	}
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, home) })}
	t.Cleanup(func() { server.Close() })
	server.Serve(listener)
}

func TestNavigateReportsUnreachableURLs(t *testing.T) {
	h := start(t)
	id := h.launch(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve port: %v", err)
	}
	url := "http://" + listener.Addr().String() + "/"
	listener.Close()

	got := h.fail(t, "navigate", "-s", id, "--timeout", "1s", url)

	expect(t, got, "error: "+url+" not reachable after 1s")
}

func TestBackAndReloadReturnToThePage(t *testing.T) {
	h := start(t)
	server := site(t)
	id := h.launch(t)
	h.run(t, "navigate", "-s", id, server.URL)
	h.run(t, "navigate", "-s", id, server.URL+"/next")

	expect(t, h.run(t, "back", "-s", id), "Home — "+server.URL+"/")
	expect(t, h.run(t, "reload", "-s", id, "--ignore-cache"), "Home — "+server.URL+"/")
}

func TestUnknownSessionPointsToLaunch(t *testing.T) {
	h := start(t)

	got := h.fail(t, "navigate", "-s", "nope", "about:blank")

	expect(t, got, "error: session nope not found (run chrome-cli launch)")
}

var saveButton = regexp.MustCompile(`button "Save" \[uid=(\w+)\]`)

func TestSnapshotPrintsTheTreeWithUIDs(t *testing.T) {
	h := start(t)
	server := site(t)
	id := h.run(t, "launch", "--url", server.URL)

	expectContains(t, h.run(t, "snapshot", "-s", id), `heading "Hello"`)
	var snapshot protocol.Snapshot
	h.json(t, &snapshot, "snapshot", "-s", id)
	if !saveButton.MatchString(snapshot.Tree) {
		t.Fatalf("tree %q has no Save button uid", snapshot.Tree)
	}
	path := filepath.Join(t.TempDir(), "tree.txt")
	expect(t, h.run(t, "snapshot", "-s", id, "--path", path), path)
	saved, err := os.ReadFile(path)
	if err != nil || !saveButton.Match(saved) {
		t.Fatalf("saved snapshot %q: %v", saved, err)
	}
}

func TestEvalPrintsValues(t *testing.T) {
	h := start(t)
	server := site(t)
	id := h.run(t, "launch", "--url", server.URL)

	expect(t, h.run(t, "eval", "-s", id, "1 + 1"), "2")
	expect(t, h.run(t, "eval", "-s", id, "document.title"), "Home")
	expect(t, h.run(t, "eval", "-s", id, "void 0"), "undefined")
	var evaluated protocol.Evaluated
	h.json(t, &evaluated, "eval", "-s", id, "({ answer: 42 })")
	expect(t, evaluated.Type+" "+string(evaluated.Value), `object {"answer":42}`)
}

func TestEvalPassesSnapshotElements(t *testing.T) {
	h := start(t)
	server := site(t)
	id := h.run(t, "launch", "--url", server.URL)
	uid := saveButton.FindStringSubmatch(h.run(t, "snapshot", "-s", id))[1]

	got := h.run(t, "eval", "-s", id, "--args", uid, "(button) => button.textContent")

	expect(t, got, "Save")
}

func TestEvalReportsExceptions(t *testing.T) {
	h := start(t)
	id := h.launch(t)

	got := h.fail(t, "eval", "-s", id, `(() => { throw new Error("boom") })()`)

	expectContains(t, got, "Error: boom")
}

func TestScreenshotDefaultsToAPNGUnderTheSessionDirectory(t *testing.T) {
	h := start(t)
	server := site(t)
	id := h.run(t, "launch", "--url", server.URL)

	path := h.run(t, "screenshot", "-s", id)

	expect(t, path, filepath.Join(os.TempDir(), "chrome-cli", id, "1.png"))
	pngWidth(t, path)
	var screenshots protocol.Screenshots
	h.json(t, &screenshots, "screenshot", "-s", id, "--format", "jpeg")
	expect(t, strings.Join(screenshots.Paths, ","), filepath.Join(os.TempDir(), "chrome-cli", id, "2.jpeg"))
}

func TestScreenshotMatrixWritesNamedFilesAndRestoresEmulation(t *testing.T) {
	h := start(t)
	server := site(t)
	id := h.run(t, "launch", "--url", server.URL)
	h.run(t, "emulate", "-s", id, "--viewport", "800x600", "--color-scheme", "light")
	directory := t.TempDir()

	got := h.run(t, "screenshot", "-s", id, "--viewport", "mobile,desktop", "--color-scheme", "light,dark", "--path", directory)

	names := []string{"mobile-light", "mobile-dark", "desktop-light", "desktop-dark"}
	widths := []uint32{390, 390, 1440, 1440}
	var want []string
	for index, name := range names {
		path := filepath.Join(directory, name+".png")
		want = append(want, path)
		if width := pngWidth(t, path); width != widths[index] {
			t.Fatalf("%s width %d, want %d", name, width, widths[index])
		}
	}
	expect(t, got, strings.Join(want, "\n"))
	expect(t, h.run(t, "eval", "-s", id, "innerWidth"), "800")
	expect(t, h.run(t, "eval", "-s", id, "matchMedia('(prefers-color-scheme: dark)').matches"), "false")
}

func TestEmulateAppliesViewportPresets(t *testing.T) {
	h := start(t)
	server := site(t)
	id := h.run(t, "launch", "--url", server.URL)

	expect(t, h.run(t, "emulate", "-s", id, "--viewport", "mobile", "--color-scheme", "dark"), "emulating viewport mobile, color-scheme dark")

	expect(t, h.run(t, "eval", "-s", id, "[innerWidth, navigator.maxTouchPoints > 0, matchMedia('(prefers-color-scheme: dark)').matches].join()"), "390,true,true")
	var emulated protocol.Emulated
	h.json(t, &emulated, "emulate", "-s", id, "--viewport", "desktop")
	expect(t, strings.Join(emulated.Applied, ","), "viewport desktop")
	expect(t, h.run(t, "eval", "-s", id, "innerWidth"), "1440")
}

func TestOneshotCapturesAndCloses(t *testing.T) {
	h := start(t)
	server := site(t)

	expectContains(t, h.run(t, "oneshot", "snapshot", server.URL), `heading "Hello"`)
	var result protocol.Oneshot
	h.json(t, &result, "oneshot", "screenshot", server.URL)
	pngWidth(t, result.Screenshots.Paths[0])
	expect(t, h.run(t, "daemon-status"), statusLine(t, h))
}

func statusLine(t *testing.T, h harness) string {
	t.Helper()
	var status struct {
		Pid int `json:"pid"`
	}
	h.json(t, &status, "daemon-status")
	return fmt.Sprintf("daemon running %d", status.Pid)
}

func pngWidth(t *testing.T, path string) uint32 {
	t.Helper()
	image, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if !bytes.HasPrefix(image, []byte("\x89PNG")) {
		t.Fatalf("%s is not a PNG", path)
	}
	return binary.BigEndian.Uint32(image[16:20])
}
