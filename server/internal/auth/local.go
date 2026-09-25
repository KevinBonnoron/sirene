package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"errors"
	"os/user"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// Not a real mailbox: the address only has to be valid for PocketBase to accept the record.
const localEmail = "owner@sirene.local"

// The password is random and never stored: the desktop window reaches the account through its secret.
func ProvisionLocalAccount(app core.App) error {
	count, err := app.CountRecords("users")
	if err != nil || count > 0 {
		return err
	}
	col, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}
	password := make([]byte, 32)
	if _, err := rand.Read(password); err != nil {
		return err
	}
	rec := core.NewRecord(col)
	rec.SetEmail(localEmail)
	rec.SetPassword(base64.RawURLEncoding.EncodeToString(password))
	rec.Set("name", localName())
	rec.SetVerified(true)
	return app.Save(rec)
}

// The admin, so an install that onboarded by hand keeps its own account and data.
func LocalAccount(app core.App, secret, presented string) (*core.Record, error) {
	if secret == "" || subtle.ConstantTimeCompare([]byte(secret), []byte(presented)) != 1 {
		return nil, errors.New("not the desktop window")
	}
	rec, err := app.FindFirstRecordByFilter("users", "role = 'admin'")
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errors.New("no local account yet")
	}
	return rec, err
}

func localName() string {
	u, err := user.Current()
	if err != nil {
		return "Local"
	}
	name := u.Name
	if name == "" {
		name = u.Username
	}
	// Windows reports DOMAIN\user.
	if i := strings.LastIndex(name, `\`); i >= 0 {
		name = name[i+1:]
	}
	if name == "" {
		return "Local"
	}
	return name
}
