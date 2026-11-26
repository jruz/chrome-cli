package cli

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jruz/chrome-cli/internal/protocol"
)

type navigateCmd struct {
	target     `embed:""`
	URL        string        `arg:"" help:"URL to load."`
	Timeout    time.Duration `default:"10s" help:"How long to wait for the page and for refused connections."`
	InitScript string        `help:"JavaScript to run before every document loads."`
}

func (c navigateCmd) Run(a *app) error {
	var navigated protocol.Navigated
	params := protocol.NavigateParams{URL: c.URL, Timeout: c.Timeout, InitScript: c.InitScript}
	if err := a.client.Send(a.ctx, protocol.ActionNavigate, c.protocol(), params, &navigated); err != nil {
		return err
	}
	return a.printer.Print(navigated, location(navigated))
}

type reloadCmd struct {
	target      `embed:""`
	IgnoreCache bool          `help:"Bypass the cache."`
	Timeout     time.Duration `default:"10s" help:"How long to wait for the page."`
}

func (c reloadCmd) Run(a *app) error {
	var navigated protocol.Navigated
	params := protocol.ReloadParams{IgnoreCache: c.IgnoreCache, Timeout: c.Timeout}
	if err := a.client.Send(a.ctx, protocol.ActionReload, c.protocol(), params, &navigated); err != nil {
		return err
	}
	return a.printer.Print(navigated, location(navigated))
}

type backCmd struct {
	target  `embed:""`
	Timeout time.Duration `default:"10s" help:"How long to wait for the page."`
}

func (c backCmd) Run(a *app) error {
	var navigated protocol.Navigated
	params := protocol.BackParams{Timeout: c.Timeout}
	if err := a.client.Send(a.ctx, protocol.ActionBack, c.protocol(), params, &navigated); err != nil {
		return err
	}
	return a.printer.Print(navigated, location(navigated))
}

type snapshotCmd struct {
	target  `embed:""`
	Verbose bool   `help:"Include descriptions."`
	Path    string `type:"path" help:"Save the tree to this file and print its path."`
}

func (c snapshotCmd) Run(a *app) error {
	var snapshot protocol.Snapshot
	params := protocol.SnapshotParams{Verbose: c.Verbose, Path: c.Path}
	if err := a.client.Send(a.ctx, protocol.ActionSnapshot, c.protocol(), params, &snapshot); err != nil {
		return err
	}
	return a.printer.Print(snapshot, snapshotText(snapshot))
}

type screenshotCmd struct {
	target      `embed:""`
	Format      string   `default:"png" enum:"png,jpeg,webp" help:"Image format (png, jpeg, webp)."`
	Quality     int      `help:"Compression quality 0-100 for jpeg and webp."`
	FullPage    bool     `help:"Capture the whole scrollable page."`
	Path        string   `type:"path" help:"File to write, or directory for --viewport and --color-scheme lists."`
	Viewport    []string `sep:"," help:"Capture each viewport: mobile, desktop, or WxH."`
	ColorScheme []string `sep:"," enum:"light,dark" help:"Capture each color scheme: light, dark."`
}

func (c screenshotCmd) params() protocol.ScreenshotParams {
	return protocol.ScreenshotParams{
		Format:       c.Format,
		Quality:      c.Quality,
		FullPage:     c.FullPage,
		Path:         c.Path,
		Viewports:    c.Viewport,
		ColorSchemes: c.ColorScheme,
	}
}

func (c screenshotCmd) Run(a *app) error {
	var screenshots protocol.Screenshots
	if err := a.client.Send(a.ctx, protocol.ActionScreenshot, c.protocol(), c.params(), &screenshots); err != nil {
		return err
	}
	return a.printer.Print(screenshots, screenshots.Paths...)
}

type evalCmd struct {
	target     `embed:""`
	Expression string   `arg:"" help:"Expression, or a function receiving the --args elements."`
	Args       []string `sep:"," help:"Element uids from snapshot passed to the function."`
}

