package inference

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/textproto"
	"net/url"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
	"github.com/KevinBonnoron/sirene/server/internal/catalog"
	"github.com/KevinBonnoron/sirene/server/internal/sse"
)

// The worker's 412: it wants the reference samples resent inline.
var ErrCacheMiss = errors.New("reference audio cache miss")

const (
	listTimeout       = 10 * time.Second
	deleteTimeout     = 10 * time.Second
	exportTimeout     = 60 * time.Second
	pullTimeout       = time.Hour
	importTimeout     = 30 * time.Second
	generateTimeout   = 30 * time.Minute
	transcribeTimeout = 300 * time.Second
)

type Target struct {
	URL       string
	AuthToken string
}

// ForbiddenIP rejects link-local ranges, which is where cloud metadata services live.
func ForbiddenIP(ip net.IP) bool {
	return ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast()
}

// Checked after DNS resolution so a rebinding hostname can't reach what the URL check refused.
func refuseForbiddenAddr(_, address string, _ syscall.RawConn) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return err
	}
	if ip := net.ParseIP(host); ip != nil && ForbiddenIP(ip) {
		return fmt.Errorf("inference: refusing link-local destination %s", host)
	}
	return nil
}

var httpClient = &http.Client{
	Transport: &http.Transport{
		DialContext:         (&net.Dialer{Timeout: 10 * time.Second, Control: refuseForbiddenAddr}).DialContext,
		TLSHandshakeTimeout: 10 * time.Second,
		MaxIdleConnsPerHost: 8,
		IdleConnTimeout:     90 * time.Second,
	},
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

// Event streams have no request deadline, so the wait for headers is bounded here instead.
var streamClient = &http.Client{
	Transport: &http.Transport{
		DialContext:           (&net.Dialer{Timeout: 10 * time.Second, Control: refuseForbiddenAddr}).DialContext,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 15 * time.Second,
	},
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

func (t Target) newRequest(ctx context.Context, method, path string, body io.Reader) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(t.URL, "/")+path, body)
	if err != nil {
		return nil, err
	}
	if t.AuthToken != "" {
		req.Header.Set("Authorization", "Bearer "+t.AuthToken)
	}
	return req, nil
}

func (t Target) do(req *http.Request, op string) (*http.Response, error) {
	res, err := httpClient.Do(req)
	if err != nil {
		return nil, apierr.Upstream(apierr.CodeUpstreamInference, fmt.Sprintf("%s failed: %s", op, transportReason(err)))
	}
	return res, nil
}

func transportReason(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	var uerr *url.Error
	if errors.As(err, &uerr) && uerr.Timeout() {
		return "timeout"
	}
	return "inference server unreachable"
}

// Worker bodies can carry tracebacks and internal paths, so only a generic message goes out.
func upstreamError(op string, res *http.Response, logf func(string, ...any)) error {
	body, _ := io.ReadAll(io.LimitReader(res.Body, 4<<10))
	logf("[inference/"+op+"] upstream error", "status", res.StatusCode, "body", string(body))
	// A 4xx carries the worker's own reason (unknown backend, bad input); a 5xx body is a stack trace, kept in the log.
	var detail struct {
		Detail string `json:"detail"`
	}
	if res.StatusCode < 500 && json.Unmarshal(body, &detail) == nil && detail.Detail != "" {
		return apierr.Upstream(apierr.CodeUpstreamInference, fmt.Sprintf("%s failed (HTTP %d): %s", op, res.StatusCode, detail.Detail))
	}
	return apierr.Upstream(apierr.CodeUpstreamInference, fmt.Sprintf("%s failed (HTTP %d)", op, res.StatusCode))
}

type Client struct {
	target Target
	logf   func(msg string, args ...any)
}

func NewClient(target Target, logf func(string, ...any)) *Client {
	if logf == nil {
		logf = func(string, ...any) {}
	}
	return &Client{target: target, logf: logf}
}

type HealthInfo struct {
	Device    string `json:"device"`
	GPUMemory int64  `json:"gpu_memory"`
}

