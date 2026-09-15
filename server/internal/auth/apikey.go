package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
)

const (
	KeyPrefix        = "sk_"
	secretBytes      = 24
	prefixDisplayLen = len(KeyPrefix) + 8
	lastUsedDebounce = 5 * time.Minute
)

type KeySummary struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Prefix     string   `json:"prefix"`
	Scopes     []string `json:"scopes"`
	LastUsedAt string   `json:"lastUsedAt,omitempty"`
	Created    string   `json:"created"`
}

type KeyCreated struct {
	KeySummary
	Secret string `json:"secret"`
}

type ResolvedKey struct {
	UserID string
	Scopes []string
}

type APIKeys struct {
	app core.App
}

func NewAPIKeys(app core.App) *APIKeys {
	return &APIKeys{app: app}
}

func GenerateSecret() string {
	b := make([]byte, secretBytes)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return KeyPrefix + base64.RawURLEncoding.EncodeToString(b)
}

func HashSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

func (k *APIKeys) Create(userID, name string, scopes *[]string) (*KeyCreated, error) {
	validated, err := NormalizeScopes(scopes)
	if err != nil {
		return nil, err
	}
	col, err := k.app.FindCollectionByNameOrId("api_keys")
	if err != nil {
		return nil, err
	}
	secret := GenerateSecret()
	rec := core.NewRecord(col)
	rec.Set("user", userID)
	rec.Set("name", name)
	rec.Set("prefix", secret[:prefixDisplayLen])
	rec.Set("hash", HashSecret(secret))
	if validated == nil {
		rec.Set("scopes", nil)
	} else {
		rec.Set("scopes", validated)
	}
	if err := k.app.Save(rec); err != nil {
		return nil, err
	}
	return &KeyCreated{KeySummary: toSummary(rec), Secret: secret}, nil
}

func (k *APIKeys) ListForUser(userID string) ([]KeySummary, error) {
	records, err := k.app.FindRecordsByFilter("api_keys", "user = {:userId}", "-created", 0, 0, dbx.Params{"userId": userID})
	if err != nil {
		return nil, err
	}
	out := make([]KeySummary, 0, len(records))
	for _, rec := range records {
		out = append(out, toSummary(rec))
	}
	return out, nil
}

func (k *APIKeys) Revoke(userID, id string) error {
	rec, err := k.app.FindRecordById("api_keys", id)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && rec.GetString("user") != userID) {
		return apierr.NotFound(apierr.CodeApiKeyNotFound, "API key not found")
	}
	if err != nil {
		return err
	}
	return k.app.Delete(rec)
}

func (k *APIKeys) Resolve(secret string) (*ResolvedKey, error) {
	if !strings.HasPrefix(secret, KeyPrefix) {
		return nil, nil
	}
	rec, err := k.app.FindFirstRecordByFilter("api_keys", "hash = {:hash}", dbx.Params{"hash": HashSecret(secret)})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	scopes, malformed := readScopes(rec)
	if malformed {
		k.app.Logger().Warn("[apiKey/resolve] rejecting key with malformed scopes", "id", rec.Id)
		return nil, nil
	}
	last := rec.GetDateTime("lastUsedAt")
	if last.IsZero() || time.Since(last.Time()) >= lastUsedDebounce {
		go k.touch(rec.Id)
	}
	return &ResolvedKey{UserID: rec.GetString("user"), Scopes: scopes}, nil
}

func (k *APIKeys) touch(id string) {
	rec, err := k.app.FindRecordById("api_keys", id)
	if err != nil {
		return
	}
	rec.Set("lastUsedAt", types.NowDateTime())
	if err := k.app.SaveNoValidate(rec); err != nil {
		k.app.Logger().Warn("[apiKey/resolve] failed to update lastUsedAt", "id", id, "error", err)
	}
}

func readScopes(rec *core.Record) ([]string, bool) {
	raw := strings.TrimSpace(rec.GetString("scopes"))
	if raw == "" || raw == "null" {
		return nil, false
	}
	var values []any
	if err := json.Unmarshal([]byte(raw), &values); err != nil {
		return nil, true
	}
	out := make([]string, 0, len(values))
	for _, v := range values {
		s, ok := v.(string)
		if !ok || !IsKnownScope(s) {
			return nil, true
		}
		out = append(out, s)
	}
	return out, false
}

func toSummary(rec *core.Record) KeySummary {
	scopes, malformed := readScopes(rec)
	if malformed {
		scopes = []string{}
	}
	s := KeySummary{
		ID:      rec.Id,
		Name:    rec.GetString("name"),
		Prefix:  rec.GetString("prefix"),
		Scopes:  scopes,
		Created: rec.GetDateTime("created").String(),
	}
	if last := rec.GetDateTime("lastUsedAt"); !last.IsZero() {
		s.LastUsedAt = last.String()
	}
	return s
}
