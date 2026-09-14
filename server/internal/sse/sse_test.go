package sse

import (
	"strings"
	"testing"
)

func TestReadHandlesCRLFCommentsAndTrailingEvent(t *testing.T) {
	body := ": ping\r\n\r\ndata: {\"a\":1}\r\n\r\nevent: change\r\ndata: line1\r\ndata: line2\r\n\r\ndata: tail"
	var got []Event
	if err := Read(strings.NewReader(body), func(e Event) error { got = append(got, e); return nil }); err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("expected 3 events, got %d: %+v", len(got), got)
	}
	if got[0].Data != `{"a":1}` || got[1].Name != "change" || got[1].Data != "line1\nline2" || got[2].Data != "tail" {
		t.Fatalf("unexpected events: %+v", got)
	}
}

func TestReadLongLine(t *testing.T) {
	line := strings.Repeat("x", 200<<10)
	var got []Event
	if err := Read(strings.NewReader("data: "+line+"\n\n"), func(e Event) error { got = append(got, e); return nil }); err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || len(got[0].Data) != len(line) {
		t.Fatal("long line should be delivered intact")
	}
}
