package commands

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"

	"github.com/jruz/chrome-cli/internal/page"
	"github.com/jruz/chrome-cli/internal/protocol"
)

type shot struct {
	viewport    *Viewport
	colorScheme string
	name        string
}

type layoutMetrics struct {
	CSSContentSize struct {
		Width  float64 `json:"width"`
		Height float64 `json:"height"`
	} `json:"cssContentSize"`
}

type captured struct {
	Data string `json:"data"`
}

func Screenshot(ctx context.Context, p *page.Page, params protocol.ScreenshotParams, current Emulation, auto string) (protocol.Screenshots, error) {
	if len(params.Viewports) == 0 && len(params.ColorSchemes) == 0 {
		path := params.Path
		if path == "" {
			path = auto + "." + params.Format
		}
		return protocol.Screenshots{Paths: []string{path}}, capture(ctx, p, params, path)
	}
	shots, err := matrix(params, current)
	if err != nil {
		return protocol.Screenshots{}, err
	}
	directory := params.Path
	if directory == "" {
		directory = auto
	}
	paths, captureErr := captureMatrix(ctx, p, params, shots, directory)
	restoreErr := Restore(ctx, p, current)
	return protocol.Screenshots{Paths: paths}, errors.Join(captureErr, restoreErr)
}

func matrix(params protocol.ScreenshotParams, current Emulation) ([]shot, error) {
	viewports, err := viewportsFor(params.Viewports, current)
	if err != nil {
		return nil, err
	}
	schemes := params.ColorSchemes
	if len(schemes) == 0 {
		schemes = []string{current.ColorScheme}
	}
	var shots []shot
	for _, viewport := range viewports {
		for _, scheme := range schemes {
			shots = append(shots, shot{viewport: viewport, colorScheme: scheme, name: shotName(params, viewport, scheme)})
		}
	}
	return shots, nil
}

func viewportsFor(names []string, current Emulation) ([]*Viewport, error) {
	if len(names) == 0 {
		return []*Viewport{current.Viewport}, nil
	}
	viewports := make([]*Viewport, len(names))
	for index, name := range names {
		viewport, err := ParseViewport(name, 1)
		if err != nil {
			return nil, err
		}
		viewports[index] = &viewport
	}
	return viewports, nil
}

func shotName(params protocol.ScreenshotParams, viewport *Viewport, scheme string) string {
	var parts []string
	if len(params.Viewports) > 0 {
		parts = append(parts, viewport.Name)
	}
	if len(params.ColorSchemes) > 0 {
		parts = append(parts, scheme)
	}
	return strings.Join(parts, "-")
}

func captureMatrix(ctx context.Context, p *page.Page, params protocol.ScreenshotParams, shots []shot, directory string) ([]string, error) {
	paths := make([]string, 0, len(shots))
	for _, current := range shots {
		if err := ApplyViewport(ctx, p, current.viewport); err != nil {
			return paths, err
		}
		if err := ApplyColorScheme(ctx, p, current.colorScheme); err != nil {
			return paths, err
		}
		path := filepath.Join(directory, current.name+"."+params.Format)
		if err := capture(ctx, p, params, path); err != nil {
			return paths, err
		}
		paths = append(paths, path)
	}
	return paths, nil
}

func capture(ctx context.Context, p *page.Page, params protocol.ScreenshotParams, path string) error {
	if err := p.Settled(ctx); err != nil {
		return err
	}
	options, err := captureOptions(ctx, p, params)
	if err != nil {
		return err
	}
	var result captured
	if err := p.Call(ctx, "Page.captureScreenshot", options, &result); err != nil {
		return err
	}
	image, err := base64.StdEncoding.DecodeString(result.Data)
	if err != nil {
		return fmt.Errorf("decode screenshot: %w", err)
	}
	return save(path, image)
}

func captureOptions(ctx context.Context, p *page.Page, params protocol.ScreenshotParams) (map[string]any, error) {
	options := map[string]any{"format": params.Format}
	if params.Quality > 0 && params.Format != "png" {
		options["quality"] = params.Quality
	}
	if !params.FullPage {
		return options, nil
	}
	var metrics layoutMetrics
	if err := p.Call(ctx, "Page.getLayoutMetrics", nil, &metrics); err != nil {
		return nil, err
	}
	options["captureBeyondViewport"] = true
	options["clip"] = map[string]float64{
		"x":      0,
		"y":      0,
		"width":  math.Ceil(metrics.CSSContentSize.Width),
		"height": math.Ceil(metrics.CSSContentSize.Height),
		"scale":  1,
	}
	return options, nil
}

func save(path string, image []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create screenshot directory: %w", err)
	}
	if err := os.WriteFile(path, image, 0o600); err != nil {
		return fmt.Errorf("save screenshot: %w", err)
	}
	return nil
}
