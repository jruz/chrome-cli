package daemon_test

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/jruz/chrome-cli/internal/cli"
	"github.com/jruz/chrome-cli/internal/client"
	"github.com/jruz/chrome-cli/internal/protocol"
)

const exitTimeout = 10 * time.Second

func TestMain(m *testing.M) {
	if len(os.Args) > 1 && os.Args[1] == "daemon-serve" {
		os.Exit(cli.Run(os.Args[1:]))
	}
	os.Exit(m.Run())
}

type harness struct {
	dir    string
	client client.Client
}

func start(t *testing.T, flags ...string) harness {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatalf("locate test binary: %v", err)
	}
	dir := t.TempDir()
	if err := os.Chmod(dir, 0o700); err != nil {
		t.Fatalf("restrict runtime dir: %v", err)
	}
	command := append([]string{executable, "daemon-serve", "--runtime-dir", dir}, flags...)
	h := harness{dir: dir, client: client.New(dir, command)}
	t.Cleanup(func() { h.stop(t) })
	return h
}

func (h harness) stop(t *testing.T) {
	_, running, err := h.client.Status(context.Background())
	if err != nil || !running {
		return
	}
	if _, err := h.client.Stop(context.Background()); err != nil {
		t.Errorf("stop daemon: %v", err)
	}
}

func (h harness) launch(t *testing.T) protocol.Session {
	t.Helper()
	var launched protocol.Launched
	if err := h.client.Send(context.Background(), protocol.ActionLaunch, protocol.LaunchParams{Headless: true}, &launched); err != nil {
		t.Fatalf("launch: %v", err)
	}
	return h.session(t, launched.Session)
}

func (h harness) status(t *testing.T) protocol.Status {
	t.Helper()
	status, running, err := h.client.Status(context.Background())
	if err != nil || !running {
		t.Fatalf("status: running=%v err=%v", running, err)
	}
	return status
}

func (h harness) session(t *testing.T, id string) protocol.Session {
	t.Helper()
	for _, session := range h.status(t).Sessions {
		if session.ID == id {
			return session
		}
	}
	t.Fatalf("session %s missing from status", id)
	return protocol.Session{}
}

func TestSigkillOnDaemonLeavesNoOwnedChromeRunning(t *testing.T) {
	h := start(t)
	session := h.launch(t)
	tree := processTree(t, session.Pid)

	if err := syscall.Kill(h.status(t).Pid, syscall.SIGKILL); err != nil {
		t.Fatalf("kill daemon: %v", err)
	}

	waitForExit(t, tree)
}

func TestSigtermClosesOwnedBrowsersAndRemovesProfiles(t *testing.T) {
	h := start(t)
	session := h.launch(t)
	tree := processTree(t, session.Pid)

	if err := syscall.Kill(h.status(t).Pid, syscall.SIGTERM); err != nil {
		t.Fatalf("terminate daemon: %v", err)
	}

	waitForExit(t, tree)
	waitFor(t, func() bool { return len(daemons(t, h.dir)) == 0 })
	if _, err := os.Stat(session.Profile); !os.IsNotExist(err) {
		t.Fatalf("profile %s still exists: %v", session.Profile, err)
	}
}

func TestKillByPortClosesExternalChrome(t *testing.T) {
	h := start(t)
	external := startUnrelatedChrome(t)

	var killed protocol.Killed
	params := protocol.KillParams{Target: protocol.Target{Port: external.port}}
	if err := h.client.Send(context.Background(), protocol.ActionKill, params, &killed); err != nil {
		t.Fatalf("kill --port: %v", err)
	}

	waitForExit(t, []int{external.command.Process.Pid})
}

func TestKillAllLeavesUnrelatedChromeRunning(t *testing.T) {
	h := start(t)
	unrelated := startUnrelatedChrome(t)
	session := h.launch(t)
	tree := processTree(t, session.Pid)

	var killed protocol.Killed
	if err := h.client.Send(context.Background(), protocol.ActionKillAll, nil, &killed); err != nil {
		t.Fatalf("kill-all: %v", err)
	}

	waitForExit(t, tree)
	if !running(unrelated.command.Process.Pid) {
		t.Fatalf("unrelated Chrome %d stopped", unrelated.command.Process.Pid)
	}
}

func TestParallelColdStartProducesOneDaemon(t *testing.T) {
	h := start(t)
	var group sync.WaitGroup
	for range 8 {
		group.Go(func() {
			if err := h.client.Ensure(context.Background()); err != nil {
				t.Errorf("ensure daemon: %v", err)
			}
		})
	}
	group.Wait()

	waitFor(t, func() bool { return len(daemons(t, h.dir)) == 1 })
	if got := daemons(t, h.dir); got[0] != h.status(t).Pid {
		t.Fatalf("daemon processes %v, status pid %d", got, h.status(t).Pid)
	}
}

