package commands

import (
	"context"

	"github.com/jruz/chrome-cli/internal/page"
	"github.com/jruz/chrome-cli/internal/protocol"
)

func Pages(ctx context.Context, p *page.Page, _ struct{}) (protocol.Pages, error) {
	infos, err := p.Targets(ctx)
	if err != nil {
		return protocol.Pages{}, err
	}
	pages := make([]protocol.PageInfo, len(infos))
	for index, info := range infos {
		pages[index] = protocol.PageInfo{
			TargetID: info.TargetID,
			Title:    info.Title,
			URL:      info.URL,
			Selected: info.TargetID == p.TargetID,
		}
	}
	return protocol.Pages{Pages: pages}, nil
}
