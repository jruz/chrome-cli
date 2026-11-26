package version_test

import (
	"testing"

	"github.com/jruz/chrome-cli/internal/version"
)

func TestInfoString(t *testing.T) {
	info := version.Info{Version: "1.2.3", Revision: "abc1234", BuildTime: "2026-01-02 03:04:05 UTC"}

	got := info.String()

	want := "1.2.3 (abc1234, 2026-01-02 03:04:05 UTC)"
	if got != want {
		t.Fatalf("String() = %q, want %q", got, want)
	}
}
