package commands

import (
	"github.com/jruz/chrome-cli/internal/protocol"
	"github.com/jruz/chrome-cli/internal/recorder"
)

type messageKey struct {
	level string
	text  string
}

func Console(r *recorder.Recorder, params protocol.ConsoleParams) (protocol.Console, error) {
	messages, _, err := r.History()
	if err != nil {
		return protocol.Console{}, err
	}
	if params.All {
		return protocol.Console{Messages: messages}, nil
	}
	return protocol.Console{Messages: deduplicate(problems(messages))}, nil
}

func problems(messages []protocol.ConsoleMessage) []protocol.ConsoleMessage {
	var kept []protocol.ConsoleMessage
	for _, message := range messages {
		if message.Level == "error" || message.Level == "warning" {
			kept = append(kept, message)
		}
	}
	return kept
}

func deduplicate(messages []protocol.ConsoleMessage) []protocol.ConsoleMessage {
	positions := map[messageKey]int{}
	var unique []protocol.ConsoleMessage
	for _, message := range messages {
		key := messageKey{level: message.Level, text: message.Text}
		if index, seen := positions[key]; seen {
			unique[index].Count++
			continue
		}
		positions[key] = len(unique)
		unique = append(unique, message)
	}
	return unique
}

func Network(r *recorder.Recorder, params protocol.NetworkParams) (protocol.Network, error) {
	_, requests, err := r.History()
	if err != nil {
		return protocol.Network{}, err
	}
	if params.All {
		return protocol.Network{Requests: requests}, nil
	}
	var failed []protocol.NetworkRequest
	for _, request := range requests {
		if request.Failed() {
			failed = append(failed, request)
		}
	}
	return protocol.Network{Requests: failed}, nil
}
