package api

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"

	validation "github.com/go-ozzo/ozzo-validation/v4"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
	"github.com/KevinBonnoron/sirene/server/internal/auth"
)

func registerMe(p *router.RouterGroup[*core.RequestEvent], d *Deps) {
	p.GET("/me", func(e *core.RequestEvent) error {
		id := auth.IdentityOf(e)
		if id.Restricted() {
			return e.JSON(http.StatusOK, map[string]any{"id": id.UserID, "scopes": id.Scopes})
		}
		user, err := e.App.FindRecordById("users", id.UserID)
		if errors.Is(err, sql.ErrNoRows) {
			return apierr.NotFound(apierr.CodeUserNotFound, "User not found")
		}
		if err != nil {
			return err
		}
		role := user.GetString("role")
		if role == "" {
			role = "user"
		}
		out := map[string]any{"id": user.Id, "email": user.Email(), "role": role, "scopes": nil}
		if name := user.GetString("name"); name != "" {
			out["name"] = name
		}
		return e.JSON(http.StatusOK, out)
	})

	// No SMTP for PocketBase's email-change confirmation flow, so the change is made in-process.
	p.PATCH("/me/email", func(e *core.RequestEvent) error {
		var body struct {
			Email           *string `json:"email"`
			CurrentPassword *string `json:"currentPassword"`
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
		if err := requireString("currentPassword", body.CurrentPassword, 1, 0); err != nil {
			return err
		}
		user, err := e.App.FindRecordById("users", auth.IdentityOf(e).UserID)
		if err != nil {
			return err
		}
		if !user.ValidatePassword(*body.CurrentPassword) {
			return apierr.Unauthorized(apierr.CodeAuthInvalidCredentials, "Invalid password")
		}
		if !strings.EqualFold(user.Email(), *body.Email) {
			user.SetEmail(*body.Email)
			user.SetVerified(false)
		}
		if err := e.App.Save(user); err != nil {
			var ve validation.Errors
			if errors.As(err, &ve) {
				if fieldErr, ok := ve["email"].(validation.Error); ok && fieldErr.Code() == "validation_not_unique" {
					return apierr.BadRequest(apierr.CodeAuthEmailTaken, "An account with this email already exists")
				}
				return apierr.Validation(ve.Error())
			}
			return err
		}
		res, err := authResponse(user)
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, res)
	}).Bind(auth.RequireJWT())
}
