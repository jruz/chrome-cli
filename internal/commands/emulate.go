package commands

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/jruz/chrome-cli/internal/page"
	"github.com/jruz/chrome-cli/internal/protocol"
)

const reset = "reset"

type Viewport struct {
	Name   string
	Width  int
	Height int
	Mobile bool
	Scale  float64
}

type Emulation struct {
	Viewport    *Viewport
	ColorScheme string
}

type network struct {
	Offline            bool    `json:"offline"`
	Latency            float64 `json:"latency"`
	DownloadThroughput float64 `json:"downloadThroughput"`
	UploadThroughput   float64 `json:"uploadThroughput"`
}

var networkPresets = map[string]network{
	"none":    {DownloadThroughput: -1, UploadThroughput: -1},
	"offline": {Offline: true},
	"slow-3g": {Latency: 2000, DownloadThroughput: 50000, UploadThroughput: 50000},
	"fast-3g": {Latency: 562, DownloadThroughput: 180000, UploadThroughput: 84375},
	"slow-4g": {Latency: 300, DownloadThroughput: 400000, UploadThroughput: 150000},
	"fast-4g": {Latency: 100, DownloadThroughput: 3000000, UploadThroughput: 1500000},
}

func ParseViewport(name string, scale float64) (Viewport, error) {
	switch name {
	case "mobile":
		return Viewport{Name: name, Width: 390, Height: 844, Mobile: true, Scale: scale}, nil
	case "desktop":
		return Viewport{Name: name, Width: 1440, Height: 900, Scale: scale}, nil
	}
	width, height, found := strings.Cut(name, "x")
	w, widthErr := strconv.Atoi(width)
	h, heightErr := strconv.Atoi(height)
	if !found || widthErr != nil || heightErr != nil || w <= 0 || h <= 0 {
		return Viewport{}, fmt.Errorf("invalid viewport %q (use mobile, desktop, or WxH such as 1024x768)", name)
	}
	return Viewport{Name: name, Width: w, Height: h, Scale: scale}, nil
}

func Emulate(ctx context.Context, p *page.Page, params protocol.EmulateParams, current Emulation) (Emulation, protocol.Emulated, error) {
	next := current
	var applied []string
	steps := []struct {
		name  string
		set   bool
		apply func() error
	}{
		{"viewport " + params.Viewport, params.Viewport != "", func() error { return emulateViewport(ctx, p, params, &next) }},
		{"user-agent", params.UserAgent != "", func() error { return emulateUserAgent(ctx, p, params.UserAgent) }},
		{"geolocation " + params.Geolocation, params.Geolocation != "", func() error { return emulateGeolocation(ctx, p, params.Geolocation) }},
		{"color-scheme " + params.ColorScheme, params.ColorScheme != "", func() error { return emulateColorScheme(ctx, p, params.ColorScheme, &next) }},
		{fmt.Sprintf("cpu-throttling %g", params.CPUThrottling), params.CPUThrottling != 0, func() error { return emulateCPU(ctx, p, params.CPUThrottling) }},
		{"network-conditions " + params.NetworkConditions, params.NetworkConditions != "", func() error { return emulateNetwork(ctx, p, params.NetworkConditions) }},
	}
	for _, step := range steps {
		if !step.set {
			continue
		}
		if err := step.apply(); err != nil {
			return current, protocol.Emulated{}, err
		}
		applied = append(applied, step.name)
	}
	if len(applied) == 0 {
		return current, protocol.Emulated{}, fmt.Errorf("nothing to emulate (pass --viewport, --color-scheme, or another option)")
	}
	return next, protocol.Emulated{Applied: applied}, nil
}

func Restore(ctx context.Context, p *page.Page, emulation Emulation) error {
	if err := ApplyViewport(ctx, p, emulation.Viewport); err != nil {
		return err
	}
	return ApplyColorScheme(ctx, p, emulation.ColorScheme)
}

