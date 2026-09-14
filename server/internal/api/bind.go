package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/mail"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
)

const jsonBodyLimit = 1 << 20

func bindJSON(e *core.RequestEvent, dst any) error {
	body, err := io.ReadAll(io.LimitReader(e.Request.Body, jsonBodyLimit+1))
	if err != nil {
		return apierr.Validation("unable to read request body")
	}
	if len(body) > jsonBodyLimit {
		return apierr.New(apierr.CodeTooLarge, http.StatusRequestEntityTooLarge, "JSON body too large")
	}
	if len(strings.TrimSpace(string(body))) == 0 {
		body = []byte("{}")
	}
	if err := json.Unmarshal(body, dst); err != nil {
		return apierr.Validation("invalid JSON body: " + err.Error())
	}
	return nil
}

func pathParam(e *core.RequestEvent, name string) (string, error) {
	v := e.Request.PathValue(name)
	if v == "" {
		return "", apierr.Validation(name + ": required")
	}
	return v, nil
}

func requireString(field string, v *string, minLen, maxLen int) error {
	if v == nil {
		return apierr.Validation(field + ": required")
	}
	return checkString(field, *v, minLen, maxLen)
}

func checkString(field, v string, minLen, maxLen int) error {
	if len(v) < minLen {
		if minLen == 1 {
			return apierr.Validation(field + ": must not be empty")
		}
		return apierr.Validation(field + ": too short")
	}
	if maxLen > 0 && len(v) > maxLen {
		return apierr.Validation(field + ": too long")
	}
	return nil
}

func checkEmail(field, v string) error {
	if _, err := mail.ParseAddress(v); err != nil || strings.ContainsAny(v, " <>") {
		return apierr.Validation(field + ": invalid email")
	}
	return nil
}
