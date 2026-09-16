package infsrv

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
)

const (
	RegistrationTokenPrefix = "sr_"
	registrationTokenTTL    = time.Hour
	maxNameSuffix           = 20
)

// Tokens stay valid until expiry, not single-use: a worker may restart and re-register.
type Registrations struct {
	mu     sync.Mutex
	tokens map[string]time.Time
	now    func() time.Time
}

func NewRegistrations() *Registrations {
	return &Registrations{tokens: map[string]time.Time{}, now: time.Now}
}

func (r *Registrations) Issue() (token string, expiresAt time.Time) {
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		panic(err)
	}
	token = RegistrationTokenPrefix + base64.RawURLEncoding.EncodeToString(raw)
	expiresAt = r.now().Add(registrationTokenTTL)
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sweep()
	r.tokens[token] = expiresAt
	return token, expiresAt
}

// Identity is a non-secret handle for a token, stored on the server it registers so the issuing dialog can recognise it.
func Identity(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:6])
}

func (r *Registrations) Valid(token string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sweep()
	_, ok := r.tokens[token]
	return ok
}

func (r *Registrations) sweep() {
	now := r.now()
	for tok, exp := range r.tokens {
		if exp.Before(now) {
			delete(r.tokens, tok)
		}
	}
}

func (s *Service) Upsert(in WriteInput) (rec *core.Record, created bool, err error) {
	url := strings.TrimSuffix(in.URL, "/")
	existing, err := s.app.FindFirstRecordByFilter("inference_servers", "url = {:url}", map[string]any{"url": url})
	if err != nil && !isNoRows(err) {
		return nil, false, err
	}
	if existing != nil {
		name := in.Name
		if name != existing.GetString("name") {
			if taken, err := s.nameTakenByOther(name, existing.Id); err != nil {
				return nil, false, err
			} else if taken {
				name = existing.GetString("name")
			}
		}
		rec, err = s.Update(existing.Id, UpdateInput{Name: &name, AuthToken: in.AuthToken, Registration: &in.Registration})
		return rec, false, err
	}
	name, err := s.freeName(in.Name)
	if err != nil {
		return nil, false, err
	}
	rec, err = s.Create(WriteInput{Name: name, URL: url, Enabled: true, Priority: in.Priority, AuthToken: in.AuthToken, Registration: in.Registration})
	if err != nil {
		if winner, findErr := s.app.FindFirstRecordByFilter("inference_servers", "url = {:url}", map[string]any{"url": url}); findErr == nil {
			rec, err = s.Update(winner.Id, UpdateInput{AuthToken: in.AuthToken, Registration: &in.Registration})
			return rec, false, err
		}
		return nil, false, err
	}
	s.onChange(rec.Id)
	return rec, true, nil
}

func (s *Service) freeName(base string) (string, error) {
	for i := 1; i <= maxNameSuffix; i++ {
		name := base
		if i > 1 {
			name = fmt.Sprintf("%s-%d", base, i)
		}
		taken, err := s.nameTakenByOther(name, "")
		if err != nil {
			return "", err
		}
		if !taken {
			return name, nil
		}
	}
	return "", apierr.Conflict(apierr.CodeInferenceServerNameTaken, "Too many servers share this name")
}

func isNoRows(err error) bool {
	return errors.Is(err, sql.ErrNoRows)
}

func (s *Service) nameTakenByOther(name, selfID string) (bool, error) {
	rec, err := s.app.FindFirstRecordByFilter("inference_servers", "name = {:name}", map[string]any{"name": name})
	if err != nil {
		if isNoRows(err) {
			return false, nil
		}
		return false, err
	}
	return rec.Id != selfID, nil
}
