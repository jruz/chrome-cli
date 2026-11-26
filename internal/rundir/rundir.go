package rundir

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

func Default() string {
	return fmt.Sprintf("/tmp/chrome-cli-%d", os.Getuid())
}

func Socket(dir string) string {
	return filepath.Join(dir, "daemon.sock")
}

func Lock(dir string) string {
	return filepath.Join(dir, "daemon.lock")
}

func Log(dir string) string {
	return filepath.Join(dir, "daemon.log")
}

func Ensure(dir string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create %s: %w", dir, err)
	}
	info, err := os.Lstat(dir)
	if err != nil {
		return fmt.Errorf("inspect %s: %w", dir, err)
	}
	return validate(dir, info)
}

func validate(dir string, info os.FileInfo) error {
	if !info.IsDir() {
		return fmt.Errorf("%s must be a directory", dir)
	}
	owner := info.Sys().(*syscall.Stat_t).Uid
	if int(owner) != os.Getuid() {
		return fmt.Errorf("%s must be owned by uid %d", dir, os.Getuid())
	}
	if info.Mode().Perm()&0o077 != 0 {
		return fmt.Errorf("%s must not be accessible by other users", dir)
	}
	return nil
}