func Health(ctx context.Context, t Target) (HealthInfo, error) {
	var info HealthInfo
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := t.newRequest(ctx, http.MethodGet, "/health", nil)
	if err != nil {
		return info, err
	}
	res, err := httpClient.Do(req)
	if err != nil {
		return info, err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	if err != nil {
		return info, err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return info, fmt.Errorf("health check failed (HTTP %d)", res.StatusCode)
	}
	if err := json.Unmarshal(body, &info); err != nil {
		return info, fmt.Errorf("health check returned an invalid payload: %w", err)
	}
	return info, t.checkAuth(ctx)
}

// /health is open, so a wrong token only shows on an authenticated route.
func (t Target) checkAuth(ctx context.Context) error {
	req, err := t.newRequest(ctx, http.MethodGet, "/models", nil)
	if err != nil {
		return err
	}
	res, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	io.Copy(io.Discard, res.Body)
	switch {
	case res.StatusCode == http.StatusUnauthorized && t.AuthToken == "":
		return errors.New("auth token required: this server was started with INFERENCE_AUTH_TOKEN")
	case res.StatusCode == http.StatusUnauthorized:
		return errors.New("auth token rejected: check it matches INFERENCE_AUTH_TOKEN on the server")
	case res.StatusCode < 200 || res.StatusCode >= 300:
		return fmt.Errorf("auth check failed (HTTP %d)", res.StatusCode)
	}
	return nil
}

type ModelsList struct {
	Installed []string        `json:"installed"`
	Custom    []catalog.Model `json:"custom"`
}

var ErrStatsUnsupported = errors.New("worker has no /stats route")

func (c *Client) Stats(ctx context.Context, history bool) (json.RawMessage, error) {
	ctx, cancel := context.WithTimeout(ctx, listTimeout)
	defer cancel()
	path := "/stats"
	if history {
		path += "?history=true"
	}
	req, err := c.target.newRequest(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}
	res, err := c.target.do(req, "stats")
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound || res.StatusCode == http.StatusMethodNotAllowed {
		return nil, ErrStatsUnsupported
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, upstreamError("stats", res, c.logf)
	}
	// Six hours of samples every five seconds is well past 256 KiB.
	body, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil || !json.Valid(body) {
		return nil, apierr.Upstream(apierr.CodeUpstreamInference, "stats failed: invalid response")
	}
	return body, nil
}

func (c *Client) Logs(ctx context.Context, limit int, level string) (json.RawMessage, error) {
	ctx, cancel := context.WithTimeout(ctx, listTimeout)
	defer cancel()
	req, err := c.target.newRequest(ctx, http.MethodGet, fmt.Sprintf("/logs?limit=%d&level=%s", limit, url.QueryEscape(level)), nil)
	if err != nil {
		return nil, err
	}
	res, err := c.target.do(req, "logs")
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound || res.StatusCode == http.StatusMethodNotAllowed {
		return nil, ErrStatsUnsupported
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, upstreamError("logs", res, c.logf)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if err != nil || !json.Valid(body) {
		return nil, apierr.Upstream(apierr.CodeUpstreamInference, "logs failed: invalid response")
	}
	return body, nil
}

func (c *Client) Events(ctx context.Context, onEvent func(name, data string) error) error {
	req, err := c.target.newRequest(ctx, http.MethodGet, "/events", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "text/event-stream")
	res, err := streamClient.Do(req)
	if err != nil {
		return apierr.Upstream(apierr.CodeUpstreamInference, "events failed: "+transportReason(err))
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound || res.StatusCode == http.StatusMethodNotAllowed {
		return ErrStatsUnsupported
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return upstreamError("events", res, c.logf)
	}
	return sse.Read(res.Body, func(ev sse.Event) error { return onEvent(ev.Name, ev.Data) })
}

func (c *Client) ListModels(ctx context.Context) (*ModelsList, error) {
	ctx, cancel := context.WithTimeout(ctx, listTimeout)
	defer cancel()
	req, err := c.target.newRequest(ctx, http.MethodGet, "/models", nil)
	if err != nil {
		return nil, err
	}
	res, err := c.target.do(req, "listModels")
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, upstreamError("listModels", res, c.logf)
	}
	var out ModelsList
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, apierr.Upstream(apierr.CodeUpstreamInference, "listModels failed: invalid response")
	}
	return &out, nil
}

func (c *Client) DeleteModel(ctx context.Context, modelID string) error {
	ctx, cancel := context.WithTimeout(ctx, deleteTimeout)
	defer cancel()
	req, err := c.target.newRequest(ctx, http.MethodDelete, "/models/"+url.PathEscape(modelID), nil)
	if err != nil {
		return err
	}
	res, err := c.target.do(req, "deleteModel")
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return upstreamError("deleteModel", res, c.logf)
	}
	io.Copy(io.Discard, res.Body)
	return nil
}

