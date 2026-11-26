package daemon

import "fmt"

type capacity struct {
	limit     int
	launching int
}

func (c capacity) reserve(owned int) (capacity, error) {
	used := c.launching + owned
	if used >= c.limit {
		return c, fmt.Errorf("browser limit reached (%d/%d) (close one with chrome-cli kill -s <id>)", used, c.limit)
	}
	return capacity{limit: c.limit, launching: c.launching + 1}, nil
}

func (c capacity) settle() capacity {
	return capacity{limit: c.limit, launching: c.launching - 1}
}
