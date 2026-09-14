package auth

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"

	validation "github.com/go-ozzo/ozzo-validation/v4"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
)

// Envelope turns every error returned by a Sirene handler into the
// {code, message} body the client and CLI understand. Returning nil after
// writing keeps PocketBase's own error handler out of the way.
func Envelope() *hook.Handler[*core.RequestEvent] {
	return &hook.Handler[*core.RequestEvent]{
		Id: "sireneEnvelope",
		Func: func(e *core.RequestEvent) (err error) {
			defer func() {
				if r := recover(); r != nil {
					e.App.Logger().Error("[api] panic", "error", fmt.Sprint(r), "path", e.Request.URL.Path)
					if !e.Written() {
						err = writeError(e, apierr.Internal())
					}
				}
			}()
			err = e.Next()
			if err == nil {
				return nil
			}
			if e.Written() {
				e.App.Logger().Warn("[api] error after response started", "error", err, "path", e.Request.URL.Path)
				return nil
			}
			return writeError(e, err)
		},
	}
}

func writeError(e *core.RequestEvent, err error) error {
	var se *apierr.Error
	if errors.As(err, &se) {
		body := map[string]any{"code": se.Code, "message": se.Message}
		for k, v := range se.Extra {
			body[k] = v
		}
		return e.JSON(se.Status, body)
	}
	if errors.Is(err, apis.ErrRequestEntityTooLarge) {
		return e.JSON(http.StatusRequestEntityTooLarge, map[string]string{"code": apierr.CodeTooLarge, "message": "Request entity too large"})
	}
	if errors.Is(err, sql.ErrNoRows) {
		return e.JSON(http.StatusNotFound, map[string]string{"code": apierr.CodeNotFound, "message": "Not found"})
	}
	var ve validation.Errors
	if errors.As(err, &ve) {
		return e.JSON(http.StatusBadRequest, map[string]string{"code": apierr.CodeValidation, "message": ve.Error()})
	}
	var ae *router.ApiError
	if errors.As(err, &ae) {
		code := apierr.CodeInternal
		switch ae.Status {
		case http.StatusBadRequest:
			code = apierr.CodeValidation
		case http.StatusUnauthorized:
			code = apierr.CodeAuthRequired
		case http.StatusForbidden:
			code = apierr.CodeAuthForbidden
		case http.StatusNotFound:
			code = apierr.CodeNotFound
		case http.StatusRequestEntityTooLarge:
			code = apierr.CodeTooLarge
		}
		if ae.Status >= 500 {
			e.App.Logger().Error("[api] upstream api error", "status", ae.Status, "error", ae.Message, "data", ae.RawData())
		}
		return e.JSON(ae.Status, map[string]string{"code": code, "message": ae.Message})
	}
	e.App.Logger().Error("[api] unhandled error", "error", err, "path", e.Request.URL.Path)
	return e.JSON(http.StatusInternalServerError, map[string]string{"code": apierr.CodeInternal, "message": "Internal error"})
}

// Resolve identifies the caller. API keys (sk_ prefix) are looked up by hash
// and load the owning user into e.Auth so PocketBase rules keep working;
// PocketBase's own loadAuthToken middleware already resolved users tokens.
func Resolve(keys *APIKeys) *hook.Handler[*core.RequestEvent] {
	return &hook.Handler[*core.RequestEvent]{
		Id: "sireneResolve",
		Func: func(e *core.RequestEvent) error {
			token, ok := bearer(e)
			if ok && strings.HasPrefix(token, KeyPrefix) {
				resolved, err := keys.Resolve(token)
				if err != nil {
					return err
				}
				if resolved == nil {
					return apierr.Unauthorized(apierr.CodeAuthInvalidToken, "Invalid API key")
				}
				user, err := e.App.FindRecordById("users", resolved.UserID)
				if errors.Is(err, sql.ErrNoRows) {
					return apierr.Unauthorized(apierr.CodeAuthInvalidToken, "Invalid API key")
				}
				if err != nil {
					return err
				}
				e.Auth = user
				setIdentity(e, &Identity{UserID: user.Id, Scopes: resolved.Scopes, Type: TypeAPIKey})
				return e.Next()
			}
			if e.Auth != nil && e.Auth.Collection().Name == "users" {
				setIdentity(e, &Identity{UserID: e.Auth.Id, Type: TypeJWT})
			}
			return e.Next()
		},
	}
}

func bearer(e *core.RequestEvent) (string, bool) {
	header := e.Request.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return "", false
	}
	return strings.TrimSpace(header[7:]), true
}

func Bearer(e *core.RequestEvent) (string, bool) {
	return bearer(e)
}

func RequireUser() *hook.Handler[*core.RequestEvent] {
	return &hook.Handler[*core.RequestEvent]{
		Id: "sireneRequireUser",
		Func: func(e *core.RequestEvent) error {
			if IdentityOf(e) == nil {
				return apierr.Unauthorized(apierr.CodeAuthRequired, "Unauthorized")
			}
			return e.Next()
		},
	}
}

func RequireAdmin() *hook.Handler[*core.RequestEvent] {
	return &hook.Handler[*core.RequestEvent]{
		Id: "sireneRequireAdmin",
		Func: func(e *core.RequestEvent) error {
			if e.Auth == nil || e.Auth.GetString("role") != "admin" {
				return apierr.Forbidden(apierr.CodeAuthForbidden, "Forbidden")
			}
			return e.Next()
		},
	}
}

func RequireScope(scope string) *hook.Handler[*core.RequestEvent] {
	return &hook.Handler[*core.RequestEvent]{
		Id: "sireneRequireScope:" + scope,
		Func: func(e *core.RequestEvent) error {
			id := IdentityOf(e)
			if id == nil || !id.HasScope(scope) {
				err := apierr.Forbidden(apierr.CodeAuthMissingScope, "Missing scope: "+scope)
				err.Extra = map[string]any{"missing": scope}
				return err
			}
			return e.Next()
		},
	}
}

// RequireJWT keeps credential-management endpoints out of reach of API keys,
// so a key can never mint more keys or approve a CLI session.
func RequireJWT() *hook.Handler[*core.RequestEvent] {
	return &hook.Handler[*core.RequestEvent]{
		Id: "sireneRequireJWT",
		Func: func(e *core.RequestEvent) error {
			id := IdentityOf(e)
			if id == nil || id.Type != TypeJWT {
				return apierr.Forbidden(apierr.CodeAuthForbidden, "This endpoint requires browser authentication")
			}
			return e.Next()
		},
	}
}
