package apierr

import "net/http"

type Error struct {
	Code    string
	Status  int
	Message string
	Extra   map[string]any
}

func (e *Error) Error() string {
	return e.Message
}

func New(code string, status int, message string) *Error {
	if message == "" {
		message = code
	}
	return &Error{Code: code, Status: status, Message: message}
}

func BadRequest(code, message string) *Error   { return New(code, http.StatusBadRequest, message) }
func Unauthorized(code, message string) *Error { return New(code, http.StatusUnauthorized, message) }
func Forbidden(code, message string) *Error    { return New(code, http.StatusForbidden, message) }
func NotFound(code, message string) *Error     { return New(code, http.StatusNotFound, message) }
func Conflict(code, message string) *Error     { return New(code, http.StatusConflict, message) }
func Upstream(code, message string) *Error     { return New(code, http.StatusBadGateway, message) }
func Unavailable(code, message string) *Error {
	return New(code, http.StatusServiceUnavailable, message)
}
func GatewayTimeout(code, message string) *Error {
	return New(code, http.StatusGatewayTimeout, message)
}
func Validation(message string) *Error { return New(CodeValidation, http.StatusBadRequest, message) }
func Internal() *Error                 { return New(CodeInternal, http.StatusInternalServerError, "Internal error") }
