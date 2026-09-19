package auth

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
)

const (
	InvitePrefix = "inv_"
	inviteTTL    = 7 * 24 * time.Hour
)

type Invite struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	ExpiresAt string `json:"expiresAt"`
	Created   string `json:"created"`
}

type InviteCreated struct {
	Invite
	Token string `json:"token"`
}

type Invites struct {
	app core.App
}

func NewInvites(app core.App) *Invites {
	return &Invites{app: app}
}

func (i *Invites) Create(invitedBy, email string) (*InviteCreated, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	switch _, err := i.app.FindAuthRecordByEmail("users", email); {
	case err == nil:
		return nil, apierr.BadRequest(apierr.CodeAuthEmailTaken, "An account with this email already exists")
	case !errors.Is(err, sql.ErrNoRows):
		return nil, err
	}
	// The unique index covers expired rows too, so one has to go before its replacement lands.
	if stale, err := i.pendingFor(email); err != nil {
		return nil, err
	} else if stale != nil {
		if stale.GetDateTime("expiresAt").Time().After(time.Now()) {
			return nil, apierr.BadRequest(apierr.CodeInviteAlreadyPending, "This address already has a pending invitation")
		}
		if err := i.app.Delete(stale); err != nil {
			return nil, err
		}
	}
	col, err := i.app.FindCollectionByNameOrId("invitations")
	if err != nil {
		return nil, err
	}
	token := InvitePrefix + GenerateSecret()[len(KeyPrefix):]
	rec := core.NewRecord(col)
	rec.Set("email", email)
	rec.Set("hash", HashSecret(token))
	rec.Set("invitedBy", invitedBy)
	rec.Set("expiresAt", types.NowDateTime().Add(inviteTTL))
	if err := i.app.Save(rec); err != nil {
		return nil, err
	}
	return &InviteCreated{Invite: toInvite(rec), Token: token}, nil
}

func (i *Invites) ListPending() ([]Invite, error) {
	records, err := i.app.FindRecordsByFilter("invitations", "acceptedAt = ''", "-created", 0, 0)
	if err != nil {
		return nil, err
	}
	out := make([]Invite, 0, len(records))
	for _, rec := range records {
		out = append(out, toInvite(rec))
	}
	return out, nil
}

func (i *Invites) Revoke(id string) error {
	rec, err := i.app.FindRecordById("invitations", id)
	if errors.Is(err, sql.ErrNoRows) {
		return apierr.NotFound(apierr.CodeInviteNotFound, "Invitation not found")
	}
	if err != nil {
		return err
	}
	return i.app.Delete(rec)
}

// Resolve reports the invitation a token opens, so the sign-up form can show whose address it is.
func (i *Invites) Resolve(token string) (*Invite, error) {
	rec, err := i.find(token)
	if err != nil {
		return nil, err
	}
	out := toInvite(rec)
	return &out, nil
}

// Bound to a transaction, so that claiming an invitation and creating the account it
// opens either both happen or neither does.
func (i *Invites) With(app core.App) *Invites {
	return &Invites{app: app}
}

// An invitation is not a blank cheque for whatever email the form happens to carry.
func (i *Invites) Claim(token, email string) error {
	rec, err := i.find(token)
	if err != nil {
		return err
	}
	if !strings.EqualFold(rec.GetString("email"), strings.TrimSpace(email)) {
		return apierr.BadRequest(apierr.CodeInviteEmailMismatch, "This invitation was issued to a different address")
	}
	rec.Set("acceptedAt", types.NowDateTime())
	return i.app.Save(rec)
}

func (i *Invites) find(token string) (*core.Record, error) {
	if !strings.HasPrefix(token, InvitePrefix) {
		return nil, apierr.NotFound(apierr.CodeInviteNotFound, "Invitation not found")
	}
	rec, err := i.app.FindFirstRecordByFilter("invitations", "hash = {:hash}", dbx.Params{"hash": HashSecret(token)})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apierr.NotFound(apierr.CodeInviteNotFound, "Invitation not found")
	}
	if err != nil {
		return nil, err
	}
	if !rec.GetDateTime("acceptedAt").IsZero() {
		return nil, apierr.BadRequest(apierr.CodeInviteAlreadyUsed, "This invitation has already been used")
	}
	if rec.GetDateTime("expiresAt").Time().Before(time.Now()) {
		return nil, apierr.BadRequest(apierr.CodeInviteExpired, "This invitation has expired")
	}
	return rec, nil
}

func (i *Invites) pendingFor(email string) (*core.Record, error) {
	rec, err := i.app.FindFirstRecordByFilter("invitations", "email = {:email} && acceptedAt = ''", dbx.Params{"email": email})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return rec, err
}

func toInvite(rec *core.Record) Invite {
	return Invite{
		ID:        rec.Id,
		Email:     rec.GetString("email"),
		ExpiresAt: rec.GetDateTime("expiresAt").String(),
		Created:   rec.GetDateTime("created").String(),
	}
}
