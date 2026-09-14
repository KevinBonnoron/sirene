package auth

import (
	"slices"

	"github.com/pocketbase/pocketbase/core"
)

const (
	TypeJWT    = "jwt"
	TypeAPIKey = "api-key"

	identityKey = "sirene.identity"
)

type Identity struct {
	UserID string
	// nil means unrestricted; an array restricts the caller to exactly those scopes.
	Scopes []string
	Type   string
}

func (i *Identity) Restricted() bool {
	return i.Scopes != nil
}

func (i *Identity) HasScope(scope string) bool {
	return i.Scopes == nil || slices.Contains(i.Scopes, scope)
}

func IdentityOf(e *core.RequestEvent) *Identity {
	id, _ := e.Get(identityKey).(*Identity)
	return id
}

func setIdentity(e *core.RequestEvent, id *Identity) {
	e.Set(identityKey, id)
}