func TestParallelLaunchesCannotExceedTheLimit(t *testing.T) {
	h := start(t)
	errs := make(chan error, 10)
	var group sync.WaitGroup
	for range 10 {
		group.Go(func() {
			var launched protocol.Launched
			errs <- h.client.Send(context.Background(), protocol.ActionLaunch, protocol.LaunchParams{Headless: true}, &launched)
		})
	}
	group.Wait()
	close(errs)

	limited := 0
	for err := range errs {
		if err != nil && !strings.Contains(err.Error(), "browser limit reached (8/8)") {
			t.Fatalf("launch: %v", err)
		}
		if err != nil {
			limited++
		}
	}
	if limited != 2 || len(h.status(t).Sessions) != 8 {
		t.Fatalf("limited %d launches with %d sessions, want 2 and 8", limited, len(h.status(t).Sessions))
	}
}

func TestIdleExpiryClosesTheBrowserAndRemovesItsProfile(t *testing.T) {
	h := start(t, "--idle-timeout", "300ms", "--reap-interval", "50ms")
	session := h.launch(t)
	tree := processTree(t, session.Pid)

	waitFor(t, func() bool { return len(h.status(t).Sessions) == 0 })

	waitForExit(t, tree)
	if _, err := os.Stat(session.Profile); !os.IsNotExist(err) {
		t.Fatalf("profile %s still exists: %v", session.Profile, err)
	}
}

type externalChrome struct {
	command *exec.Cmd
	port    int
}

func startUnrelatedChrome(t *testing.T) externalChrome {
	t.Helper()
	profile := t.TempDir()
	command := exec.Command(os.Getenv("CHROME_PATH"),
		"--headless=new",
		"--remote-debugging-port=0",
		"--user-data-dir="+profile,
		"about:blank",
	)
	if err := command.Start(); err != nil {
		t.Fatalf("start unrelated Chrome: %v", err)
	}
	t.Cleanup(func() {
		command.Process.Kill()
		command.Wait()
	})
	return externalChrome{command: command, port: debuggingPort(t, profile)}
}

func debuggingPort(t *testing.T, profile string) int {
	t.Helper()
	path := filepath.Join(profile, "DevToolsActivePort")
	waitFor(t, func() bool {
		_, err := os.Stat(path)
		return err == nil
	})
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	port, err := strconv.Atoi(strings.SplitN(string(raw), "\n", 2)[0])
	if err != nil {
		t.Fatalf("parse port from %s: %v", path, err)
	}
	return port
}

func processTree(t *testing.T, pid int) []int {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "task", strconv.Itoa(pid), "children"))
	if err != nil {
		t.Fatalf("read children of %d: %v", pid, err)
	}
	tree := []int{pid}
	for _, field := range strings.Fields(string(raw)) {
		child, err := strconv.Atoi(field)
		if err != nil {
			t.Fatalf("parse child pid %q: %v", field, err)
		}
		tree = append(tree, processTree(t, child)...)
	}
	return tree
}

func running(pid int) bool {
	stat, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "stat"))
	if err != nil {
		return false
	}
	fields := strings.Fields(string(stat[strings.LastIndexByte(string(stat), ')')+1:]))
	return fields[0] != "Z" && fields[0] != "X"
}

func waitForExit(t *testing.T, pids []int) {
	t.Helper()
	waitFor(t, func() bool {
		for _, pid := range pids {
			if running(pid) {
				return false
			}
		}
		return true
	})
}

func waitFor(t *testing.T, done func() bool) {
	t.Helper()
	deadline := time.Now().Add(exitTimeout)
	for !done() {
		if time.Now().After(deadline) {
			t.Fatalf("condition not met within %s", exitTimeout)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func daemons(t *testing.T, dir string) []int {
	t.Helper()
	entries, err := os.ReadDir("/proc")
	if err != nil {
		t.Fatalf("scan /proc: %v", err)
	}
	var found []int
	for _, entry := range entries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil || !running(pid) {
			continue
		}
		cmdline, err := os.ReadFile(filepath.Join("/proc", entry.Name(), "cmdline"))
		if err == nil && strings.Contains(string(cmdline), "daemon-serve\x00--runtime-dir\x00"+dir) {
			found = append(found, pid)
		}
	}
	return found
}