func (c *Client) FetchExport(ctx context.Context, modelID string) (*http.Response, context.CancelFunc, error) {
	ctx, cancel := context.WithTimeout(ctx, exportTimeout)
	req, err := c.target.newRequest(ctx, http.MethodGet, "/models/"+url.PathEscape(modelID)+"/export", nil)
	if err != nil {
		cancel()
		return nil, nil, err
	}
	res, err := c.target.do(req, "export")
	if err != nil {
		cancel()
		return nil, nil, err
	}
	return res, cancel, nil
}

type PullFile struct {
	URL  string `json:"url"`
	Path string `json:"path"`
}

type PullRequest struct {
	Backend   string     `json:"backend"`
	ModelID   string     `json:"model_id"`
	Files     []PullFile `json:"files"`
	TotalSize int64      `json:"total_size"`
	HFToken   *string    `json:"hf_token"`
}

type PullEvent struct {
	Status   string   `json:"status"`
	Progress *float64 `json:"progress"`
	Message  string   `json:"message"`
}

// Malformed events are skipped: the worker interleaves download and dependency-install events.
func (c *Client) PullModel(ctx context.Context, in PullRequest, onEvent func(PullEvent) error) error {
	ctx, cancel := context.WithTimeout(ctx, pullTimeout)
	defer cancel()
	payload, err := json.Marshal(in)
	if err != nil {
		return err
	}
	req, err := c.target.newRequest(ctx, http.MethodPost, "/models/pull", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	res, err := c.target.do(req, "pullModel")
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return upstreamError("pullModel", res, c.logf)
	}
	return sse.Read(res.Body, func(ev sse.Event) error {
		var pe PullEvent
		if err := json.Unmarshal([]byte(ev.Data), &pe); err != nil {
			return nil
		}
		return onEvent(pe)
	})
}

// ImportArchive uploads an export zip under the same model id, so a copied voice keeps its identity across workers.
func (c *Client) ImportArchive(ctx context.Context, modelID string, archive io.Reader) error {
	ctx, cancel := context.WithTimeout(ctx, pullTimeout)
	defer cancel()
	pr, pw := io.Pipe()
	mw := multipart.NewWriter(pw)
	go func() {
		err := func() error {
			w, err := createFilePart(mw, "archive", modelID+".zip", "application/zip")
			if err != nil {
				return err
			}
			if _, err := io.Copy(w, archive); err != nil {
				return err
			}
			return mw.Close()
		}()
		pw.CloseWithError(err)
	}()
	req, err := c.target.newRequest(ctx, http.MethodPost, "/models/"+url.PathEscape(modelID)+"/import", pr)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	res, err := c.target.do(req, "importArchive")
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 4<<10))
		c.logf("[inference/importArchive] upstream error", "status", res.StatusCode, "body", string(body))
		return apierr.Upstream(apierr.CodeUpstreamInference, fmt.Sprintf("Copy failed (HTTP %d)", res.StatusCode))
	}
	return nil
}

type FilePart struct {
	Name        string
	ContentType string
	Data        []byte
}

type ImportResult struct {
	ID      string `json:"id"`
	Message string `json:"message"`
}

func (c *Client) ImportPiper(ctx context.Context, name string, onnx, config FilePart) (*ImportResult, error) {
	ctx, cancel := context.WithTimeout(ctx, importTimeout)
	defer cancel()
	pr, pw := io.Pipe()
	mw := multipart.NewWriter(pw)
	go func() {
		err := func() error {
			if err := mw.WriteField("name", name); err != nil {
				return err
			}
			for field, part := range map[string]FilePart{"onnx": onnx, "config": config} {
				w, err := createFilePart(mw, field, part.Name, part.ContentType)
				if err != nil {
					return err
				}
				if _, err := w.Write(part.Data); err != nil {
					return err
				}
			}
			return mw.Close()
		}()
		pw.CloseWithError(err)
	}()
	req, err := c.target.newRequest(ctx, http.MethodPost, "/models/piper/import", pr)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	res, err := c.target.do(req, "importPiperModel")
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 4<<10))
		c.logf("[inference/importPiperModel] upstream error", "status", res.StatusCode, "body", string(body))
		return nil, apierr.Upstream(apierr.CodeUpstreamInference, fmt.Sprintf("Piper import failed (HTTP %d)", res.StatusCode))
	}
	var out ImportResult
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, apierr.Upstream(apierr.CodeUpstreamInference, "Piper import failed: invalid response")
	}
	return &out, nil
}

