package api

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/KevinBonnoron/sirene/server/internal/openapi"
)

func registerOpenAPI(g *router.RouterGroup[*core.RequestEvent]) {
	g.GET("/openapi.json", func(e *core.RequestEvent) error {
		return e.Blob(http.StatusOK, "application/json", openapi.Spec)
	})
	g.GET("/docs", func(e *core.RequestEvent) error {
		return e.HTML(http.StatusOK, openapi.DocsHTML)
	})
}
