package daemon

import (
	"crypto/rand"
	"slices"
	"strings"
	"time"

	"github.com/jruz/chrome-cli/internal/browser"
	"github.com/jruz/chrome-cli/internal/protocol"
)

const idLength = 4

type state struct {
	capacity    capacity
	activity    activity
	idleTimeout time.Duration
	owned       map[string]*browser.Owned
	external    map[int]*browser.External
}

type event interface {
	apply(*state)
}

type store struct {
	events chan event
}

func newStore(limit int, idleTimeout time.Duration) store {
	s := store{events: make(chan event)}
	initial := &state{
		capacity:    capacity{limit: limit},
		activity:    activity{},
		idleTimeout: idleTimeout,
		owned:       map[string]*browser.Owned{},
		external:    map[int]*browser.External{},
	}
	go s.run(initial)
	return s
}

func (s store) run(current *state) {
	for e := range s.events {
		e.apply(current)
	}
}

func ask[T any](s store, build func(chan T) event) T {
	reply := make(chan T, 1)
	s.events <- build(reply)
	return <-reply
}

type launchReserved struct{ reply chan error }

func (e launchReserved) apply(s *state) {
	next, err := s.capacity.reserve(len(s.owned))
	s.capacity = next
	e.reply <- err
}

type launchFailed struct{ reply chan struct{} }

func (e launchFailed) apply(s *state) {
	s.capacity = s.capacity.settle()
	e.reply <- struct{}{}
}

type launchConfirmed struct {
	owned *browser.Owned
	reply chan string
}

func (e launchConfirmed) apply(s *state) {
	id := unusedID(s.owned)
	s.capacity = s.capacity.settle()
	s.owned[id] = e.owned
	s.activity.touch(protocol.SessionKey(id), time.Now())
	e.reply <- id
}

type sessionRemoved struct {
	id    string
	reply chan struct{}
}

func (e sessionRemoved) apply(s *state) {
	delete(s.owned, e.id)
	delete(s.activity, protocol.SessionKey(e.id))
	e.reply <- struct{}{}
}

type externalRemoved struct {
	port  int
	reply chan struct{}
}

func (e externalRemoved) apply(s *state) {
	delete(s.external, e.port)
	e.reply <- struct{}{}
}

type sessionLookedUp struct {
	id    string
	reply chan *browser.Owned
}

func (e sessionLookedUp) apply(s *state) {
	e.reply <- s.owned[e.id]
}

type externalLookedUp struct {
	port  int
	reply chan *browser.External
}

func (e externalLookedUp) apply(s *state) {
	e.reply <- s.external[e.port]
}

type commandStarted struct {
	key   string
	reply chan struct{}
}

func (e commandStarted) apply(s *state) {
	s.activity.begin(e.key, time.Now())
	e.reply <- struct{}{}
}

type commandFinished struct {
	key   string
	reply chan struct{}
}

func (e commandFinished) apply(s *state) {
	s.activity.finish(e.key, time.Now())
	e.reply <- struct{}{}
}

type idleQueried struct{ reply chan []protocol.Target }

func (e idleQueried) apply(s *state) {
	keys := s.activity.expired(time.Now(), s.idleTimeout)
	var targets []protocol.Target
	for id := range s.owned {
		if slices.Contains(keys, protocol.SessionKey(id)) {
			targets = append(targets, protocol.Target{Session: id})
		}
	}
	e.reply <- targets
}

type targetsQueried struct{ reply chan []protocol.Target }

func (e targetsQueried) apply(s *state) {
	targets := make([]protocol.Target, 0, len(s.owned)+len(s.external))
	for id := range s.owned {
		targets = append(targets, protocol.Target{Session: id})
	}
	for port := range s.external {
		targets = append(targets, protocol.Target{Port: port})
	}
	e.reply <- targets
}

type statusQueried struct{ reply chan protocol.Status }

func (e statusQueried) apply(s *state) {
	sessions := make([]protocol.Session, 0, len(s.owned))
	for id, owned := range s.owned {
		sessions = append(sessions, protocol.Session{ID: id, Pid: owned.Pid, Profile: owned.Profile})
	}
	ports := make([]int, 0, len(s.external))
	for port := range s.external {
		ports = append(ports, port)
	}
	e.reply <- protocol.Status{Sessions: sessions, Ports: ports}
}

func unusedID(owned map[string]*browser.Owned) string {
	for {
		id := strings.ToLower(rand.Text()[:idLength])
		if _, taken := owned[id]; !taken {
			return id
		}
	}
}
