package protocol

import (
	"encoding/json"
	"fmt"
)

const (
	ActionLaunch   = "launch"
	ActionKill     = "kill"
	ActionKillAll  = "kill-all"
	ActionStatus   = "status"
	ActionShutdown = "shutdown"
)

type Request struct {
	Action string          `json:"action"`
	Params json.RawMessage `json:"params,omitempty"`
}

type Failure struct {
	Error string `json:"error"`
}

type Target struct {
	Session string `json:"session,omitempty"`
	Port    int    `json:"port,omitempty"`
}

func (t Target) Key() string {
	if t.Session != "" {
		return SessionKey(t.Session)
	}
	return PortKey(t.Port)
}

func SessionKey(id string) string {
	return "session " + id
}

func PortKey(port int) string {
	return fmt.Sprintf("port %d", port)
}

type LaunchParams struct {
	Headless bool `json:"headless"`
}

type Launched struct {
	Session string `json:"session"`
}

type KillParams struct {
	Target Target `json:"target"`
}

type Killed struct {
	Killed []Target `json:"killed"`
}

type Session struct {
	ID      string `json:"session"`
	Pid     int    `json:"pid"`
	Profile string `json:"profile"`
}

type Status struct {
	Pid      int       `json:"pid"`
	Sessions []Session `json:"sessions"`
	Ports    []int     `json:"ports"`
}
