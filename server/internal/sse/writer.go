package sse

import (
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

type Writer struct {
	e *core.RequestEvent
}

// Streams outlive any request deadline, so the write deadline is cleared explicitly.
func Begin(e *core.RequestEvent) *Writer {
	h := e.Response.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")
	_ = http.NewResponseController(e.Response).SetWriteDeadline(time.Time{})
	e.Response.WriteHeader(http.StatusOK)
	_ = e.Flush()
	return &Writer{e: e}
}

func (w *Writer) Event(name, data string) error {
	var b strings.Builder
	if name != "" {
		b.WriteString("event: ")
		b.WriteString(name)
		b.WriteByte('\n')
	}
	for _, line := range strings.Split(data, "\n") {
		b.WriteString("data: ")
		b.WriteString(line)
		b.WriteByte('\n')
	}
	b.WriteByte('\n')
	if _, err := w.e.Response.Write([]byte(b.String())); err != nil {
		return err
	}
	return w.e.Flush()
}