// Nil pointers serialise as null, which the worker expects for absent optionals.
type Request struct {
	Backend            string   `json:"backend"`
	Text               string   `json:"text"`
	ModelPath          string   `json:"model_path"`
	VoicePath          *string  `json:"voice_path"`
	ReferenceAudio     []string `json:"reference_audio"`
	ReferenceAudioData []string `json:"reference_audio_data"`
	ReferenceCacheKey  *string  `json:"reference_cache_key"`
	ReferenceText      []string `json:"reference_text"`
	InstructText       *string  `json:"instruct_text"`
	InstructGender     *string  `json:"instruct_gender"`
	Speed              float64  `json:"speed"`
	NoiseScale         *float64 `json:"noise_scale"`
	Language           string   `json:"language"`
}

func (r *Request) normalise() {
	if r.Speed == 0 {
		r.Speed = 1
	}
	if r.Language == "" {
		r.Language = "en"
	}
}

func (c *Client) postGenerate(ctx context.Context, path string, in Request, op string) (*http.Response, error) {
	in.normalise()
	payload, err := json.Marshal(in)
	if err != nil {
		return nil, err
	}
	req, err := c.target.newRequest(ctx, http.MethodPost, path, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := c.target.do(req, op)
	if err != nil {
		return nil, err
	}
	if res.StatusCode == http.StatusPreconditionFailed {
		res.Body.Close()
		return nil, ErrCacheMiss
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		defer res.Body.Close()
		return nil, upstreamError(op, res, c.logf)
	}
	return res, nil
}

func (c *Client) Generate(ctx context.Context, in Request) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, generateTimeout)
	defer cancel()
	res, err := c.postGenerate(ctx, "/generate", in, "generate")
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	return io.ReadAll(res.Body)
}

type Stream struct {
	Body       io.ReadCloser
	SampleRate int
	cancel     context.CancelFunc
}

func (s *Stream) Close() error {
	err := s.Body.Close()
	s.cancel()
	return err
}

func (c *Client) GenerateStream(ctx context.Context, in Request) (*Stream, error) {
	ctx, cancel := context.WithTimeout(ctx, generateTimeout)
	res, err := c.postGenerate(ctx, "/generate/stream", in, "generateStream")
	if err != nil {
		cancel()
		return nil, err
	}
	rate, _ := strconv.Atoi(res.Header.Get("X-Sample-Rate"))
	if rate <= 0 {
		rate = 24000
	}
	return &Stream{Body: res.Body, SampleRate: rate, cancel: cancel}, nil
}

type TranscribeResult struct {
	Text     string `json:"text"`
	Language string `json:"language,omitempty"`
}

var ErrTranscribeTimeout = errors.New("transcription timed out")

func (c *Client) Transcribe(ctx context.Context, audio io.Reader, filename, contentType, modelPath string) (*TranscribeResult, error) {
	ctx, cancel := context.WithTimeout(ctx, transcribeTimeout)
	defer cancel()
	pr, pw := io.Pipe()
	mw := multipart.NewWriter(pw)
	go func() {
		err := func() error {
			if err := mw.WriteField("model_path", modelPath); err != nil {
				return err
			}
			w, err := createFilePart(mw, "file", filename, contentType)
			if err != nil {
				return err
			}
			if _, err := io.Copy(w, audio); err != nil {
				return err
			}
			return mw.Close()
		}()
		pw.CloseWithError(err)
	}()
	req, err := c.target.newRequest(ctx, http.MethodPost, "/transcribe", pr)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	res, err := httpClient.Do(req)
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return nil, ErrTranscribeTimeout
		}
		return nil, apierr.Upstream(apierr.CodeUpstreamInference, "transcribe failed: "+transportReason(err))
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, upstreamError("transcribe", res, c.logf)
	}
	var out TranscribeResult
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, apierr.Upstream(apierr.CodeUpstreamInference, "transcribe failed: invalid response")
	}
	return &out, nil
}

var quoteEscaper = strings.NewReplacer("\\", "\\\\", `"`, "\\\"")

// mime/multipart hard-codes application/octet-stream and the worker's /transcribe rejects non-audio/* parts.
func createFilePart(mw *multipart.Writer, field, filename, contentType string) (io.Writer, error) {
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, quoteEscaper.Replace(field), quoteEscaper.Replace(filename)))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	h.Set("Content-Type", contentType)
	return mw.CreatePart(h)
}
