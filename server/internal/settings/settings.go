package settings

import (
	"database/sql"
	"errors"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
)

const cacheTTL = time.Minute

var validKey = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)

type Masked struct {
	Key         string `json:"key"`
	MaskedValue string `json:"maskedValue"`
}

type entry struct {
	value   string
	expires time.Time
}

type Service struct {
	app   core.App
	mu    sync.Mutex
	cache map[string]entry
}

func New(app core.App) *Service {
	return &Service{app: app, cache: map[string]entry{}}
}

func cacheKey(userID, key string) string {
	return userID + ":" + key
}

func (s *Service) Get(key, userID string) (string, error) {
	if userID == "" || !validKey.MatchString(key) {
		return "", nil
	}
	ck := cacheKey(userID, key)
	s.mu.Lock()
	if cached, ok := s.cache[ck]; ok && cached.expires.After(time.Now()) {
		s.mu.Unlock()
		return cached.value, nil
	}
	s.mu.Unlock()

	rec, err := s.find(key, userID)
	if err != nil {
		return "", err
	}
	if rec == nil {
		return "", nil
	}
	value := rec.GetString("value")
	if value != "" {
		s.store(ck, value)
	}
	return value, nil
}

func (s *Service) Set(key, value, userID string) error {
	if err := assertValidKey(key); err != nil {
		return err
	}
	err := s.app.RunInTransaction(func(tx core.App) error {
		rec, err := findIn(tx, key, userID)
		if err != nil {
			return err
		}
		if rec == nil {
			col, err := tx.FindCollectionByNameOrId("settings")
			if err != nil {
				return err
			}
			rec = core.NewRecord(col)
			rec.Set("user", userID)
		}
		rec.Set("key", key)
		rec.Set("value", value)
		return tx.Save(rec)
	})
	if err != nil {
		return err
	}
	s.store(cacheKey(userID, key), value)
	return nil
}

func (s *Service) Delete(key, userID string) error {
	if err := assertValidKey(key); err != nil {
		return err
	}
	rec, err := s.find(key, userID)
	if err != nil {
		return err
	}
	if rec != nil {
		if err := s.app.Delete(rec); err != nil {
			return err
		}
	}
	s.mu.Lock()
	delete(s.cache, cacheKey(userID, key))
	s.mu.Unlock()
	return nil
}

func (s *Service) ListMasked(userID string) ([]Masked, error) {
	records, err := s.app.FindRecordsByFilter("settings", "user = {:userId}", "-created", 0, 0, dbx.Params{"userId": userID})
	if err != nil {
		return nil, err
	}
	out := make([]Masked, 0, len(records))
	for _, rec := range records {
		out = append(out, Masked{Key: rec.GetString("key"), MaskedValue: mask(rec.GetString("value"))})
	}
	return out, nil
}

func (s *Service) find(key, userID string) (*core.Record, error) {
	return findIn(s.app, key, userID)
}

func findIn(app core.App, key, userID string) (*core.Record, error) {
	rec, err := app.FindFirstRecordByFilter("settings", "key = {:key} && user = {:userId}", dbx.Params{"key": key, "userId": userID})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return rec, err
}

func (s *Service) store(ck, value string) {
	s.mu.Lock()
	s.cache[ck] = entry{value: value, expires: time.Now().Add(cacheTTL)}
	s.mu.Unlock()
}

func assertValidKey(key string) error {
	if !validKey.MatchString(key) {
		return apierr.BadRequest(apierr.CodeSettingsInvalidKey, `Invalid setting key "`+key+`".`)
	}
	return nil
}

func ValidKey(key string) bool {
	return validKey.MatchString(key)
}

func mask(value string) string {
	if len(value) <= 4 {
		return "****"
	}
	return value[:4] + strings.Repeat("*", min(len(value)-4, 12))
}
