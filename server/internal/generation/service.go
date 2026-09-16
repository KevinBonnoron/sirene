package generation

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math"
	"path"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
	"github.com/KevinBonnoron/sirene/server/internal/audio"
	"github.com/KevinBonnoron/sirene/server/internal/inference"
	"github.com/KevinBonnoron/sirene/server/internal/infsrv"
	"github.com/KevinBonnoron/sirene/server/internal/models"
	"github.com/KevinBonnoron/sirene/server/internal/pbfiles"
	"github.com/KevinBonnoron/sirene/server/internal/providers"
	"github.com/KevinBonnoron/sirene/server/internal/routing"
	"github.com/KevinBonnoron/sirene/server/internal/voices"
)

type Input struct {
	Voice         string
	Text          string
	Speed         *float64
	Tuning        map[string]any
	EditorContent map[string]any
}

type kind int

const (
	kindInference kind = iota
	kindElevenLabs
	kindOpenAI
)

type sampleRef struct {
	rec   *core.Record
	audio string
}

type resolved struct {
	kind    kind
	req     inference.Request
	samples []sampleRef
	voiceID string
	speed   float64
	voice   string
	model   string
	text    string
	lang    string
	tuning  map[string]any
	editor  map[string]any
}

type Buffered struct {
	GenerationID string
	Audio        []byte
	ContentType  string
}

// Finish must be called once the handler stops reading, with the read error if any.
type StreamResult struct {
	GenerationID string
	SampleRate   int
	Reader       io.Reader
	Finish       func(err error)
}

type Result struct {
	Buffered *Buffered
	Stream   *StreamResult
}

type Service struct {
	app    core.App
	models *models.Service
	router *routing.Router
	voices *voices.Service
	wg     sync.WaitGroup
}

func New(app core.App, m *models.Service, r *routing.Router, v *voices.Service) *Service {
	return &Service{app: app, models: m, router: r, voices: v}
}

func (s *Service) Wait(timeout time.Duration) {
	done := make(chan struct{})
	go func() {
		s.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(timeout):
	}
}

func (s *Service) List(userID, voice, model string) ([]*core.Record, error) {
	parts := []string{"user = {:userId}"}
	params := dbx.Params{"userId": userID}
	if voice != "" {
		parts = append(parts, "voice = {:voice}")
		params["voice"] = voice
	}
	if model != "" {
		parts = append(parts, "model = {:model}")
		params["model"] = model
	}
	recs, err := s.app.FindRecordsByFilter("generations", strings.Join(parts, " && "), "-created", 0, 0, params)
	if recs == nil {
		recs = []*core.Record{}
	}
	return recs, err
}

func (s *Service) Owned(id, userID string) (*core.Record, error) {
	rec, err := s.app.FindRecordById("generations", id)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && rec.GetString("user") != userID) {
		return nil, apierr.NotFound(apierr.CodeGenerationNotFound, "Generation not found")
	}
	return rec, err
}

func (s *Service) Delete(id, userID string) error {
	rec, err := s.Owned(id, userID)
	if err != nil {
		return err
	}
	return s.app.Delete(rec)
}

