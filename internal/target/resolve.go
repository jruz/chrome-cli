package target

import (
	"context"
	"fmt"
	"regexp"
	"slices"
	"strings"

	"github.com/jruz/chrome-cli/internal/page"
)

var (
	uidSpec  = regexp.MustCompile(`^-?\d+$`)
	roleSpec = regexp.MustCompile(`^(\w+) "(.*)"$`)
	fields   = []string{"textbox", "searchbox", "combobox", "spinbutton", "checkbox", "radio", "slider", "listbox", "switch"}
)

type Element struct {
	UID           string
	Label         string
	BackendNodeID int
}

type Tree struct {
	nodes []page.AXNode
}

func Load(ctx context.Context, p *page.Page) (Tree, error) {
	nodes, err := p.AXNodes(ctx)
	return Tree{nodes: nodes}, err
}

func Resolve(ctx context.Context, p *page.Page, spec string) (Element, error) {
	tree, err := Load(ctx, p)
	if err != nil {
		return Element{}, err
	}
	return tree.Find(spec)
}

func (t Tree) Find(spec string) (Element, error) {
	if uidSpec.MatchString(spec) {
		return t.byUID(spec)
	}
	match := roleSpec.FindStringSubmatch(spec)
	if match == nil {
		return Element{}, fmt.Errorf("invalid target %q (use a uid or role \"name\" such as 'button \"Save\"')", spec)
	}
	candidates := t.matching(func(node page.AXNode) bool {
		return role(node) == match[1] && name(node) == match[2]
	})
	return single(spec, candidates)
}

func (t Tree) Field(label string) (Element, error) {
	if uidSpec.MatchString(label) || roleSpec.MatchString(label) {
		return t.Find(label)
	}
	candidates := t.matching(func(node page.AXNode) bool {
		return name(node) == label && slices.Contains(fields, role(node))
	})
	return single(fmt.Sprintf("field %q", label), candidates)
}

func (t Tree) byUID(uid string) (Element, error) {
	for _, node := range t.nodes {
		if node.NodeID == uid && node.BackendDOMNodeID != 0 {
			return element(node), nil
		}
	}
	return Element{}, fmt.Errorf("element uid=%s not found (take a new chrome-cli snapshot)", uid)
}

func (t Tree) matching(accept func(page.AXNode) bool) []page.AXNode {
	var found []page.AXNode
	for _, node := range t.nodes {
		if !node.Ignored && node.BackendDOMNodeID != 0 && accept(node) {
			found = append(found, node)
		}
	}
	return found
}

func single(spec string, candidates []page.AXNode) (Element, error) {
	switch len(candidates) {
	case 0:
		return Element{}, fmt.Errorf("no %s on the page (take a chrome-cli snapshot)", spec)
	case 1:
		return element(candidates[0]), nil
	}
	uids := make([]string, len(candidates))
	for index, candidate := range candidates {
		uids[index] = "uid=" + candidate.NodeID
	}
	return Element{}, fmt.Errorf("%s matches %d elements: %s (pass one uid)", spec, len(candidates), strings.Join(uids, ", "))
}

func element(node page.AXNode) Element {
	return Element{
		UID:           node.NodeID,
		Label:         fmt.Sprintf("%s %q [uid=%s]", role(node), name(node), node.NodeID),
		BackendNodeID: node.BackendDOMNodeID,
	}
}

func role(node page.AXNode) string {
	return page.Text(node.Role)
}

func name(node page.AXNode) string {
	return page.Text(node.Name)
}
