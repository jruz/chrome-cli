package cdp

import (
	"bufio"
	"errors"
	"io"
)

const delimiter = 0

type pipe struct {
	writer io.WriteCloser
	reader *bufio.Reader
	source io.Closer
}

func NewPipe(writer io.WriteCloser, reader io.ReadCloser) Transport {
	return &pipe{writer: writer, reader: bufio.NewReader(reader), source: reader}
}

func (p *pipe) Write(message []byte) error {
	framed := append(append([]byte{}, message...), delimiter)
	_, err := p.writer.Write(framed)
	return err
}

func (p *pipe) Read() ([]byte, error) {
	frame, err := p.reader.ReadBytes(delimiter)
	if err != nil {
		return nil, err
	}
	return frame[:len(frame)-1], nil
}

func (p *pipe) Close() error {
	return errors.Join(p.writer.Close(), p.source.Close())
}