type Word struct {
	Index int     `json:"index"`
	Text  string  `json:"text"`
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

type Alignment struct {
	GenerationID string  `json:"generationId"`
	Duration     float64 `json:"duration"`
	Words        []Word  `json:"words"`
	Stubbed      bool    `json:"stubbed"`
}

var (
	tagRe     = regexp.MustCompile(`<[^>]+>`)
	bracketRe = regexp.MustCompile(`\[[^\]]+\]`)
)

// Alignment is a uniform stub until a real aligner is wired in.
func (s *Service) Alignment(id, userID string) (*Alignment, error) {
	rec, err := s.Owned(id, userID)
	if err != nil {
		return nil, err
	}
	text := bracketRe.ReplaceAllString(tagRe.ReplaceAllString(rec.GetString("text"), " "), " ")
	words := strings.Fields(text)
	duration := rec.GetFloat("duration")
	out := &Alignment{GenerationID: id, Duration: duration, Words: []Word{}, Stubbed: true}
	if len(words) == 0 || duration <= 0 {
		return out, nil
	}
	step := duration / float64(len(words))
	for i, w := range words {
		out.Words = append(out.Words, Word{Index: i, Text: w, Start: float64(i) * step, End: float64(i+1) * step})
	}
	return out, nil
}

func (s *Service) resolve(ctx context.Context, in Input, userID string) (*resolved, error) {
	voice, err := s.app.FindRecordById("voices", in.Voice)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, apierr.NotFound(apierr.CodeVoiceNotFound, "Voice not found")
	}
	if err != nil {
		return nil, err
	}
	modelID := voice.GetString("model")
	if modelID == "" {
		return nil, apierr.BadRequest(apierr.CodeVoiceNoModel, "Voice has no model assigned")
	}
	model, err := s.models.Find(ctx, userID, modelID)
	if err != nil {
		return nil, err
	}
	if model == nil {
		return nil, apierr.NotFound(apierr.CodeModelNotInCatalog, fmt.Sprintf("Model %q not found in catalog", modelID))
	}
	installed, err := s.models.IsInstalled(ctx, *model)
	if err != nil {
		return nil, err
	}
	if !installed {
		return nil, apierr.BadRequest(apierr.CodeModelNotInstalled, fmt.Sprintf("Model %q is not installed", model.Name))
	}

	var options map[string]any
	_ = voice.UnmarshalJSONField("options", &options)
	presetVoice, _ := options["presetVoice"].(string)
	language := voice.GetString("language")
	if language == "" {
		language = "en"
	}
	speed := 1.0
	if in.Speed != nil {
		speed = *in.Speed
	}
	if v, ok := number(in.Tuning, "speedMultiplier"); ok {
		speed = v
	}
	var noiseScale *float64
	var seed *int64
	if v, ok := number(in.Tuning, "variationSeed"); ok {
		if model.Backend == "piper" {
			ns := 0.4 + math.Max(0, math.Min(1, v))*0.55
			noiseScale = &ns
		} else {
			s := int64(math.Round(math.Max(0, math.Min(1, v)) * 1_000_000))
			seed = &s
		}
	}

	r := &resolved{speed: speed, voice: in.Voice, model: modelID, text: in.Text, lang: language, tuning: in.Tuning, editor: in.EditorContent}

	switch model.Backend {
	case "elevenlabs":
		if presetVoice == "" {
			return nil, apierr.BadRequest(apierr.CodeVoiceElevenLabsPresetRequired, "ElevenLabs voice requires a preset voice ID. Edit the voice and select one.")
		}
		r.kind, r.voiceID = kindElevenLabs, presetVoice
		return r, nil
	case "openai":
		if presetVoice == "" {
			return nil, apierr.BadRequest(apierr.CodeVoiceOpenAIPresetRequired, "OpenAI TTS voice requires a preset voice ID. Edit the voice and select one.")
		}
		r.kind, r.voiceID = kindOpenAI, presetVoice
		return r, nil
	}

	r.kind = kindInference
	r.req = inference.Request{Backend: model.Backend, Text: in.Text, ModelPath: model.ID, Speed: speed, NoiseScale: noiseScale, Seed: seed, Language: language}
	if !model.HasType("preset") {
		presetVoice = ""
	}
	if model.HasType("cloning") && presetVoice == "" {
		rows, err := s.voices.EnabledSamples(in.Voice)
		if err != nil {
			return nil, err
		}
		if len(rows) == 0 {
			return nil, apierr.BadRequest(apierr.CodeVoiceCloningRequiresSample, "Voice cloning requires at least one enabled audio sample. Edit the voice to upload or enable a sample.")
		}
		ids := make([]string, 0, len(rows))
		texts := make([]string, 0, len(rows))
		for _, row := range rows {
			ids = append(ids, row.Id)
			texts = append(texts, row.GetString("transcript"))
			r.samples = append(r.samples, sampleRef{rec: row, audio: row.GetString("audio")})
		}
		sort.Strings(ids)
		sum := sha256.Sum256([]byte(strings.Join(ids, ",")))
		key := hex.EncodeToString(sum[:])[:24]
		r.req.ReferenceCacheKey = &key
		r.req.ReferenceText = texts
		return r, nil
	}
	if presetVoice != "" {
		r.req.VoicePath = &presetVoice
	}
	return r, nil
}

func number(m map[string]any, key string) (float64, bool) {
	if m == nil {
		return 0, false
	}
	v, ok := m[key].(float64)
	return v, ok
}

