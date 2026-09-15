package infsrv

import (
	"strings"
	"testing"
	"time"
)

func TestRegistrationsIssueAndExpire(t *testing.T) {
	now := time.Date(2026, 9, 15, 10, 0, 0, 0, time.UTC)
	r := NewRegistrations()
	r.now = func() time.Time { return now }

	token, exp := r.Issue()
	if !strings.HasPrefix(token, RegistrationTokenPrefix) || len(token) < 20 {
		t.Fatalf("unexpected token %q", token)
	}
	if exp != now.Add(registrationTokenTTL) {
		t.Fatalf("expiry = %v, want %v", exp, now.Add(registrationTokenTTL))
	}
	if !r.Valid(token) {
		t.Fatal("fresh token should be valid")
	}
	if !r.Valid(token) {
		t.Fatal("token must stay valid until it expires, not be single-use")
	}
	if r.Valid("sr_nope") {
		t.Fatal("unknown token accepted")
	}

	now = now.Add(registrationTokenTTL + time.Second)
	if r.Valid(token) {
		t.Fatal("expired token accepted")
	}
	if len(r.tokens) != 0 {
		t.Fatalf("expired token not swept: %d left", len(r.tokens))
	}
}
