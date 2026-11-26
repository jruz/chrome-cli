package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/jruz/chrome-cli/internal/protocol"
	"github.com/jruz/chrome-cli/internal/rundir"
)

const shutdownTimeout = 15 * time.Second

type Config struct {
	RuntimeDir   string
	Limit        int
	IdleTimeout  time.Duration
	ReapInterval time.Duration
}

type handler func(context.Context, json.RawMessage) (any, error)

func Serve(config Config) error {
	if err := rundir.Ensure(config.RuntimeDir); err != nil {
		return err
	}
	logFile, err := os.OpenFile(rundir.Log(config.RuntimeDir), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("open daemon log: %w", err)
	}
	defer logFile.Close()
	logger := newLogger(logFile)
	if err := serve(config, logger); err != nil {
		logger.Error("daemon failed", "error", err)
		return err
	}
	return nil
}

func serve(config Config, logger *slog.Logger) error {
	lock, err := acquireLock(rundir.Lock(config.RuntimeDir))
	if errors.Is(err, errLocked) {
		logger.Info("another daemon owns the lock", "pid", os.Getpid())
		return nil
	}
	if err != nil {
		return err
	}
	defer lock.Close()
	listener, err := listen(rundir.Socket(config.RuntimeDir))
	if err != nil {
		return err
	}
	d := daemon{
		store:    newStore(config.Limit, config.IdleTimeout),
		log:      logger,
		stop:     make(chan struct{}),
		stopOnce: &sync.Once{},
	}
	server := &http.Server{Handler: d.routes()}
	go d.reapEvery(config.ReapInterval)
	go d.stopOnSignal()
	drained := make(chan struct{})
	go shutdownOnStop(d, server, drained)
	logger.Info("daemon listening", "socket", rundir.Socket(config.RuntimeDir), "pid", os.Getpid())
	if err := server.Serve(listener); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	<-drained
	logger.Info("daemon stopped", "pid", os.Getpid())
	return nil
}

func listen(socket string) (net.Listener, error) {
	if err := os.Remove(socket); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("remove stale socket: %w", err)
	}
	listener, err := net.Listen("unix", socket)
	if err != nil {
		return nil, fmt.Errorf("listen on %s: %w", socket, err)
	}
	return listener, nil
}

func (d daemon) routes() http.Handler {
	handlers := map[string]handler{
		protocol.ActionLaunch:   decoded(d.launch),
		protocol.ActionKill:     d.targeted(decoded(d.kill)),
		protocol.ActionKillAll:  decoded(d.killAll),
		protocol.ActionStatus:   decoded(d.status),
		protocol.ActionShutdown: decoded(d.shutdown),
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /command", func(w http.ResponseWriter, r *http.Request) {
		if err := respond(w, dispatch(r, handlers)); err != nil {
			d.log.Error("write response failed", "error", err)
		}
	})
	return mux
}

func (d daemon) targeted(run handler) handler {
	return func(ctx context.Context, raw json.RawMessage) (any, error) {
		var params protocol.KillParams
		if err := json.Unmarshal(raw, &params); err != nil {
			return nil, fmt.Errorf("invalid target: %w", err)
		}
		return d.track(params.Target.Key(), func() (any, error) { return run(ctx, raw) })
	}
}

func decoded[P, R any](run func(context.Context, P) (R, error)) handler {
	return func(ctx context.Context, raw json.RawMessage) (any, error) {
		var params P
		if len(raw) > 0 {
			if err := json.Unmarshal(raw, &params); err != nil {
				return nil, fmt.Errorf("invalid params: %w", err)
			}
		}
		return run(ctx, params)
	}
}

type outcome struct {
	result any
	err    error
}

func dispatch(r *http.Request, handlers map[string]handler) outcome {
	var request protocol.Request
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		return outcome{err: fmt.Errorf("invalid request: %w", err)}
	}
	run, found := handlers[request.Action]
	if !found {
		return outcome{err: fmt.Errorf("unknown action %q", request.Action)}
	}
	result, err := run(r.Context(), request.Params)
	return outcome{result: result, err: err}
}

func respond(w http.ResponseWriter, result outcome) error {
	w.Header().Set("Content-Type", "application/json")
	if result.err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return json.NewEncoder(w).Encode(protocol.Failure{Error: result.err.Error()})
	}
	return json.NewEncoder(w).Encode(result.result)
}

func (d daemon) reapEvery(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			d.reap(context.Background())
		case <-d.stop:
			return
		}
	}
}

func (d daemon) stopOnSignal() {
	signals, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()
	select {
	case <-signals.Done():
		d.log.Info("received signal, shutting down")
		if _, err := d.killAll(context.Background(), struct{}{}); err != nil {
			d.log.Error("closing browsers on signal failed", "error", err)
		}
		d.requestStop()
	case <-d.stop:
	}
}

func shutdownOnStop(d daemon, server *http.Server, drained chan<- struct{}) {
	<-d.stop
	ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	defer close(drained)
	if err := server.Shutdown(ctx); err != nil {
		d.log.Error("server shutdown failed", "error", err)
	}
}
