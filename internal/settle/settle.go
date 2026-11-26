package settle

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jruz/chrome-cli/internal/cdp"
	"github.com/jruz/chrome-cli/internal/page"
	"github.com/jruz/chrome-cli/internal/protocol"
)

const (
	quietPeriod  = 300 * time.Millisecond
	settleLimit  = 5 * time.Second
	pollInterval = 50 * time.Millisecond
	domQuiet     = `new Promise(resolve => {
		let timer;
		const done = () => { observer.disconnect(); clearTimeout(cap); resolve(true); };
		const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, 100); });
		observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
		timer = setTimeout(done, 100);
		const cap = setTimeout(() => { observer.disconnect(); clearTimeout(timer); resolve(false); }, 1000);
	})`
)

type Report struct {
	Settled bool
	Dialogs []protocol.Dialog
}

type request struct {
	wait  bool
	reply chan Report
}

type Observer struct {
	page     *page.Page
	requests chan request
	failures chan error
}

type progress struct {
	mainFrame    string
	navigating   bool
	inFlight     map[string]bool
	lastActivity time.Time
	dialogs      []protocol.Dialog
}

type pageEvent struct {
	RequestID string `json:"requestId"`
	FrameID   string `json:"frameId"`
	Type      string `json:"type"`
	Name      string `json:"name"`
	Message   string `json:"message"`
}

func Observe(ctx context.Context, p *page.Page) (*Observer, error) {
	mainFrame, err := p.MainFrame(ctx)
	if err != nil {
		return nil, err
	}
	events, unsubscribe := p.Subscribe()
	o := &Observer{page: p, requests: make(chan request), failures: make(chan error, 1)}
	initial := progress{mainFrame: mainFrame, inFlight: map[string]bool{}, lastActivity: time.Now()}
	go o.run(events, unsubscribe, initial)
	return o, nil
}

func (o *Observer) Settle(ctx context.Context, wait bool) (Report, error) {
	reply := make(chan Report, 1)
	select {
	case o.requests <- request{wait: wait, reply: reply}:
	case err := <-o.failures:
		return Report{}, err
	}
	var report Report
	select {
	case report = <-reply:
	case err := <-o.failures:
		return Report{}, err
	}
	if !wait || !report.Settled {
		return report, nil
	}
	quiet, err := o.domQuiet(ctx)
	report.Settled = quiet
	return report, err
}

func (o *Observer) domQuiet(ctx context.Context) (bool, error) {
	var quiet bool
	if err := o.page.EvaluateInto(ctx, domQuiet, &quiet); err != nil {
		return false, fmt.Errorf("wait for DOM to settle: %w", err)
	}
	return quiet, nil
}

func (o *Observer) run(events <-chan cdp.Event, unsubscribe func(), current progress) {
	defer unsubscribe()
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()
	var waiting chan Report
	var deadline time.Time
	for {
		select {
		case event, open := <-events:
			if !open {
				o.failures <- cdp.ErrClosed
				return
			}
			if err := current.apply(event); err != nil {
				o.failures <- err
				return
			}
		case pending := <-o.requests:
			if !pending.wait {
				pending.reply <- Report{Dialogs: current.dialogs}
				return
			}
			waiting, deadline = pending.reply, time.Now().Add(settleLimit)
		case now := <-ticker.C:
			if waiting == nil {
				continue
			}
			quiet := current.quiet(now)
			if quiet || now.After(deadline) {
				waiting <- Report{Settled: quiet, Dialogs: current.dialogs}
				return
			}
		}
	}
}

func (p *progress) quiet(now time.Time) bool {
	return !p.navigating && len(p.inFlight) == 0 && now.Sub(p.lastActivity) >= quietPeriod
}

func (p *progress) apply(event cdp.Event) error {
	if !tracked(event.Method) {
		return nil
	}
	var decoded pageEvent
	if err := json.Unmarshal(event.Params, &decoded); err != nil {
		return fmt.Errorf("decode %s: %w", event.Method, err)
	}
	switch event.Method {
	case "Page.frameStartedLoading":
		p.navigating = p.navigating || decoded.FrameID == p.mainFrame
	case "Page.lifecycleEvent":
		if decoded.FrameID == p.mainFrame && decoded.Name == "DOMContentLoaded" {
			p.navigating = false
		}
	case "Network.requestWillBeSent":
		if decoded.Type != "EventSource" && decoded.Type != "WebSocket" {
			p.inFlight[decoded.RequestID] = true
		}
	case "Network.loadingFinished", "Network.loadingFailed":
		delete(p.inFlight, decoded.RequestID)
	case "Page.javascriptDialogOpening":
		p.dialogs = append(p.dialogs, protocol.Dialog{Type: decoded.Type, Message: decoded.Message})
	}
	p.lastActivity = time.Now()
	return nil
}

func tracked(method string) bool {
	switch method {
	case "Page.frameStartedLoading",
		"Page.lifecycleEvent",
		"Network.requestWillBeSent",
		"Network.loadingFinished",
		"Network.loadingFailed",
		"Page.javascriptDialogOpening":
		return true
	}
	return false
}
