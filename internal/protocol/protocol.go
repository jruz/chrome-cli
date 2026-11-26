package protocol

import (
	"encoding/json"
	"fmt"
	"time"
)

const (
	ActionLaunch     = "launch"
	ActionKill       = "kill"
	ActionKillAll    = "kill-all"
	ActionStatus     = "status"
	ActionShutdown   = "shutdown"
	ActionNavigate   = "navigate"
	ActionReload     = "reload"
	ActionBack       = "back"
	ActionSnapshot   = "snapshot"
	ActionScreenshot = "screenshot"
	ActionEval       = "eval"
	ActionEmulate    = "emulate"
	ActionOneshot    = "oneshot"
)

type Request struct {
	Action string          `json:"action"`
	Target *Target         `json:"target,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
}

type Failure struct {
	Error string `json:"error"`
}

type Target struct {
	Session string `json:"session,omitempty"`
	Port    int    `json:"port,omitempty"`
}

func (t Target) Key() string {
	if t.Session != "" {
		return "session " + t.Session
	}
	return fmt.Sprintf("port %d", t.Port)
}

func (t Target) Directory() string {
	if t.Session != "" {
		return t.Session
	}
	return fmt.Sprintf("port-%d", t.Port)
}

type LaunchParams struct {
	Headless bool          `json:"headless"`
	URL      string        `json:"url,omitempty"`
	Timeout  time.Duration `json:"timeout,omitempty"`
}

type Launched struct {
	Session   string     `json:"session"`
	Navigated *Navigated `json:"navigated,omitempty"`
}

type Killed struct {
	Killed []Target `json:"killed"`
}

type Session struct {
	ID      string `json:"session"`
	Pid     int    `json:"pid"`
	Profile string `json:"profile"`
}

type Status struct {
	Pid      int       `json:"pid"`
	Sessions []Session `json:"sessions"`
	Ports    []int     `json:"ports"`
}

type NavigateParams struct {
	URL        string        `json:"url"`
	Timeout    time.Duration `json:"timeout"`
	InitScript string        `json:"initScript,omitempty"`
}

type ReloadParams struct {
	IgnoreCache bool          `json:"ignoreCache"`
	Timeout     time.Duration `json:"timeout"`
}

type BackParams struct {
	Timeout time.Duration `json:"timeout"`
}

type Navigated struct {
	Title string `json:"title"`
	URL   string `json:"url"`
}

type SnapshotParams struct {
	Verbose bool   `json:"verbose"`
	Path    string `json:"path,omitempty"`
}

type Snapshot struct {
	Tree string `json:"tree,omitempty"`
	Path string `json:"path,omitempty"`
}

type ScreenshotParams struct {
	Format       string   `json:"format"`
	Quality      int      `json:"quality,omitempty"`
	FullPage     bool     `json:"fullPage"`
	Path         string   `json:"path,omitempty"`
	Viewports    []string `json:"viewports,omitempty"`
	ColorSchemes []string `json:"colorSchemes,omitempty"`
}

type Screenshots struct {
	Paths []string `json:"paths"`
}

type EvalParams struct {
	Expression string   `json:"expression"`
	Args       []string `json:"args,omitempty"`
}

type Evaluated struct {
	Type  string          `json:"type"`
	Value json.RawMessage `json:"value,omitempty"`
}

type EmulateParams struct {
	Viewport          string  `json:"viewport,omitempty"`
	DeviceScaleFactor float64 `json:"deviceScaleFactor"`
	UserAgent         string  `json:"userAgent,omitempty"`
	Geolocation       string  `json:"geolocation,omitempty"`
	ColorScheme       string  `json:"colorScheme,omitempty"`
	CPUThrottling     float64 `json:"cpuThrottling,omitempty"`
	NetworkConditions string  `json:"networkConditions,omitempty"`
}

type Emulated struct {
	Applied []string `json:"applied"`
}

type OneshotParams struct {
	Mode       string           `json:"mode"`
	URL        string           `json:"url"`
	Timeout    time.Duration    `json:"timeout"`
	Snapshot   SnapshotParams   `json:"snapshot"`
	Screenshot ScreenshotParams `json:"screenshot"`
}

type Oneshot struct {
	Snapshot    *Snapshot    `json:"snapshot,omitempty"`
	Screenshots *Screenshots `json:"screenshots,omitempty"`
}
