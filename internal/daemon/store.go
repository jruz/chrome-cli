package daemon

import (
	"crypto/rand"
	"maps"
	"strings"
	"time"

	"github.com/jruz/chrome-cli/internal/browser"
	"github.com/jruz/chrome-cli/internal/commands"
	"github.com/jruz/chrome-cli/internal/page"
	"github.com/jruz/chrome-cli/internal/protocol"
	"github.com/jruz/chrome-cli/internal/recorder"
)

const idLength = 4

type tab struct {
	page     *page.Page
	recorder *recorder.Recorder
}

type session struct {
	target    protocol.Target
	owned     *browser.Owned
	external  *browser.External
	page      *page.Page
	recorder  *recorder.Recorder
	emulation commands.Emulation
	contexts  map[string]string
}

type state struct {
	capacity    capacity
	activity    activity
	idleTimeout time.Duration
	sessions    map[string]session
	shots       map[string]int
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
		sessions:    map[string]session{},
		shots:       map[string]int{},
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

func (s *state) ownedCount() int {
	count := 0
	for _, current := range s.sessions {
		if current.owned != nil {
			count++
		}
	}
	return count
}

type launchReserved struct{ reply chan error }

func (e launchReserved) apply(s *state) {
	next, err := s.capacity.reserve(s.ownedCount())
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
	first tab
	reply chan session
}

func (e launchConfirmed) apply(s *state) {
	target := protocol.Target{Session: unusedID(s.sessions)}
	confirmed := session{target: target, owned: e.owned, page: e.first.page, recorder: e.first.recorder, contexts: map[string]string{}}
	s.capacity = s.capacity.settle()
	s.sessions[target.Key()] = confirmed
	s.activity.touch(target.Key(), time.Now())
	e.reply <- confirmed
}

type externalRegistered struct {
	candidate session
	reply     chan session
}

func (e externalRegistered) apply(s *state) {
	key := e.candidate.target.Key()
	if existing, found := s.sessions[key]; found {
		e.reply <- existing
		return
	}
	s.sessions[key] = e.candidate
	e.reply <- e.candidate
}

type sessionRemoved struct {
	key   string
	reply chan struct{}
}

func (e sessionRemoved) apply(s *state) {
	delete(s.sessions, e.key)
	delete(s.activity, e.key)
	delete(s.shots, e.key)
	e.reply <- struct{}{}
}

type lookup struct {
	session session
	found   bool
}

type sessionLookedUp struct {
	key   string
	reply chan lookup
}

func (e sessionLookedUp) apply(s *state) {
	current, found := s.sessions[e.key]
	e.reply <- lookup{session: current, found: found}
}

type emulationChanged struct {
	key       string
	emulation commands.Emulation
	reply     chan struct{}
}

func (e emulationChanged) apply(s *state) {
	current, found := s.sessions[e.key]
	if found {
		current.emulation = e.emulation
		s.sessions[e.key] = current
	}
	e.reply <- struct{}{}
}

type pageSelected struct {
	key      string
	selected tab
	reply    chan struct{}
}

func (e pageSelected) apply(s *state) {
	current, found := s.sessions[e.key]
	if found {
		current.page = e.selected.page
		current.recorder = e.selected.recorder
		current.emulation = commands.Emulation{}
		s.sessions[e.key] = current
	}
	e.reply <- struct{}{}
}

type contextCreated struct {
	key   string
	name  string
	id    string
	reply chan struct{}
}

func (e contextCreated) apply(s *state) {
	current, found := s.sessions[e.key]
	if found {
		contexts := maps.Clone(current.contexts)
		contexts[e.name] = e.id
		current.contexts = contexts
		s.sessions[e.key] = current
	}
	e.reply <- struct{}{}
}

type shotNumbered struct {
	key   string
	reply chan int
}

func (e shotNumbered) apply(s *state) {
	s.shots[e.key]++
	e.reply <- s.shots[e.key]
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
	var targets []protocol.Target
	for _, key := range s.activity.expired(time.Now(), s.idleTimeout) {
		if current, found := s.sessions[key]; found {
			targets = append(targets, current.target)
		}
	}
	e.reply <- targets
}

type targetsQueried struct{ reply chan []protocol.Target }

func (e targetsQueried) apply(s *state) {
	targets := make([]protocol.Target, 0, len(s.sessions))
	for _, current := range s.sessions {
		targets = append(targets, current.target)
	}
	e.reply <- targets
}

type statusQueried struct{ reply chan protocol.Status }

func (e statusQueried) apply(s *state) {
	status := protocol.Status{Sessions: []protocol.Session{}, Ports: []int{}}
	for _, current := range s.sessions {
		if current.owned == nil {
			status.Ports = append(status.Ports, current.target.Port)
			continue
		}
		status.Sessions = append(status.Sessions, protocol.Session{
			ID:      current.target.Session,
			Pid:     current.owned.Pid,
			Profile: current.owned.Profile,
		})
	}
	e.reply <- status
}

func unusedID(sessions map[string]session) string {
	for {
		id := strings.ToLower(rand.Text()[:idLength])
		if _, taken := sessions[protocol.Target{Session: id}.Key()]; !taken {
			return id
		}
	}
}
