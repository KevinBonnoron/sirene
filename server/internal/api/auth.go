package api

import (
	"database/sql"
	"errors"
	"net/http"

	validation "github.com/go-ozzo/ozzo-validation/v4"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
	"github.com/KevinBonnoron/sirene/server/internal/appconfig"
	"github.com/KevinBonnoron/sirene/server/internal/auth"
)

type authUser struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	Avatar   string `json:"avatar"`
	Verified bool   `json:"verified"`
	Role     string `json:"role"`
}

type authResult struct {
	Token string   `json:"token"`
	User  authUser `json:"user"`
}

func toAuthUser(rec *core.Record) authUser {
	return authUser{
		ID:       rec.Id,
		Email:    rec.Email(),
		Name:     rec.GetString("name"),
		Avatar:   rec.GetString("avatar"),
		Verified: rec.Verified(),
		Role:     rec.GetString("role"),
	}
}

func authResponse(rec *core.Record) (*authResult, error) {
	token, err := rec.NewAuthToken()
	if err != nil {
		return nil, err
	}
	return &authResult{Token: token, User: toAuthUser(rec)}, nil
}

func registerAuth(g *router.RouterGroup[*core.RequestEvent], d *Deps) {
	g.POST("/auth/login", func(e *core.RequestEvent) error {
		var body struct {
			Email    *string `json:"email"`
			Password *string `json:"password"`
		}
		if err := bindJSON(e, &body); err != nil {
			return err
		}
		if err := requireString("email", body.Email, 1, 0); err != nil {
			return err
		}
		if err := checkEmail("email", *body.Email); err != nil {
			return err
		}
		if err := requireString("password", body.Password, 8, 0); err != nil {
			return err
		}
		rec, err := e.App.FindAuthRecordByEmail("users", *body.Email)
		if err != nil || !rec.ValidatePassword(*body.Password) {
			e.App.Logger().Warn("[auth/login] invalid credentials")
			return apierr.Unauthorized(apierr.CodeAuthInvalidCredentials, "Invalid email or password")
		}
		out, err := authResponse(rec)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, out)
	})

	g.POST("/auth/register", func(e *core.RequestEvent) error {
		var body struct {
			Email           *string `json:"email"`
			Password        *string `json:"password"`
			PasswordConfirm *string `json:"passwordConfirm"`
			Name            *string `json:"name"`
			Invitation      *string `json:"invitation"`
		}
		if err := bindJSON(e, &body); err != nil {
			return err
		}
		enabled, err := d.AppConfig.Bool(appconfig.RegistrationEnabled, true)
		if err != nil {
			e.App.Logger().Error("[auth/register] could not read the registration policy", "error", err)
			return apierr.Internal()
		}
		if !enabled && body.Invitation == nil {
			return apierr.Forbidden(apierr.CodeAuthRegistrationClosed, "This instance is not accepting new accounts")
		}
		if err := requireString("email", body.Email, 1, 0); err != nil {
			return err
		}
		if err := checkEmail("email", *body.Email); err != nil {
			return err
		}
		if err := requireString("password", body.Password, 8, 0); err != nil {
			return err
		}
		if err := requireString("passwordConfirm", body.PasswordConfirm, 8, 0); err != nil {
			return err
		}
		if *body.Password != *body.PasswordConfirm {
			return apierr.Validation("passwordConfirm: passwords do not match")
		}
		if body.Name != nil {
			if err := checkString("name", *body.Name, 1, 0); err != nil {
				return err
			}
		}

		col, err := e.App.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		rec := core.NewRecord(col)
		rec.SetEmail(*body.Email)
		rec.SetPassword(*body.Password)
		if body.Name != nil {
			rec.Set("name", *body.Name)
		}
		// Claimed first: a sign-up that is then rejected rolls the claim back with it,
		// and an invitation revoked in between can no longer open an account.
		if err := e.App.RunInTransaction(func(tx core.App) error {
			if body.Invitation != nil {
				if err := d.Invites.With(tx).Claim(*body.Invitation, *body.Email); err != nil {
					return err
				}
			}
			if err := tx.Save(rec); err != nil {
				var ve validation.Errors
				if errors.As(err, &ve) {
					if fieldErr, ok := ve["email"].(validation.Error); ok && fieldErr.Code() == "validation_not_unique" {
						return apierr.BadRequest(apierr.CodeAuthEmailTaken, "An account with this email already exists")
					}
					e.App.Logger().Warn("[auth/register] rejected", "error", err)
					return apierr.BadRequest(apierr.CodeAuthRegistrationFailed, "Registration failed")
				}
				return err
			}
			return nil
		}); err != nil {
			return err
		}
		out, err := authResponse(rec)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusCreated, out)
	})

	g.POST("/auth/refresh", func(e *core.RequestEvent) error {
		rec, err := userFromBearer(e)
		if err != nil {
			return err
		}
		out, err := authResponse(rec)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, out)
	})

	g.GET("/auth/me", func(e *core.RequestEvent) error {
		rec, err := userFromBearer(e)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, toAuthUser(rec))
	})
}

func userFromBearer(e *core.RequestEvent) (*core.Record, error) {
	token, ok := auth.Bearer(e)
	if !ok {
		return nil, apierr.Unauthorized(apierr.CodeAuthRequired, "Authentication required")
	}
	rec, err := e.App.FindAuthRecordByToken(token, core.TokenTypeAuth)
	if err != nil || rec.Collection().Name != "users" {
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			e.App.Logger().Warn("[auth/refresh] token rejected", "error", err)
		}
		return nil, apierr.Unauthorized(apierr.CodeAuthInvalidToken, "Invalid or expired token")
	}
	return rec, nil
}
