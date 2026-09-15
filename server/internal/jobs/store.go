package jobs

import (
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/tools/security"
)

type Status string

const (
	Running   Status = "running"
	Completed Status = "completed"
	Failed    Status = "failed"
)

type Type string

const (
	ModelPull      Type = "model_pull"
	ModelImport    Type = "model_import"
	BackendInstall Type = "backend_install"
)

// Mirrors shared/src/types/job.type.ts field for field.
type Job struct {
	ID          string `json:"id"`
	Type        Type   `json:"type"`
	Status      Status `json:"status"`
	Progress    int    `json:"progress"`
	Label       string `json:"label"`
	Target      string `json:"target,omitempty"`
	Error       string `json:"error,omitempty"`
	CreatedAt   int64  `json:"createdAt"`
	CompletedAt int64  `json:"completedAt,omitempty"`
}

type Update struct {
	Removed bool
	ID      string
	Job     Job
}

type Subscriber struct {
	C  <-chan Update
	ch chan Update
}

const (
	defaultThrottle   = 100 * time.Millisecond
	defaultTTL        = 30 * time.Second
	subscriberBacklog = 256
)

type Store struct {
	mu           sync.Mutex
	jobs         map[string]Job
	subs         map[*Subscriber]struct{}
	pending      map[string]Job
	pendingOrder []string
	flushTimer   *time.Timer
	ttlTimers    map[string]*time.Timer
	throttle     time.Duration
	ttl          time.Duration
	now          func() time.Time
	closed       bool
}

func New() *Store {
	return NewWithTiming(defaultThrottle, defaultTTL)
}

func NewWithTiming(throttle, ttl time.Duration) *Store {
	return &Store{
		jobs:      map[string]Job{},
		subs:      map[*Subscriber]struct{}{},
		pending:   map[string]Job{},
		ttlTimers: map[string]*time.Timer{},
		throttle:  throttle,
		ttl:       ttl,
		now:       time.Now,
	}
}

func NewID() string {
	return "job_" + strconv.FormatInt(time.Now().UnixMilli(), 36) + "_" + security.RandomStringWithAlphabet(6, "0123456789abcdefghijklmnopqrstuvwxyz")
}

func (s *Store) List() []Job {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.listLocked()
}

func (s *Store) listLocked() []Job {
	out := make([]Job, 0, len(s.jobs))
	for _, j := range s.jobs {
		out = append(out, j)
	}
	sort.SliceStable(out, func(i, k int) bool { return out[i].CreatedAt > out[k].CreatedAt })
	return out
}

func (s *Store) Get(id string) (Job, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, ok := s.jobs[id]
	return j, ok
}

func (s *Store) FindRunning(t Type, target string) (Job, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, j := range s.jobs {
		if j.Status == Running && j.Type == t && j.Target == target {
			return j, true
		}
	}
	return Job{}, false
}

func (s *Store) Start(id string, t Type, label, target string) Job {
	s.mu.Lock()
	defer s.mu.Unlock()
	j := Job{ID: id, Type: t, Status: Running, Label: label, Target: target, CreatedAt: s.now().UnixMilli()}
	s.jobs[id] = j
	s.emitLocked(Update{ID: id, Job: j})
	return j
}

func (s *Store) Progress(id string, progress float64, label string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, ok := s.jobs[id]
	if !ok || j.Status != Running {
		return
	}
	next := j
	next.Progress = max(0, min(100, int(progress+0.5)))
	if label != "" {
		next.Label = label
	}
	if next.Progress == j.Progress && next.Label == j.Label {
		return
	}
	s.jobs[id] = next
	if _, queued := s.pending[id]; !queued {
		s.pendingOrder = append(s.pendingOrder, id)
	}
	s.pending[id] = next
	if s.flushTimer == nil && !s.closed {
		s.flushTimer = time.AfterFunc(s.throttle, s.flush)
	}
}

func (s *Store) flush() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.flushTimer = nil
	for _, id := range s.pendingOrder {
		if j, ok := s.pending[id]; ok {
			s.emitLocked(Update{ID: id, Job: j})
		}
	}
	s.pending = map[string]Job{}
	s.pendingOrder = nil
}

func (s *Store) Complete(id string) {
	s.finish(id, Completed, "")
}

func (s *Store) Fail(id string, errMsg string) {
	s.finish(id, Failed, errMsg)
}

func (s *Store) finish(id string, status Status, errMsg string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, ok := s.jobs[id]
	if !ok || j.Status != Running {
		return
	}
	delete(s.pending, id)
	j.Status = status
	j.CompletedAt = s.now().UnixMilli()
	if status == Completed {
		j.Progress = 100
	} else {
		j.Error = errMsg
	}
	s.jobs[id] = j
	s.emitLocked(Update{ID: id, Job: j})
	if t, ok := s.ttlTimers[id]; ok {
		t.Stop()
	}
	if !s.closed {
		s.ttlTimers[id] = time.AfterFunc(s.ttl, func() { s.Remove(id) })
	}
}

func (s *Store) Dismiss(id string) bool {
	s.mu.Lock()
	j, ok := s.jobs[id]
	if !ok || j.Status == Running {
		s.mu.Unlock()
		return false
	}
	s.mu.Unlock()
	s.Remove(id)
	return true
}

func (s *Store) Remove(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.jobs[id]; !ok {
		return
	}
	delete(s.jobs, id)
	delete(s.pending, id)
	if t, ok := s.ttlTimers[id]; ok {
		t.Stop()
		delete(s.ttlTimers, id)
	}
	s.emitLocked(Update{Removed: true, ID: id})
}

// Registration and snapshot share the critical section so no update slips between them.
func (s *Store) Subscribe() (*Subscriber, []Job) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ch := make(chan Update, subscriberBacklog)
	sub := &Subscriber{C: ch, ch: ch}
	if s.closed {
		close(ch)
		return sub, s.listLocked()
	}
	s.subs[sub] = struct{}{}
	return sub, s.listLocked()
}

func (s *Store) Unsubscribe(sub *Subscriber) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.subs[sub]; ok {
		delete(s.subs, sub)
		close(sub.ch)
	}
}

func (s *Store) emitLocked(u Update) {
	for sub := range s.subs {
		select {
		case sub.ch <- u:
		default:
			delete(s.subs, sub)
			close(sub.ch)
		}
	}
}

func (s *Store) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	if s.flushTimer != nil {
		s.flushTimer.Stop()
		s.flushTimer = nil
	}
	for id, t := range s.ttlTimers {
		t.Stop()
		delete(s.ttlTimers, id)
	}
	for sub := range s.subs {
		delete(s.subs, sub)
		close(sub.ch)
	}
}
