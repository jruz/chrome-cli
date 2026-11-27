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
	ActionClick      = "click"
	ActionHover      = "hover"
	ActionFill       = "fill"
	ActionFillForm   = "fill-form"
	ActionPress      = "press"
	ActionDrag       = "drag"
	ActionScroll     = "scroll"
	ActionWait       = "wait"
	ActionConsole    = "console"
	ActionNetwork    = "network"
	ActionText       = "text"
	ActionPages      = "pages"
	ActionNewPage    = "new-page"
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

type ActionOptions struct {
	NoWait     bool          `json:"noWait"`
	WaitFor    []string      `json:"waitFor,omitempty"`
	Timeout    time.Duration `json:"timeout"`
	Snapshot   bool          `json:"snapshot"`
	Screenshot bool          `json:"screenshot"`
}

type Dialog struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

type Acted struct {
	Action      string       `json:"action"`
	Settled     bool         `json:"settled"`
	Dialogs     []Dialog     `json:"dialogs,omitempty"`
	Found       string       `json:"found,omitempty"`
	Snapshot    *Snapshot    `json:"snapshot,omitempty"`
	Screenshots *Screenshots `json:"screenshots,omitempty"`
}

type ClickParams struct {
	Target  string        `json:"target"`
	Double  bool          `json:"double"`
	Options ActionOptions `json:"options"`
}

type HoverParams struct {
	Target  string        `json:"target"`
	Options ActionOptions `json:"options"`
}

type FillParams struct {
	Target  string        `json:"target"`
	Value   string        `json:"value"`
	Options ActionOptions `json:"options"`
}

type Field struct {
	Target string `json:"target"`
	Value  string `json:"value"`
}

type FillFormParams struct {
	Fields  []Field       `json:"fields"`
	Submit  string        `json:"submit,omitempty"`
	Options ActionOptions `json:"options"`
}

type PressParams struct {
	Key     string        `json:"key"`
	Options ActionOptions `json:"options"`
}

type DragParams struct {
	From    string        `json:"from"`
	To      string        `json:"to"`
	Options ActionOptions `json:"options"`
}

type ScrollParams struct {
	Target  string        `json:"target,omitempty"`
	By      int           `json:"by,omitempty"`
	Options ActionOptions `json:"options"`
}

func (p ClickParams) Settings() ActionOptions    { return p.Options }
func (p HoverParams) Settings() ActionOptions    { return p.Options }
func (p FillParams) Settings() ActionOptions     { return p.Options }
func (p FillFormParams) Settings() ActionOptions { return p.Options }
func (p PressParams) Settings() ActionOptions    { return p.Options }
func (p DragParams) Settings() ActionOptions     { return p.Options }
func (p ScrollParams) Settings() ActionOptions   { return p.Options }

type WaitParams struct {
	Texts   []string      `json:"texts"`
	Timeout time.Duration `json:"timeout"`
}

type Found struct {
	Text string `json:"found"`
}

type ConsoleMessage struct {
	Level string `json:"level"`
	Text  string `json:"text"`
	Count int    `json:"count"`
}

type ConsoleParams struct {
	All bool `json:"all"`
}

type Console struct {
	Messages []ConsoleMessage `json:"messages"`
}

type NetworkRequest struct {
	Method string `json:"method"`
	URL    string `json:"url"`
	Type   string `json:"type"`
	Status int    `json:"status,omitempty"`
	Error  string `json:"error,omitempty"`
}

func (r NetworkRequest) Failed() bool {
	return r.Error != "" || r.Status >= 400
}

type NetworkParams struct {
	All bool `json:"all"`
}

type Network struct {
	Requests []NetworkRequest `json:"requests"`
}

type TextParams struct {
	Target string `json:"target,omitempty"`
	Max    int    `json:"max"`
}

type Text struct {
	Text      string `json:"text"`
	Truncated int    `json:"truncated,omitempty"`
}

type PageInfo struct {
	TargetID string `json:"targetId"`
	Title    string `json:"title"`
	URL      string `json:"url"`
	Selected bool   `json:"selected"`
}

type Pages struct {
	Pages []PageInfo `json:"pages"`
}

type NewPageParams struct {
	URL             string        `json:"url"`
	Background      bool          `json:"background"`
	IsolatedContext string        `json:"isolatedContext,omitempty"`
	Timeout         time.Duration `json:"timeout"`
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
