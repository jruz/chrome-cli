package browser

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"

	"github.com/jruz/chrome-cli/internal/cdp"
)

const ProfilePrefix = "chrome-cli-"

var baseArgs = []string{
	"--allow-pre-commit-input",
	"--disable-background-networking",
	"--disable-background-timer-throttling",
	"--disable-back-forward-cache",
	"--disable-backgrounding-occluded-windows",
	"--disable-breakpad",
	"--disable-client-side-phishing-detection",
	"--disable-component-extensions-with-background-pages",
	"--disable-default-apps",
	"--disable-dev-shm-usage",
	"--disable-extensions",
	"--disable-hang-monitor",
	"--disable-infobars",
	"--disable-ipc-flooding-protection",
	"--disable-popup-blocking",
	"--disable-prompt-on-repost",
	"--disable-renderer-backgrounding",
	"--disable-search-engine-choice-screen",
	"--disable-sync",
	"--enable-automation",
	"--force-color-profile=srgb",
	"--metrics-recording-only",
	"--no-default-browser-check",
	"--no-first-run",
	"--password-store=basic",
	"--use-mock-keychain",
	"--remote-debugging-pipe",
}

var headlessArgs = []string{"--headless=new", "--hide-scrollbars", "--mute-audio"}

type Owned struct {
	Conn     *cdp.Conn
	Pid      int
	Profile  string
	process  *os.Process
	exited   chan struct{}
	cleanErr error
}

type pipes struct {
	chromeReads  *os.File
	daemonWrites *os.File
	daemonReads  *os.File
	chromeWrites *os.File
}

func Launch(ctx context.Context, headless bool) (*Owned, error) {
	path, err := executable()
	if err != nil {
		return nil, err
	}
	profile, err := os.MkdirTemp("", ProfilePrefix+"*")
	if err != nil {
		return nil, fmt.Errorf("create Chrome profile: %w", err)
	}
	owned, err := start(path, profile, headless)
	if err != nil {
		return nil, errors.Join(err, os.RemoveAll(profile))
	}
	if err := owned.ready(ctx); err != nil {
		owned.Kill()
		return nil, errors.Join(err, owned.cleanErr)
	}
	return owned, nil
}

func (o *Owned) Exited() <-chan struct{} {
	return o.exited
}

func (o *Owned) Close(ctx context.Context) error {
	err := o.Conn.Call(ctx, "", "Browser.close", nil, nil)
	if err != nil && !errors.Is(err, cdp.ErrClosed) {
		return err
	}
	select {
	case <-o.exited:
		return o.cleanErr
	case <-ctx.Done():
		return fmt.Errorf("wait for Chrome %d to exit: %w", o.Pid, ctx.Err())
	}
}

func (o *Owned) Kill() error {
	if err := o.process.Kill(); err != nil && !errors.Is(err, os.ErrProcessDone) {
		return fmt.Errorf("kill Chrome %d: %w", o.Pid, err)
	}
	<-o.exited
	return o.cleanErr
}

func start(path, profile string, headless bool) (*Owned, error) {
	streams, err := openPipes()
	if err != nil {
		return nil, err
	}
	command := exec.Command(path, arguments(profile, headless)...)
	command.ExtraFiles = []*os.File{streams.chromeReads, streams.chromeWrites}
	startErr := command.Start()
	closeErr := errors.Join(streams.chromeReads.Close(), streams.chromeWrites.Close())
	if startErr != nil {
		return nil, errors.Join(fmt.Errorf("start Chrome: %w", startErr), streams.daemonWrites.Close(), streams.daemonReads.Close())
	}
	owned := &Owned{
		Conn:    cdp.NewConn(cdp.NewPipe(streams.daemonWrites, streams.daemonReads)),
		Pid:     command.Process.Pid,
		Profile: profile,
		process: command.Process,
		exited:  make(chan struct{}),
	}
	go owned.watch(command)
	return owned, closeErr
}

func (o *Owned) watch(command *exec.Cmd) {
	waitErr := command.Wait()
	o.Conn.Close()
	o.cleanErr = os.RemoveAll(o.Profile)
	if o.cleanErr != nil {
		o.cleanErr = errors.Join(waitErr, o.cleanErr)
	}
	close(o.exited)
}

func (o *Owned) ready(ctx context.Context) error {
	if err := o.Conn.Call(ctx, "", "Browser.getVersion", nil, nil); err != nil {
		return fmt.Errorf("no response from Chrome %d: %w", o.Pid, err)
	}
	return nil
}

func openPipes() (pipes, error) {
	chromeReads, daemonWrites, err := os.Pipe()
	if err != nil {
		return pipes{}, fmt.Errorf("create CDP pipe: %w", err)
	}
	daemonReads, chromeWrites, err := os.Pipe()
	if err != nil {
		return pipes{}, errors.Join(fmt.Errorf("create CDP pipe: %w", err), chromeReads.Close(), daemonWrites.Close())
	}
	return pipes{
		chromeReads:  chromeReads,
		daemonWrites: daemonWrites,
		daemonReads:  daemonReads,
		chromeWrites: chromeWrites,
	}, nil
}

func arguments(profile string, headless bool) []string {
	args := append([]string{}, baseArgs...)
	if headless {
		args = append(args, headlessArgs...)
	}
	return append(args, "--user-data-dir="+profile, "about:blank")
}
