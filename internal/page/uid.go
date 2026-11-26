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

func Text(value *AXValue) string {
	if value == nil || len(value.Value) == 0 {
		return ""
	}
	var text string
	if err := json.Unmarshal(value.Value, &text); err == nil {
		return text
	}
	return string(value.Value)
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
	return p.ObjectID(ctx, node.BackendDOMNodeID)
}

func (p *Page) ObjectID(ctx context.Context, backendNodeID int) (string, error) {
	var result resolved
	params := map[string]int{"backendNodeId": backendNodeID}
	if err := p.Call(ctx, "DOM.resolveNode", params, &result); err != nil {
		return "", err
	}
	return result.Object.ObjectID, nil
}

func (p *Page) CallWith(ctx context.Context, objectID, function string, values ...any) (RemoteObject, error) {
	arguments := make([]map[string]any, len(values))
	for index, value := range values {
		arguments[index] = map[string]any{"value": value}
	}
	params := map[string]any{
		"functionDeclaration": function,
		"objectId":            objectID,
		"arguments":           arguments,
		"returnByValue":       true,
		"awaitPromise":        true,
	}
	var result evaluation
	if err := p.Call(ctx, "Runtime.callFunctionOn", params, &result); err != nil {
		return RemoteObject{}, err
	}
	return result.Result, thrown(result.ExceptionDetails)
}
