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

const MaxEventSize = 4 << 20

var ErrEventTooLarge = errors.New("sse: event exceeds MaxEventSize")

// Comment lines are sse-starlette pings; a trailing event with no blank line is still delivered.
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
