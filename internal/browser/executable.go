package browser

import (
	"errors"
	"os"
	"os/exec"
	"runtime"
	"slices"
)

var ErrChromeNotFound = errors.New("chrome/chromium not found (set CHROME_PATH or install Chrome/Chromium)")

var darwinPaths = []string{
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
}

var linuxNames = []string{
	"google-chrome-stable",
	"google-chrome",
	"chromium-browser",
	"chromium",
}

func executable() (string, error) {
	if path, found := os.LookupEnv("CHROME_PATH"); found {
		return exec.LookPath(path)
	}
	candidates := platformCandidates()
	index := slices.IndexFunc(candidates, isExecutable)
	if index < 0 {
		return "", ErrChromeNotFound
	}
	return exec.LookPath(candidates[index])
}

func platformCandidates() []string {
	if runtime.GOOS == "darwin" {
		return darwinPaths
	}
	return linuxNames
}

func isExecutable(candidate string) bool {
	_, err := exec.LookPath(candidate)
	return err == nil
}
