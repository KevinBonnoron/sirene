package auth

import (
	"crypto/rand"
	"encoding/base64"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/tools/security"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
)

const (
	cliSessionTTL   = 10 * time.Minute
	cliPollInterval = 2
	// No 0/O/1/I/L so the code survives being read aloud or copied from a noisy terminal.
	userCodeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
)

var whitespace = regexp.MustCompile(`\s+`)

type cliStatus string

const (
	cliPending     cliStatus = "pending"
	cliAuthorizing cliStatus = "authorizing"
	cliAuthorized  cliStatus = "authorized"
	cliConsumed    cliStatus = "consumed"
)

type cliSession struct {
	deviceCode      string
	userCode        string
	expiresAt       time.Time
	status          cliStatus
	requestedScopes []string
	apiKeyName      string
	secret          string
}

type CliStartResult struct {
	DeviceCode      string `json:"deviceCode"`
	UserCode        string `json:"userCode"`
	VerificationURI string `json:"verificationUri"`
	ExpiresIn       int    `json:"expiresIn"`
	Interval        int    `json:"interval"`
}

type CliLookupResult struct {
	Code            string   `json:"code"`
	ExpiresAt       string   `json:"expiresAt"`
	Status          string   `json:"status"`
	RequestedScopes []string `json:"requestedScopes"`
}

type CliPollResult struct {
	Status string `json:"status"`
	Secret string `json:"secret,omitempty"`
	Name   string `json:"name,omitempty"`
}

type CliAuth struct {
	mu       sync.Mutex
	byDevice map[string]*cliSession
	byUser   map[string]string
	keys     *APIKeys
	now      func() time.Time
}

func NewCliAuth(keys *APIKeys) *CliAuth {
	return &CliAuth{byDevice: map[string]*cliSession{}, byUser: map[string]string{}, keys: keys, now: time.Now}
}

func generateUserCode() string {
	raw := security.RandomStringWithAlphabet(8, userCodeAlphabet)
	return raw[:4] + "-" + raw[4:]
}

func (c *CliAuth) sweep() {
	now := c.now()
	for code, s := range c.byDevice {
		if s.expiresAt.Before(now) {
			delete(c.byDevice, code)
			delete(c.byUser, s.userCode)
		}
	}
}

func (c *CliAuth) byUserCode(input string) *cliSession {
	normalised := strings.ToUpper(whitespace.ReplaceAllString(input, ""))
	device, ok := c.byUser[normalised]
	if !ok {
		return nil
	}
	return c.byDevice[device]
}

func (c *CliAuth) Start(verificationURI string, requested *[]string) (*CliStartResult, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.sweep()

	var scopes []string
	if requested != nil {
		if len(*requested) == 0 {
			return nil, apierr.BadRequest(apierr.CodeApiKeyUnknownScope, "Requested scope list cannot be empty: pass null for full access.")
		}
		var unknown []string
		for _, s := range *requested {
			if !IsKnownScope(s) {
				unknown = append(unknown, s)
			}
		}
		if len(unknown) > 0 {
			return nil, apierr.BadRequest(apierr.CodeApiKeyUnknownScope, "Unknown scope(s): "+strings.Join(unknown, ", "))
		}
		scopes = slices.Clone(*requested)
	}

	userCode := generateUserCode()
	for {
		if _, taken := c.byUser[userCode]; !taken {
			break
		}
		userCode = generateUserCode()
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	deviceCode := base64.RawURLEncoding.EncodeToString(b)

	c.byDevice[deviceCode] = &cliSession{
		deviceCode:      deviceCode,
		userCode:        userCode,
		expiresAt:       c.now().Add(cliSessionTTL),
		status:          cliPending,
		requestedScopes: scopes,
	}
	c.byUser[userCode] = deviceCode

	return &CliStartResult{
		DeviceCode:      deviceCode,
		UserCode:        userCode,
		VerificationURI: verificationURI,
		ExpiresIn:       int(cliSessionTTL.Seconds()),
		Interval:        cliPollInterval,
	}, nil
}

func (c *CliAuth) Lookup(userCode string) (*CliLookupResult, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.sweep()
	s := c.byUserCode(userCode)
	if s == nil {
		return nil, apierr.NotFound(apierr.CodeCliAuthSessionNotFound, "CLI session not found or expired")
	}
	status := s.status
	if status == cliAuthorizing {
		status = cliAuthorized
	}
	return &CliLookupResult{
		Code:            s.userCode,
		ExpiresAt:       s.expiresAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		Status:          string(status),
		RequestedScopes: s.requestedScopes,
	}, nil
}

func (c *CliAuth) Approve(userCode, userID, name string, scopes *[]string) error {
	c.mu.Lock()
	c.sweep()
	s := c.byUserCode(userCode)
	if s == nil {
		c.mu.Unlock()
		return apierr.NotFound(apierr.CodeCliAuthSessionNotFound, "CLI session not found or expired")
	}
	if s.status != cliPending {
		c.mu.Unlock()
		return apierr.BadRequest(apierr.CodeCliAuthSessionAlreadyUsed, "CLI session already used")
	}

	// The user may narrow what the CLI asked for but never broaden it.
	var granted *[]string
	if s.requestedScopes == nil {
		granted = scopes
	} else if scopes == nil || len(*scopes) == 0 {
		requested := slices.Clone(s.requestedScopes)
		granted = &requested
	} else {
		for _, sc := range *scopes {
			if !slices.Contains(s.requestedScopes, sc) {
				c.mu.Unlock()
				return apierr.BadRequest(apierr.CodeApiKeyUnknownScope, "Granted scopes must be a subset of the requested scopes")
			}
		}
		granted = scopes
	}

	s.status = cliAuthorizing
	c.mu.Unlock()

	created, err := c.keys.Create(userID, name, granted)

	c.mu.Lock()
	defer c.mu.Unlock()
	if err != nil {
		s.status = cliPending
		return err
	}
	// The session may have expired while the key was being minted; a key
	// nobody can ever collect must not survive.
	if live, ok := c.byDevice[s.deviceCode]; !ok || live != s {
		if rerr := c.keys.Revoke(userID, created.ID); rerr != nil {
			return rerr
		}
		return apierr.NotFound(apierr.CodeCliAuthSessionNotFound, "CLI session not found or expired")
	}
	s.status = cliAuthorized
	s.apiKeyName = created.Name
	s.secret = created.Secret
	return nil
}

func (c *CliAuth) Poll(deviceCode string) CliPollResult {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.sweep()
	s, ok := c.byDevice[deviceCode]
	if !ok {
		return CliPollResult{Status: "expired"}
	}
	switch s.status {
	case cliPending, cliAuthorizing:
		return CliPollResult{Status: "pending"}
	case cliAuthorized:
		if s.secret != "" && s.apiKeyName != "" {
			out := CliPollResult{Status: "authorized", Secret: s.secret, Name: s.apiKeyName}
			s.status = cliConsumed
			s.secret = ""
			delete(c.byDevice, deviceCode)
			delete(c.byUser, s.userCode)
			return out
		}
	}
	return CliPollResult{Status: "expired"}
}