func ApplyViewport(ctx context.Context, p *page.Page, viewport *Viewport) error {
	if viewport == nil {
		if err := p.Call(ctx, "Emulation.clearDeviceMetricsOverride", nil, nil); err != nil {
			return err
		}
		return setTouch(ctx, p, false)
	}
	metrics := map[string]any{
		"width":             viewport.Width,
		"height":            viewport.Height,
		"deviceScaleFactor": viewport.Scale,
		"mobile":            viewport.Mobile,
	}
	if err := p.Call(ctx, "Emulation.setDeviceMetricsOverride", metrics, nil); err != nil {
		return err
	}
	return setTouch(ctx, p, viewport.Mobile)
}

func ApplyColorScheme(ctx context.Context, p *page.Page, scheme string) error {
	features := []map[string]string{}
	if scheme != "" {
		features = append(features, map[string]string{"name": "prefers-color-scheme", "value": scheme})
	}
	return p.Call(ctx, "Emulation.setEmulatedMedia", map[string]any{"features": features}, nil)
}

func setTouch(ctx context.Context, p *page.Page, enabled bool) error {
	params := map[string]any{"enabled": enabled, "maxTouchPoints": 5}
	return p.Call(ctx, "Emulation.setTouchEmulationEnabled", params, nil)
}

func emulateViewport(ctx context.Context, p *page.Page, params protocol.EmulateParams, next *Emulation) error {
	if params.Viewport == reset {
		next.Viewport = nil
		return ApplyViewport(ctx, p, nil)
	}
	viewport, err := ParseViewport(params.Viewport, params.DeviceScaleFactor)
	if err != nil {
		return err
	}
	next.Viewport = &viewport
	return ApplyViewport(ctx, p, &viewport)
}

func emulateColorScheme(ctx context.Context, p *page.Page, scheme string, next *Emulation) error {
	if scheme != "light" && scheme != "dark" && scheme != "auto" {
		return fmt.Errorf("invalid color scheme %q (use light, dark, or auto)", scheme)
	}
	if scheme == "auto" {
		next.ColorScheme = ""
		return ApplyColorScheme(ctx, p, "")
	}
	next.ColorScheme = scheme
	return ApplyColorScheme(ctx, p, scheme)
}

func emulateUserAgent(ctx context.Context, p *page.Page, userAgent string) error {
	if userAgent == reset {
		userAgent = ""
	}
	return p.Call(ctx, "Emulation.setUserAgentOverride", map[string]string{"userAgent": userAgent}, nil)
}

func emulateGeolocation(ctx context.Context, p *page.Page, value string) error {
	if value == reset {
		return p.Call(ctx, "Emulation.clearGeolocationOverride", nil, nil)
	}
	latitude, longitude, found := strings.Cut(value, ",")
	lat, latErr := strconv.ParseFloat(latitude, 64)
	lng, lngErr := strconv.ParseFloat(longitude, 64)
	if !found || latErr != nil || lngErr != nil {
		return fmt.Errorf("invalid geolocation %q (use lat,lng such as 52.52,13.40)", value)
	}
	params := map[string]float64{"latitude": lat, "longitude": lng, "accuracy": 1}
	return p.Call(ctx, "Emulation.setGeolocationOverride", params, nil)
}

func emulateCPU(ctx context.Context, p *page.Page, rate float64) error {
	return p.Call(ctx, "Emulation.setCPUThrottlingRate", map[string]float64{"rate": rate}, nil)
}

func emulateNetwork(ctx context.Context, p *page.Page, preset string) error {
	conditions, found := networkPresets[preset]
	if !found {
		return fmt.Errorf("invalid network conditions %q (use none, offline, slow-3g, fast-3g, slow-4g, or fast-4g)", preset)
	}
	if err := p.Call(ctx, "Network.enable", nil, nil); err != nil {
		return err
	}
	return p.Call(ctx, "Network.emulateNetworkConditions", conditions, nil)
}
