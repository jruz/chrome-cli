package daemon

import "time"

type usage struct {
	lastUsed time.Time
	inFlight int
}

type activity map[string]usage

func (a activity) touch(key string, now time.Time) {
	current := a[key]
	a[key] = usage{lastUsed: now, inFlight: current.inFlight}
}

func (a activity) begin(key string, now time.Time) {
	current, found := a[key]
	if !found {
		return
	}
	a[key] = usage{lastUsed: now, inFlight: current.inFlight + 1}
}

func (a activity) finish(key string, now time.Time) {
	current, found := a[key]
	if !found {
		return
	}
	a[key] = usage{lastUsed: now, inFlight: current.inFlight - 1}
}

func (a activity) expired(now time.Time, timeout time.Duration) []string {
	var keys []string
	for key, current := range a {
		if current.inFlight == 0 && now.Sub(current.lastUsed) >= timeout {
			keys = append(keys, key)
		}
	}
	return keys
}
