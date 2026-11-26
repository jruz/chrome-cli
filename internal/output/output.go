package output

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

type Printer struct {
	Out  io.Writer
	JSON bool
}

func (p Printer) Print(result any, plain ...string) error {
	if p.JSON {
		return json.NewEncoder(p.Out).Encode(result)
	}
	if len(plain) == 0 {
		return nil
	}
	_, err := fmt.Fprintln(p.Out, strings.Join(plain, "\n"))
	return err
}

func Error(w io.Writer, err error) {
	fmt.Fprintf(w, "error: %s\n", strings.ReplaceAll(err.Error(), "\n", "; "))
}
