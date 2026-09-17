package appconfig

import (
	"database/sql"
	"errors"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const (
	// RegistrationEnabled gates POST /auth/register. Absent means enabled: an instance that
	// upgrades keeps accepting sign-ups until its admin decides otherwise.
	RegistrationEnabled = "registration_enabled"

	cacheTTL = time.Minute
)

var Keys = []string{RegistrationEnabled}

type entry struct {
	value   string
	expires time.Time
}

type Service struct {
	app   core.App
	mu    sync.Mutex
	cache map[string]entry
	// Bumped by every write. A read that started before one landed must not cache what it
	// fetched, or an admin's change would be undone for a whole TTL.
	writes uint64
	// Held across a write's transaction and its cache update, so two writes cannot commit
	// in one order and reach the cache in the other, leaving it on the losing value.
	// Config writes are rare, so serialising them costs nothing.
	writeMu sync.Mutex
}

func New(app core.App) *Service {
	return &Service{app: app, cache: map[string]entry{}}
}

func IsKnownKey(key string) bool {
	for _, k := range Keys {
		if k == key {
			return true
		}
	}
	return false
}

func (s *Service) Get(key string) (string, error) {
	s.mu.Lock()
	if cached, ok := s.cache[key]; ok && cached.expires.After(time.Now()) {
		s.mu.Unlock()
		return cached.value, nil
	}
	seen := s.writes
	s.mu.Unlock()

	rec, err := s.app.FindFirstRecordByFilter("app_config", "key = {:key}", dbx.Params{"key": key})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	value := ""
	if rec != nil {
		value = rec.GetString("value")
	}
	s.mu.Lock()
	if s.writes == seen {
		s.cache[key] = entry{value: value, expires: time.Now().Add(cacheTTL)}
	}
	s.mu.Unlock()
	return value, nil
}

// The error is returned rather than folded into the fallback: on a flag that gates an
// action, a failed read has to refuse it, and only the caller knows how to refuse.
func (s *Service) Bool(key string, fallback bool) (bool, error) {
	value, err := s.Get(key)
	if err != nil {
		return false, err
	}
	switch value {
	case "":
		return fallback, nil
	case "true":
		return true, nil
	default:
		return false, nil
	}
}

func (s *Service) SetBool(key string, value bool) error {
	if value {
		return s.Set(key, "true")
	}
	return s.Set(key, "false")
}

func (s *Service) Set(key, value string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	err := s.app.RunInTransaction(func(tx core.App) error {
		rec, err := tx.FindFirstRecordByFilter("app_config", "key = {:key}", dbx.Params{"key": key})
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if rec == nil {
			col, err := tx.FindCollectionByNameOrId("app_config")
			if err != nil {
				return err
			}
			rec = core.NewRecord(col)
			rec.Set("key", key)
		}
		rec.Set("value", value)
		return tx.Save(rec)
	})
	if err != nil {
		return err
	}
	s.store(key, value)
	return nil
}

func (s *Service) store(key, value string) {
	s.mu.Lock()
	s.writes++
	s.cache[key] = entry{value: value, expires: time.Now().Add(cacheTTL)}
	s.mu.Unlock()
}
