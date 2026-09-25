package bootstrap

import (
	"strings"
	"sync"
	"time"
)

// Installer output is a sign of life, not something to read line by line.
const detailInterval = 500 * time.Millisecond

const maxDetail = 160

// Shown instead of an app whose every generation would fail until the worker answers.
type State struct {
	Stage   string `json:"stage"`
	Detail  string `json:"detail,omitempty"`
	Error   string `json:"error,omitempty"`
	LogFile string `json:"logFile,omitempty"`
}

type Status struct {
	mu         sync.Mutex
	state      State
	subs       map[chan State]struct{}
	published  time.Time
	trailing   *time.Timer
	generation uint64
}

func New(logFile string) *Status {
	return &Status{state: State{Stage: "pending", LogFile: logFile}, subs: map[chan State]struct{}{}}
}

func (s *Status) Stage(stage string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.Stage = stage
	s.state.Detail = ""
	s.state.Error = ""
	s.publishLocked()
}

func (s *Status) Detail(line string) {
	line = lastLine(line)
	if line == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// The running worker logs every request through this writer; that is not setup progress.
	if !installing(s.state.Stage) {
		return
	}
	s.state.Detail = line
	wait := detailInterval - time.Since(s.published)
	if wait <= 0 {
		s.publishLocked()
		return
	}
	// The line right after a stage says what is downloading, and nothing else may publish for a minute.
	if s.trailing == nil {
		generation := s.generation
		s.trailing = time.AfterFunc(wait, func() { s.flushTrailing(generation) })
	}
}

// Stop cannot recall a callback already waiting on the lock, so a superseded one must stand down.
func (s *Status) flushTrailing(generation uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.generation != generation {
		return
	}
	s.publishLocked()
}

func (s *Status) Fail(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.Stage = "failed"
	s.state.Detail = ""
	s.state.Error = err.Error()
	s.publishLocked()
}

func (s *Status) Current() State {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state
}

// A slow reader is handed the newest state, never a backlog.
func (s *Status) Subscribe() (<-chan State, State, func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ch := make(chan State, 1)
	s.subs[ch] = struct{}{}
	return ch, s.state, func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		delete(s.subs, ch)
	}
}

func (s *Status) publishLocked() {
	if s.trailing != nil {
		s.trailing.Stop()
		s.trailing = nil
	}
	s.published = time.Now()
	s.generation++
	for ch := range s.subs {
		select {
		case <-ch:
		default:
		}
		ch <- s.state
	}
}

func installing(stage string) bool {
	return stage != "pending" && stage != "ready" && stage != "failed"
}

func lastLine(chunk string) string {
	lines := strings.Split(strings.TrimSpace(chunk), "\n")
	line := []rune(strings.TrimSpace(lines[len(lines)-1]))
	if len(line) > maxDetail {
		return string(line[:maxDetail]) + "…"
	}
	return string(line)
}
