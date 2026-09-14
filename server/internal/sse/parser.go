package sse

import (
	"bufio"
	"errors"
	"io"
	"strings"
)

type Event struct {
	Name string
	Data string
}

// MaxEventSize bounds one event's accumulated data so a misbehaving worker
// cannot grow memory without bound.
const MaxEventSize = 4 << 20

var ErrEventTooLarge = errors.New("sse: event exceeds MaxEventSize")

// Read parses a text/event-stream body and calls fn for every event,
// including a trailing one that was never terminated by a blank line.
// It tolerates CRLF and comment lines (sse-starlette pings).
func Read(r io.Reader, fn func(Event) error) error {
	br := bufio.NewReaderSize(r, 64<<10)
	var name string
	var data []string
	size := 0
	dispatch := func() error {
		if len(data) == 0 && name == "" {
			return nil
		}
		ev := Event{Name: name, Data: strings.Join(data, "\n")}
		name, data, size = "", nil, 0
		return fn(ev)
	}
	for {
		line, err := br.ReadString('\n')
		if len(line) > 0 {
			line = strings.TrimRight(line, "\r\n")
			switch {
			case line == "":
				if derr := dispatch(); derr != nil {
					return derr
				}
			case strings.HasPrefix(line, ":"):
			default:
				field, value, _ := strings.Cut(line, ":")
				value = strings.TrimPrefix(value, " ")
				switch field {
				case "event":
					name = value
				case "data":
					size += len(value) + 1
					if size > MaxEventSize {
						return ErrEventTooLarge
					}
					data = append(data, value)
				}
			}
		}
		if err != nil {
			if errors.Is(err, io.EOF) {
				return dispatch()
			}
			return err
		}
	}
}
