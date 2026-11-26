package commands

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/jruz/chrome-cli/internal/page"
	"github.com/jruz/chrome-cli/internal/protocol"
)

type axTree struct {
	role        string
	name        string
	uid         string
	value       string
	description string
	children    []axTree
}

func Snapshot(ctx context.Context, p *page.Page, params protocol.SnapshotParams) (protocol.Snapshot, error) {
	nodes, err := p.AXNodes(ctx)
	if err != nil {
		return protocol.Snapshot{}, err
	}
	text := render(nodes, params.Verbose)
	if params.Path == "" {
		return protocol.Snapshot{Tree: text}, nil
	}
	if err := os.WriteFile(params.Path, []byte(text+"\n"), 0o600); err != nil {
		return protocol.Snapshot{}, fmt.Errorf("save snapshot: %w", err)
	}
	return protocol.Snapshot{Path: params.Path}, nil
}

func render(nodes []page.AXNode, verbose bool) string {
	if len(nodes) == 0 {
		return "empty page"
	}
	byID := make(map[string]page.AXNode, len(nodes))
	for _, node := range nodes {
		byID[node.NodeID] = node
	}
	tree, found := build(byID, nodes[0].NodeID)
	if !found {
		return "empty page"
	}
	var lines []string
	format(tree, 0, verbose, &lines)
	return strings.Join(lines, "\n")
}

func build(byID map[string]page.AXNode, id string) (axTree, bool) {
	node, found := byID[id]
	if !found {
		return axTree{}, false
	}
	var children []axTree
	for _, childID := range node.ChildIDs {
		if child, found := build(byID, childID); found {
			children = append(children, child)
		}
	}
	if node.Ignored {
		if len(children) == 1 {
			return children[0], true
		}
		return axTree{role: "group", uid: node.NodeID, children: children}, true
	}
	role := page.Text(node.Role)
	if role == "" {
		role = "none"
	}
	return axTree{
		role:        role,
		name:        page.Text(node.Name),
		uid:         node.NodeID,
		value:       page.Text(node.Value),
		description: page.Text(node.Description),
		children:    children,
	}, true
}

func format(tree axTree, depth int, verbose bool, lines *[]string) {
	line := fmt.Sprintf("%s%s %q", strings.Repeat("  ", depth), tree.role, tree.name)
	if tree.value != "" {
		line += fmt.Sprintf(" value=%q", tree.value)
	}
	if verbose && tree.description != "" {
		line += fmt.Sprintf(" description=%q", tree.description)
	}
	*lines = append(*lines, line+" [uid="+tree.uid+"]")
	for _, child := range tree.children {
		format(child, depth+1, verbose, lines)
	}
}