func (c evalCmd) Run(a *app) error {
	var evaluated protocol.Evaluated
	params := protocol.EvalParams{Expression: c.Expression, Args: c.Args}
	if err := a.client.Send(a.ctx, protocol.ActionEval, c.protocol(), params, &evaluated); err != nil {
		return err
	}
	return a.printer.Print(evaluated, value(evaluated))
}

type emulateCmd struct {
	target            `embed:""`
	Viewport          string  `help:"mobile (390x844, touch), desktop (1440x900), WxH, or reset."`
	DeviceScaleFactor float64 `default:"1" help:"Device pixel ratio for --viewport."`
	UserAgent         string  `help:"User agent string, or reset."`
	Geolocation       string  `help:"lat,lng such as 52.52,13.40, or reset."`
	ColorScheme       string  `help:"light, dark, or auto."`
	CPUThrottling     float64 `name:"cpu-throttling" help:"CPU slowdown factor, 1 for none."`
	NetworkConditions string  `help:"none, offline, slow-3g, fast-3g, slow-4g, or fast-4g."`
}

func (c emulateCmd) Run(a *app) error {
	var emulated protocol.Emulated
	params := protocol.EmulateParams{
		Viewport:          c.Viewport,
		DeviceScaleFactor: c.DeviceScaleFactor,
		UserAgent:         c.UserAgent,
		Geolocation:       c.Geolocation,
		ColorScheme:       c.ColorScheme,
		CPUThrottling:     c.CPUThrottling,
		NetworkConditions: c.NetworkConditions,
	}
	if err := a.client.Send(a.ctx, protocol.ActionEmulate, c.protocol(), params, &emulated); err != nil {
		return err
	}
	return a.printer.Print(emulated, "emulating "+strings.Join(emulated.Applied, ", "))
}

type oneshotCmd struct {
	Mode        string        `arg:"" enum:"snapshot,screenshot" help:"snapshot or screenshot."`
	URL         string        `arg:"" help:"URL to load."`
	Timeout     time.Duration `default:"10s" help:"How long to wait for the page."`
	Verbose     bool          `help:"Include descriptions in the snapshot."`
	Path        string        `type:"path" help:"File or directory to write."`
	Format      string        `default:"png" enum:"png,jpeg,webp" help:"Image format (png, jpeg, webp)."`
	Quality     int           `help:"Compression quality 0-100 for jpeg and webp."`
	FullPage    bool          `default:"true" negatable:"" help:"Capture the whole scrollable page."`
	Viewport    []string      `sep:"," help:"Capture each viewport: mobile, desktop, or WxH."`
	ColorScheme []string      `sep:"," enum:"light,dark" help:"Capture each color scheme: light, dark."`
}

func (c oneshotCmd) Run(a *app) error {
	params := protocol.OneshotParams{
		Mode:     c.Mode,
		URL:      c.URL,
		Timeout:  c.Timeout,
		Snapshot: protocol.SnapshotParams{Verbose: c.Verbose, Path: c.Path},
		Screenshot: protocol.ScreenshotParams{
			Format:       c.Format,
			Quality:      c.Quality,
			FullPage:     c.FullPage,
			Path:         c.Path,
			Viewports:    c.Viewport,
			ColorSchemes: c.ColorScheme,
		},
	}
	var result protocol.Oneshot
	if err := a.client.Send(a.ctx, protocol.ActionOneshot, nil, params, &result); err != nil {
		return err
	}
	if result.Snapshot != nil {
		return a.printer.Print(result, snapshotText(*result.Snapshot))
	}
	return a.printer.Print(result, result.Screenshots.Paths...)
}

func location(navigated protocol.Navigated) string {
	return fmt.Sprintf("%s — %s", navigated.Title, navigated.URL)
}

func snapshotText(snapshot protocol.Snapshot) string {
	if snapshot.Path != "" {
		return snapshot.Path
	}
	return snapshot.Tree
}

func value(evaluated protocol.Evaluated) string {
	if evaluated.Type == "undefined" {
		return "undefined"
	}
	var text string
	if err := json.Unmarshal(evaluated.Value, &text); err == nil {
		return text
	}
	return string(evaluated.Value)
}
