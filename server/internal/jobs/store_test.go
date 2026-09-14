package jobs

import (
	"testing"
	"time"
)

func drain(sub *Subscriber, wait time.Duration) []Update {
	var out []Update
	deadline := time.After(wait)
	for {
		select {
		case u, ok := <-sub.C:
			if !ok {
				return out
			}
			out = append(out, u)
		case <-deadline:
			return out
		}
	}
}

func TestProgressCoalescesAndTerminalBypasses(t *testing.T) {
	s := NewWithTiming(20*time.Millisecond, 50*time.Millisecond)
	defer s.Close()
	sub, snapshot := s.Subscribe()
	if len(snapshot) != 0 {
		t.Fatalf("expected empty snapshot, got %d", len(snapshot))
	}
	s.Start("j1", ModelPull, "label", "m::s")
	for i := 1; i <= 50; i++ {
		s.Progress("j1", float64(i), "")
	}
	s.Complete("j1")
	updates := drain(sub, 150*time.Millisecond)

	var progressEvents, terminal, removed int
	for _, u := range updates {
		switch {
		case u.Removed:
			removed++
		case u.Job.Status == Completed:
			terminal++
		case u.Job.Status == Running && u.Job.Progress > 0:
			progressEvents++
		}
	}
	if terminal != 1 || removed != 1 {
		t.Fatalf("expected one terminal and one remove event, got %d / %d", terminal, removed)
	}
	if progressEvents > 1 {
		t.Fatalf("progress should be coalesced, got %d events", progressEvents)
	}
}

func TestDoubleTerminalIgnoredAndDismissRules(t *testing.T) {
	s := NewWithTiming(time.Millisecond, time.Hour)
	defer s.Close()
	s.Start("j1", ModelImport, "l", "t")
	if s.Dismiss("j1") {
		t.Fatal("running job must not be dismissable")
	}
	s.Complete("j1")
	s.Fail("j1", "late")
	j, _ := s.Get("j1")
	if j.Status != Completed || j.Error != "" {
		t.Fatalf("late fail must be ignored, got %+v", j)
	}
	if !s.Dismiss("j1") {
		t.Fatal("completed job should be dismissable")
	}
	if _, ok := s.Get("j1"); ok {
		t.Fatal("dismissed job should be gone")
	}
}

func TestSlowSubscriberIsDropped(t *testing.T) {
	s := NewWithTiming(time.Millisecond, time.Hour)
	defer s.Close()
	sub, _ := s.Subscribe()
	for i := 0; i < subscriberBacklog+5; i++ {
		s.Start("j"+string(rune('a'+i%26))+string(rune('a'+i/26)), ModelPull, "l", "")
	}
	got := drain(sub, 50*time.Millisecond)
	if len(got) != subscriberBacklog {
		t.Fatalf("expected the backlog then a closed channel, got %d updates", len(got))
	}
}

func TestListSortedNewestFirst(t *testing.T) {
	s := NewWithTiming(time.Millisecond, time.Hour)
	defer s.Close()
	now := time.Now()
	s.now = func() time.Time { return now }
	s.Start("old", ModelPull, "l", "")
	s.now = func() time.Time { return now.Add(time.Second) }
	s.Start("new", ModelPull, "l", "")
	list := s.List()
	if list[0].ID != "new" || list[1].ID != "old" {
		t.Fatalf("unexpected order: %v", list)
	}
	if _, ok := s.FindRunning(ModelPull, ""); !ok {
		t.Fatal("expected a running job")
	}
}
