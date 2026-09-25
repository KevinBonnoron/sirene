package bootstrap

import (
	"errors"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestASubscriberStartsFromTheCurrentState(t *testing.T) {
	s := New("/tmp/desktop.log")
	s.Stage("dependencies")
	_, snapshot, stop := s.Subscribe()
	defer stop()
	if snapshot.Stage != "dependencies" || snapshot.LogFile != "/tmp/desktop.log" {
		t.Fatalf("unexpected snapshot %+v", snapshot)
	}
}

func TestAStageReachesASubscriber(t *testing.T) {
	s := New("")
	ch, _, stop := s.Subscribe()
	defer stop()
	s.Stage("starting")
	if got := (<-ch).Stage; got != "starting" {
		t.Fatalf("expected starting, got %q", got)
	}
}

// A reader that fell behind gets the newest state, not the history it missed.
func TestASlowSubscriberGetsTheLatestStateOnly(t *testing.T) {
	s := New("")
	ch, _, stop := s.Subscribe()
	defer stop()
	s.Stage("python")
	s.Stage("dependencies")
	s.Stage("ready")
	if got := (<-ch).Stage; got != "ready" {
		t.Fatalf("expected ready, got %q", got)
	}
	select {
	case extra := <-ch:
		t.Fatalf("expected nothing queued, got %+v", extra)
	default:
	}
}

func TestInstallerChatterIsThrottled(t *testing.T) {
	s := New("")
	s.Stage("python")
	ch, _, stop := s.Subscribe()
	defer stop()
	s.Stage("dependencies")
	<-ch
	for i := 0; i < 50; i++ {
		s.Detail("Collecting something")
	}
	select {
	case st := <-ch:
		t.Fatalf("fifty lines right after a stage should publish nothing at once, got %+v", st)
	default:
	}
	// Once the interval ends, the one line still owed goes out.
	select {
	case st := <-ch:
		if st.Detail != "Collecting something" {
			t.Fatalf("expected the throttled line, got %q", st.Detail)
		}
	case <-time.After(detailInterval + 200*time.Millisecond):
		t.Fatal("a throttled line was never published")
	}
	select {
	case st := <-ch:
		t.Fatalf("fifty lines should cost one trailing publication, got another: %+v", st)
	case <-time.After(detailInterval + 100*time.Millisecond):
	}
}

func TestTheLastLineOfAChunkIsTheOneShown(t *testing.T) {
	s := New("")
	s.Stage("dependencies")
	ch, _, stop := s.Subscribe()
	defer stop()
	time.Sleep(detailInterval)
	s.Detail("Installing torch\nSuccessfully installed torch")
	if got := (<-ch).Detail; got != "Successfully installed torch" {
		t.Fatalf("expected the last line of the chunk, got %q", got)
	}
}

// A stage change is published at once and makes a pending trailing line obsolete.
func TestAStageCancelsAPendingTrailingLine(t *testing.T) {
	s := New("")
	ch, _, stop := s.Subscribe()
	defer stop()
	s.Stage("python")
	<-ch
	s.Detail("downloading Python 3.11")
	s.Stage("dependencies")
	if got := (<-ch); got.Stage != "dependencies" || got.Detail != "" {
		t.Fatalf("expected the new stage with no detail, got %+v", got)
	}
	select {
	case st := <-ch:
		t.Fatalf("the cancelled trailing line published anyway: %+v", st)
	case <-time.After(detailInterval + 100*time.Millisecond):
	}
}

func TestAFailureCarriesItsReason(t *testing.T) {
	s := New("")
	s.Stage("dependencies")
	s.Detail("Collecting torch")
	s.Fail(errors.New("pip exited with status 1"))
	st := s.Current()
	if st.Stage != "failed" || st.Error != "pip exited with status 1" || st.Detail != "" {
		t.Fatalf("unexpected state %+v", st)
	}
}

func TestANewStageClearsAPreviousError(t *testing.T) {
	s := New("")
	s.Fail(errors.New("boom"))
	s.Stage("python")
	if st := s.Current(); st.Error != "" {
		t.Fatalf("expected the error cleared, got %+v", st)
	}
}

func TestTheRunningWorkerLogsPublishNothing(t *testing.T) {
	for _, stage := range []string{"ready", "failed", "pending"} {
		s := New("")
		if stage != "pending" {
			s.Stage(stage)
		}
		ch, _, stop := s.Subscribe()
		time.Sleep(detailInterval)
		s.Detail("INFO: 127.0.0.1 - \"POST /generate HTTP/1.1\" 200")
		select {
		case st := <-ch:
			t.Fatalf("%s: a request log line was published: %+v", stage, st)
		case <-time.After(detailInterval + 100*time.Millisecond):
		}
		if s.Current().Detail != "" {
			t.Fatalf("%s: a request log line was recorded", stage)
		}
		stop()
	}
}

func TestALongLineIsCutBetweenCharacters(t *testing.T) {
	s := New("")
	s.Stage("dependencies")
	path := strings.Repeat("é", maxDetail+20)
	s.Detail(path)
	got := s.Current().Detail
	if !utf8.ValidString(got) || strings.ContainsRune(got, utf8.RuneError) {
		t.Fatalf("cut inside a character: %q", got)
	}
	if n := utf8.RuneCountInString(got); n != maxDetail+1 {
		t.Fatalf("expected %d characters with the ellipsis, got %d", maxDetail+1, n)
	}
}

func TestATrailingLineOvertakenByAStageStaysQuiet(t *testing.T) {
	s := New("")
	s.Stage("python")
	s.Detail("downloading Python 3.11")
	s.mu.Lock()
	fired := s.generation
	s.mu.Unlock()

	s.Stage("dependencies")
	s.Detail("Collecting torch")
	ch, _, stop := s.Subscribe()
	defer stop()

	s.flushTrailing(fired)
	select {
	case st := <-ch:
		t.Fatalf("a superseded trailing line published: %+v", st)
	default:
	}
	s.mu.Lock()
	pending := s.trailing
	s.mu.Unlock()
	if pending == nil {
		t.Fatal("the superseded callback dropped the newer pending line")
	}
}
