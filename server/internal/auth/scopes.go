package auth

import (
	"fmt"
	"slices"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
)

// Mirrors API_KEY_SCOPES in shared/src/types/api-key.type.ts.
var Scopes = []string{
	"generate", "transcribe",
	"voices:read", "voices:write",
	"models:read", "models:write",
	"generations:read", "generations:write",
	"sessions:read", "sessions:write",
	"inference-servers:read", "inference-servers:write",
	"settings:read", "settings:write",
}

func IsKnownScope(scope string) bool {
	return slices.Contains(Scopes, scope)
}

// NormalizeScopes validates a caller-supplied scope list: nil means full
// access, an empty list is refused (callers must say "null" explicitly), and
// every entry must be a known scope.
func NormalizeScopes(scopes *[]string) ([]string, error) {
	if scopes == nil {
		return nil, nil
	}
	if len(*scopes) == 0 {
		return nil, apierr.BadRequest(apierr.CodeApiKeyUnknownScope, "Empty scope list is not allowed: pass null for full access or at least one scope to restrict.")
	}
	for _, s := range *scopes {
		if !IsKnownScope(s) {
			return nil, apierr.BadRequest(apierr.CodeApiKeyUnknownScope, fmt.Sprintf("Unknown scope: %s", s))
		}
	}
	return slices.Clone(*scopes), nil
}