func (s *Service) preCreate(r *resolved, userID string) (*core.Record, error) {
	col, err := s.app.FindCollectionByNameOrId("generations")
	if err != nil {
		return nil, err
	}
	rec := core.NewRecord(col)
	rec.Set("voice", r.voice)
	rec.Set("model", r.model)
	rec.Set("text", r.text)
	rec.Set("language", r.lang)
	rec.Set("speed", r.speed)
	rec.Set("user", userID)
	rec.Set("state", "ready")
	rec.Set("tuning", r.tuning)
	rec.Set("editorContent", r.editor)
	if err := s.app.Save(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func (s *Service) finalize(rec *core.Record, data []byte, filename string, duration float64) error {
	file, err := filesystem.NewFileFromBytes(data, filename)
	if err != nil {
		return err
	}
	rec.Set("audio", file)
	rec.Set("duration", math.Round(duration*10)/10)
	return s.app.Save(rec)
}

func (s *Service) cleanup(rec *core.Record) {
	if err := s.app.Delete(rec); err != nil {
		s.app.Logger().Error("[generation] failed to clean up placeholder", "id", rec.Id, "error", err)
	}
}

func (s *Service) cloud(ctx context.Context, r *resolved, userID string) ([]byte, error) {
	switch r.kind {
	case kindElevenLabs:
		key, err := s.models.RequireProviderKey(userID, "elevenlabs")
		if err != nil {
			return nil, err
		}
		return providers.ElevenLabsCreateSpeech(ctx, key, r.text, r.voiceID, r.speed)
	default:
		key, err := s.models.RequireProviderKey(userID, "openai")
		if err != nil {
			return nil, err
		}
		return providers.OpenAICreateSpeech(ctx, key, r.text, r.voiceID, r.speed)
	}
}

func (s *Service) pick(ctx context.Context, r *resolved) (*core.Record, *inference.Client, error) {
	server, err := s.router.Pick(ctx, r.req.ModelPath)
	if err != nil {
		return nil, nil, err
	}
	return server, inference.NewClient(infsrv.TargetOf(server), s.app.Logger().Warn), nil
}

func (s *Service) withReferenceAudio(r *resolved) (inference.Request, error) {
	req := r.req
	req.ReferenceAudioData = make([]string, 0, len(r.samples))
	for _, sm := range r.samples {
		data, err := pbfiles.ReadAll(s.app, sm.rec, sm.audio)
		if err != nil {
			return req, fmt.Errorf("failed to read voice sample %s: %w", sm.rec.Id, err)
		}
		ext := strings.TrimPrefix(path.Ext(sm.audio), ".")
		if ext == "" {
			ext = "wav"
		}
		mime := "audio/" + ext
		if ext == "mp3" {
			mime = "audio/mpeg"
		}
		req.ReferenceAudioData = append(req.ReferenceAudioData, "data:"+mime+";base64,"+base64.StdEncoding.EncodeToString(data))
	}
	return req, nil
}

func (s *Service) Generate(ctx context.Context, in Input, userID string, streaming bool) (*Result, error) {
	r, err := s.resolve(ctx, in, userID)
	if err != nil {
		return nil, err
	}
	rec, err := s.preCreate(r, userID)
	if err != nil {
		return nil, err
	}
	res, err := s.run(ctx, r, rec, userID, streaming)
	if err != nil {
		s.cleanup(rec)
		return nil, err
	}
	return res, nil
}

func (s *Service) run(ctx context.Context, r *resolved, rec *core.Record, userID string, streaming bool) (*Result, error) {
	if r.kind != kindInference {
		data, err := s.cloud(ctx, r, userID)
		if err != nil {
			return nil, err
		}
		if err := s.finalize(rec, data, "generation.mp3", audio.Duration(ctx, data)); err != nil {
			return nil, err
		}
		return &Result{Buffered: &Buffered{GenerationID: rec.Id, Audio: data, ContentType: "audio/mpeg"}}, nil
	}

	server, client, err := s.pick(ctx, r)
	if err != nil {
		return nil, err
	}
	rec.Set("server", server.Id)
	release := s.router.Acquire(server.Id)

	if !streaming {
		defer release()
		data, err := client.Generate(ctx, r.req)
		if errors.Is(err, inference.ErrCacheMiss) && r.samples != nil {
			req, rerr := s.withReferenceAudio(r)
			if rerr != nil {
				return nil, rerr
			}
			data, err = client.Generate(ctx, req)
		}
		if err != nil {
			return nil, err
		}
		duration := 0.0
		if info, perr := audio.ParseWAV(bytes.NewReader(data)); perr == nil {
			duration = info.Duration
		}
		if err := s.finalize(rec, data, "generation.wav", duration); err != nil {
			return nil, err
		}
		return &Result{Buffered: &Buffered{GenerationID: rec.Id, Audio: data, ContentType: "audio/wav"}}, nil
	}

	// Detached from the request context so a client that disconnects mid-stream still gets its generation saved.
	upstream, err := client.GenerateStream(context.Background(), r.req)
	if errors.Is(err, inference.ErrCacheMiss) && r.samples != nil {
		req, rerr := s.withReferenceAudio(r)
		if rerr != nil {
			release()
			return nil, rerr
		}
		upstream, err = client.GenerateStream(context.Background(), req)
	}
	if err != nil {
		release()
		return nil, err
	}

	pr, pw := io.Pipe()
	acc := audio.NewAccumulator(upstream.SampleRate)
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		defer release()
		_, err := io.Copy(acc, pr)
		if err == nil && acc.PCMBytes() == 0 {
			err = errors.New("inference stream ended before any PCM data was received")
		}
		if err == nil {
			err = s.finalize(rec, acc.Bytes(), "generation.wav", acc.Duration())
		}
		if err != nil {
			s.app.Logger().Error("[generate/stream] failed to save generation", "id", rec.Id, "error", err)
			s.cleanup(rec)
		}
	}()

	var once sync.Once
	return &Result{Stream: &StreamResult{
		GenerationID: rec.Id,
		SampleRate:   upstream.SampleRate,
		Reader:       io.TeeReader(upstream.Body, pw),
		Finish: func(err error) {
			once.Do(func() {
				if err != nil && !errors.Is(err, io.EOF) {
					pw.CloseWithError(err)
				} else {
					pw.Close()
				}
				upstream.Close()
			})
		},
	}}, nil
}
