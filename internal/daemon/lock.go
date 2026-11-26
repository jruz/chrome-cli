package daemon

import (
	"errors"
	"fmt"
	"os"
	"syscall"
)

var errLocked = errors.New("another daemon holds the lock")

func acquireLock(path string) (*os.File, error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	err = syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
	if err == nil {
		return file, nil
	}
	closeErr := file.Close()
	if errors.Is(err, syscall.EWOULDBLOCK) {
		return nil, errors.Join(errLocked, closeErr)
	}
	return nil, errors.Join(fmt.Errorf("flock %s: %w", path, err), closeErr)
}
