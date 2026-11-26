package orphans

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	exitTimeout  = 5 * time.Second
	pollInterval = 50 * time.Millisecond
	daemonArg    = "daemon-serve"
)

var (
	chromeName = regexp.MustCompile(`^(?:chrome|google-chrome(?:-stable)?|chromium(?:-browser)?|\.chromium-wrapped)$`)
	profileArg = regexp.MustCompile(`^--user-data-dir=/.*/chrome-cli-[0-9]+$`)
	debugArg   = regexp.MustCompile(`^--remote-debugging-(?:port=\d+|pipe)$`)
)

type kind int

const (
	daemonProcess kind = iota + 1
	browserProcess
)

type process struct {
	pid   int
	inode uint64
	kind  kind
}

type Stopped struct {
	Daemons  []int `json:"daemons"`
	Browsers []int `json:"browsers"`
}

func Stop() (Stopped, error) {
	if runtime.GOOS != "linux" {
		return Stopped{}, errors.New("kill-all --include-orphans is only supported on Linux")
	}
	uid := os.Geteuid()
	daemons, err := stop(uid, daemonProcess)
	if err != nil {
		return Stopped{}, err
	}
	browsers, err := stop(uid, browserProcess)
	return Stopped{Daemons: daemons, Browsers: browsers}, err
}

func stop(uid int, wanted kind) ([]int, error) {
	found, err := scan(uid, wanted)
	if err != nil {
		return nil, err
	}
	signaled, err := terminate(found)
	if err != nil {
		return nil, err
	}
	if err := waitForExit(signaled, uid); err != nil {
		return nil, err
	}
	return pids(signaled), nil
}

func scan(uid int, wanted kind) ([]process, error) {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil, fmt.Errorf("scan /proc: %w", err)
	}
	var found []process
	for _, entry := range entries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}
		candidate, matched := inspect(pid, uid)
		if matched && candidate.kind == wanted {
			found = append(found, candidate)
		}
	}
	return found, nil
}

func inspect(pid, uid int) (process, bool) {
	directory := filepath.Join("/proc", strconv.Itoa(pid))
	info, err := os.Stat(directory)
	if err != nil {
		return process{}, false
	}
	stat := info.Sys().(*syscall.Stat_t)
	if int(stat.Uid) != uid {
		return process{}, false
	}
	cmdline, err := os.ReadFile(filepath.Join(directory, "cmdline"))
	if err != nil {
		return process{}, false
	}
	classified := classify(arguments(cmdline))
	return process{pid: pid, inode: stat.Ino, kind: classified}, classified != 0
}

func arguments(cmdline []byte) []string {
	trimmed := bytes.TrimSuffix(cmdline, []byte{0})
	return strings.Split(string(trimmed), "\x00")
}

func classify(argv []string) kind {
	name := filepath.Base(argv[0])
	if name == "chrome-cli" && len(argv) > 1 && argv[1] == daemonArg {
		return daemonProcess
	}
	if isOwnedBrowser(name, argv) {
		return browserProcess
	}
	return 0
}

func isOwnedBrowser(name string, argv []string) bool {
	return chromeName.MatchString(name) &&
		slices.ContainsFunc(argv, profileArg.MatchString) &&
		slices.ContainsFunc(argv, debugArg.MatchString) &&
		!slices.ContainsFunc(argv, func(arg string) bool { return strings.HasPrefix(arg, "--type=") })
}

func terminate(found []process) ([]process, error) {
	var signaled []process
	for _, target := range found {
		err := syscall.Kill(target.pid, syscall.SIGTERM)
		if errors.Is(err, syscall.ESRCH) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("signal %d: %w", target.pid, err)
		}
		signaled = append(signaled, target)
	}
	return signaled, nil
}

func waitForExit(signaled []process, uid int) error {
	deadline := time.Now().Add(exitTimeout)
	remaining := slices.Clone(signaled)
	for len(remaining) > 0 {
		if time.Now().After(deadline) {
			return fmt.Errorf("chrome-cli processes still running: %v", pids(remaining))
		}
		time.Sleep(pollInterval)
		remaining = slices.DeleteFunc(remaining, func(target process) bool { return !isSame(target, uid) })
	}
	return nil
}

func isSame(target process, uid int) bool {
	current, matched := inspect(target.pid, uid)
	return matched && current.inode == target.inode && current.kind == target.kind
}

func pids(processes []process) []int {
	result := make([]int, len(processes))
	for index, target := range processes {
		result[index] = target.pid
	}
	return result
}
