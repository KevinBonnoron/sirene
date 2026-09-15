package api

import (
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
	"github.com/KevinBonnoron/sirene/server/internal/auth"
	"github.com/KevinBonnoron/sirene/server/internal/generation"
)

type generateBody struct {
	Voice         *string        `json:"voice"`
	Input         *string        `json:"input"`
	Speed         *float64       `json:"speed"`
	Tuning        map[string]any `json:"tuning"`
	EditorContent map[string]any `json:"editorContent"`
}

func (b *generateBody) toInput() (generation.Input, error) {
	if err := requireString("voice", b.Voice, 1, 0); err != nil {
		return generation.Input{}, err
	}
	if err := requireString("input", b.Input, 1, 0); err != nil {
		return generation.Input{}, err
	}
	if b.Speed != nil && (*b.Speed < 0.1 || *b.Speed > 5) {
		return generation.Input{}, apierr.Validation("speed: must be between 0.1 and 5")
	}
	for _, key := range []string{"pitchShift", "speedMultiplier", "variationSeed"} {
		if v, ok := b.Tuning[key]; ok && v != nil {
			if _, isNum := v.(float64); !isNum {
				return generation.Input{}, apierr.Validation("tuning." + key + ": must be a number")
			}
		}
	}
	return generation.Input{Voice: *b.Voice, Text: *b.Input, Speed: b.Speed, Tuning: b.Tuning, EditorContent: b.EditorContent}, nil
}

func registerGenerate(p *router.RouterGroup[*core.RequestEvent], d *Deps) {
	g := p.Group("/generate")
	g.Bind(auth.RequireScope("generate"))

	g.POST("", func(e *core.RequestEvent) error {
		var body generateBody
		if err := bindJSON(e, &body); err != nil {
			return err
		}
		in, err := body.toInput()
		if err != nil {
			return err
		}
		res, err := d.Generation.Generate(e.Request.Context(), in, auth.IdentityOf(e).UserID, false)
		if err != nil {
			return err
		}
		e.Response.Header().Set("X-Generation-Id", res.Buffered.GenerationID)
		return e.Blob(http.StatusOK, res.Buffered.ContentType, res.Buffered.Audio)
	})

	g.POST("/stream", func(e *core.RequestEvent) error {
		var body generateBody
		if err := bindJSON(e, &body); err != nil {
			return err
		}
		in, err := body.toInput()
		if err != nil {
			return err
		}
		res, err := d.Generation.Generate(e.Request.Context(), in, auth.IdentityOf(e).UserID, true)
		if err != nil {
			return err
		}
		if res.Buffered != nil {
			e.Response.Header().Set("X-Generation-Id", res.Buffered.GenerationID)
			return e.Blob(http.StatusOK, res.Buffered.ContentType, res.Buffered.Audio)
		}
		st := res.Stream
		h := e.Response.Header()
		h.Set("Content-Type", "application/octet-stream")
		h.Set("X-Sample-Rate", strconv.Itoa(st.SampleRate))
		h.Set("X-Channels", "1")
		h.Set("X-Bits-Per-Sample", "16")
		h.Set("X-Generation-Id", st.GenerationID)
		_ = http.NewResponseController(e.Response).SetWriteDeadline(time.Time{})
		e.Response.WriteHeader(http.StatusOK)

		// Keep draining after the client goes away so the save branch of the tee completes.
		buf := make([]byte, 32<<10)
		clientAlive := true
		for {
			n, rerr := st.Reader.Read(buf)
			if n > 0 && clientAlive {
				if _, werr := e.Response.Write(buf[:n]); werr != nil {
					clientAlive = false
				} else {
					_ = e.Flush()
				}
			}
			if rerr != nil {
				if rerr == io.EOF {
					st.Finish(nil)
				} else {
					st.Finish(rerr)
				}
				return nil
			}
		}
	}).Bind(apis.SkipSuccessActivityLog())
}
