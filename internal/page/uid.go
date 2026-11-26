package page

import (
	"context"
	"encoding/json"
	"fmt"
)

type AXValue struct {
	Value json.RawMessage `json:"value"`
}

type AXNode struct {
	NodeID           string   `json:"nodeId"`
	Ignored          bool     `json:"ignored"`
	Role             *AXValue `json:"role"`
	Name             *AXValue `json:"name"`
	Value            *AXValue `json:"value"`
	Description      *AXValue `json:"description"`
	ChildIDs         []string `json:"childIds"`
	BackendDOMNodeID int      `json:"backendDOMNodeId"`
}

type axTree struct {
	Nodes []AXNode `json:"nodes"`
}

type resolved struct {
	Object RemoteObject `json:"object"`
}

func (p *Page) AXNodes(ctx context.Context) ([]AXNode, error) {
	var tree axTree
	if err := p.Call(ctx, "Accessibility.getFullAXTree", nil, &tree); err != nil {
		return nil, err
	}
	return tree.Nodes, nil
}

func (p *Page) ResolveUIDs(ctx context.Context, uids []string) ([]string, error) {
	nodes, err := p.AXNodes(ctx)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]AXNode, len(nodes))
	for _, node := range nodes {
		byID[node.NodeID] = node
	}
	objectIDs := make([]string, len(uids))
	for index, uid := range uids {
		objectID, err := p.resolveNode(ctx, uid, byID)
		if err != nil {
			return nil, err
		}
		objectIDs[index] = objectID
	}
	return objectIDs, nil
}

func (p *Page) resolveNode(ctx context.Context, uid string, byID map[string]AXNode) (string, error) {
	node, found := byID[uid]
	if !found || node.BackendDOMNodeID == 0 {
		return "", fmt.Errorf("element uid=%s not found (take a new chrome-cli snapshot)", uid)
	}
	var result resolved
	params := map[string]int{"backendNodeId": node.BackendDOMNodeID}
	if err := p.Call(ctx, "DOM.resolveNode", params, &result); err != nil {
		return "", err
	}
	return result.Object.ObjectID, nil
}
