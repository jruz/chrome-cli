package daemon

import (
	"io"
	"log/slog"
)

func newLogger(output io.Writer) *slog.Logger {
	options := &slog.HandlerOptions{ReplaceAttr: severity}
	return slog.New(slog.NewJSONHandler(output, options))
}

func severity(groups []string, attr slog.Attr) slog.Attr {
	if len(groups) == 0 && attr.Key == slog.LevelKey {
		attr.Key = "severity"
	}
	return attr
}
