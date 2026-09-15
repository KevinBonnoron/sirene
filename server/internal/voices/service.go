package voices

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"path"
	"regexp"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
	"github.com/KevinBonnoron/sirene/server/internal/audio"
	"github.com/KevinBonnoron/sirene/server/internal/pbfiles"
	"github.com/KevinBonnoron/sirene/server/internal/voicezip"
)

var WritableFields = []string{"name", "description", "language", "model", "options", "tags", "public", "avatar"}

type Service struct {
	app core.App
}

func New(app core.App) *Service {
	return &Service{app: app}
}

func notFound() error {
	return apierr.NotFound(apierr.CodeVoiceNotFound, "Voice not found")
}

func (s *Service) List(userID string) ([]*core.Record, error) {
	recs, err := s.app.FindRecordsByFilter("voices", "user = {:userId} || (public = true && user != '')", "-created", 0, 0, dbx.Params{"userId": userID})
	if recs == nil {
		recs = []*core.Record{}
	}
	return recs, err
}

// Missing and foreign private voices are indistinguishable so ids cannot be probed.
func (s *Service) Readable(id, userID string) (*core.Record, error) {
	rec, err := s.app.FindRecordById("voices", id)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && rec.GetString("user") != userID && !rec.GetBool("public")) {
		return nil, notFound()
	}
	return rec, err
}

func (s *Service) Owned(id, userID string) (*core.Record, error) {
	rec, err := s.app.FindRecordById("voices", id)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && rec.GetString("user") != userID) {
		return nil, notFound()
	}
	return rec, err
}

func (s *Service) Create(userID string, form *pbfiles.Form) (*core.Record, error) {
	col, err := s.app.FindCollectionByNameOrId("voices")
	if err != nil {
		return nil, err
	}
	rec := core.NewRecord(col)
	if err := form.Apply(rec, WritableFields); err != nil {
		return nil, err
	}
	rec.Set("user", userID)
	if err := s.app.Save(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func (s *Service) Update(id, userID string, form *pbfiles.Form) (*core.Record, error) {
	rec, err := s.Owned(id, userID)
	if err != nil {
		return nil, err
	}
	if err := form.Apply(rec, WritableFields); err != nil {
		return nil, err
	}
	if err := s.app.Save(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func (s *Service) Samples(voiceID string) ([]*core.Record, error) {
	recs, err := s.app.FindRecordsByFilter("voice_samples", "voice = {:voiceId}", "order,created", 0, 0, dbx.Params{"voiceId": voiceID})
	if recs == nil {
		recs = []*core.Record{}
	}
	return recs, err
}

func (s *Service) EnabledSamples(voiceID string) ([]*core.Record, error) {
	return s.app.FindRecordsByFilter("voice_samples", "voice = {:voiceId} && enabled = true", "order,created", 0, 0, dbx.Params{"voiceId": voiceID})
}

func (s *Service) ListSamples(voiceID, userID string) ([]*core.Record, error) {
	if _, err := s.Readable(voiceID, userID); err != nil {
		return nil, err
	}
	return s.Samples(voiceID)
}

func (s *Service) AddSample(ctx context.Context, voiceID, userID string, fh *multipart.FileHeader, transcript string) (*core.Record, error) {
	if _, err := s.Owned(voiceID, userID); err != nil {
		return nil, err
	}
	existing, err := s.Samples(voiceID)
	if err != nil {
		return nil, err
	}
	src, err := fh.Open()
	if err != nil {
		return nil, err
	}
	defer src.Close()
	data, err := io.ReadAll(src)
	if err != nil {
		return nil, err
	}
	file, err := filesystem.NewFileFromBytes(data, fh.Filename)
	if err != nil {
		return nil, err
	}
	col, err := s.app.FindCollectionByNameOrId("voice_samples")
	if err != nil {
		return nil, err
	}
	rec := core.NewRecord(col)
	rec.Set("audio", file)
	rec.Set("transcript", transcript)
	rec.Set("duration", audio.Duration(ctx, data))
	rec.Set("voice", voiceID)
	rec.Set("order", len(existing))
	rec.Set("enabled", true)
	if err := s.app.Save(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func (s *Service) SaveDesigned(userID, name, description, language, model, transcript string, fh *multipart.FileHeader) (*core.Record, error) {
	if language == "" {
		language = "en"
	}
	var voice *core.Record
	err := s.app.RunInTransaction(func(tx core.App) error {
		voices, err := tx.FindCollectionByNameOrId("voices")
		if err != nil {
			return err
		}
		voice = core.NewRecord(voices)
		voice.Set("name", name)
		voice.Set("description", description)
		voice.Set("language", language)
		voice.Set("model", model)
		voice.Set("options", map[string]any{})
		voice.Set("user", userID)
		voice.Set("public", false)
		voice.Set("tags", []string{})
		if err := tx.Save(voice); err != nil {
			return err
		}
		samples, err := tx.FindCollectionByNameOrId("voice_samples")
		if err != nil {
			return err
		}
		file, err := filesystem.NewFileFromMultipart(fh)
		if err != nil {
			return err
		}
		sample := core.NewRecord(samples)
		sample.Set("voice", voice.Id)
		sample.Set("audio", file)
		sample.Set("transcript", transcript)
		sample.Set("duration", 0)
		sample.Set("order", 0)
		sample.Set("enabled", true)
		return tx.Save(sample)
	})
	if err != nil {
		return nil, err
	}
	return voice, nil
}

func (s *Service) Import(userID string, zipBytes []byte) (*core.Record, error) {
	parsed, err := voicezip.Parse(zipBytes)
	switch {
	case errors.Is(err, voicezip.ErrMissingMeta):
		return nil, apierr.BadRequest(apierr.CodeVoiceArchiveMissing, "Invalid archive: missing voice.json")
	case errors.Is(err, voicezip.ErrInvalidMeta):
		return nil, apierr.BadRequest(apierr.CodeVoiceArchiveInvalidJson, "Invalid archive: voice.json is not valid JSON")
	case errors.Is(err, voicezip.ErrMissingName):
		return nil, apierr.BadRequest(apierr.CodeVoiceArchiveMissingName, `Invalid archive: voice.json is missing a "name" field`)
	case err != nil:
		return nil, apierr.BadRequest(apierr.CodeVoiceArchiveMissing, "Invalid archive: "+err.Error())
	}
	meta := parsed.Meta
	name, err := s.dedupeName(userID, meta.Name)
	if err != nil {
		return nil, err
	}
	var voice *core.Record
	err = s.app.RunInTransaction(func(tx core.App) error {
		voices, err := tx.FindCollectionByNameOrId("voices")
		if err != nil {
			return err
		}
		voice = core.NewRecord(voices)
		voice.Set("name", name)
		voice.Set("description", meta.Description)
		voice.Set("language", meta.Language)
		voice.Set("model", meta.Model)
		voice.Set("options", orEmptyMap(meta.Options))
		voice.Set("tags", orEmptySlice(meta.Tags))
		voice.Set("user", userID)
		if meta.Avatar != nil && *meta.Avatar != "" {
			data, err := parsed.Entry(*meta.Avatar)
			if err != nil {
				return err
			}
			if data != nil {
				file, err := filesystem.NewFileFromBytes(data, *meta.Avatar)
				if err != nil {
					return err
				}
				voice.Set("avatar", file)
			}
		}
		if err := tx.Save(voice); err != nil {
			return err
		}
		samples, err := tx.FindCollectionByNameOrId("voice_samples")
		if err != nil {
			return err
		}
		for i, sm := range meta.Samples {
			data, err := parsed.Entry("samples/" + sm.File)
			if err != nil {
				return err
			}
			if data == nil {
				continue
			}
			file, err := filesystem.NewFileFromBytes(data, sm.File)
			if err != nil {
				return err
			}
			order := sm.Order
			if order == 0 {
				order = i
			}
			rec := core.NewRecord(samples)
			rec.Set("voice", voice.Id)
			rec.Set("transcript", sm.Transcript)
			rec.Set("duration", sm.Duration)
			rec.Set("order", order)
			rec.Set("enabled", true)
			rec.Set("audio", file)
			if err := tx.Save(rec); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return voice, nil
}

type Export struct {
	Data     []byte
	Filename string
}

var unsafeName = regexp.MustCompile(`[^a-z0-9_-]+`)

func (s *Service) Export(id, userID string) (*Export, error) {
	voice, err := s.Readable(id, userID)
	if err != nil {
		return nil, err
	}
	samples, err := s.Samples(id)
	if err != nil {
		return nil, err
	}
	in := voicezip.ExportInput{
		Name:        voice.GetString("name"),
		Description: voice.GetString("description"),
		Language:    voice.GetString("language"),
		Model:       voice.GetString("model"),
	}
	_ = voice.UnmarshalJSONField("options", &in.Options)
	_ = voice.UnmarshalJSONField("tags", &in.Tags)
	for i, sm := range samples {
		audioName := sm.GetString("audio")
		data, err := pbfiles.ReadAll(s.app, sm, audioName)
		if err != nil {
			s.app.Logger().Warn("[voice export] skipping unreadable sample", "sample", sm.Id, "error", err)
			continue
		}
		ext := strings.TrimPrefix(path.Ext(audioName), ".")
		if ext == "" {
			ext = "wav"
		}
		order := sm.GetInt("order")
		if order == 0 {
			order = i
		}
		in.Samples = append(in.Samples, voicezip.ExportSample{Ext: ext, Transcript: sm.GetString("transcript"), Duration: sm.GetFloat("duration"), Order: order, Data: data})
	}
	if avatar := voice.GetString("avatar"); avatar != "" {
		if data, err := pbfiles.ReadAll(s.app, voice, avatar); err == nil {
			in.AvatarName, in.AvatarData = avatar, data
		} else {
			s.app.Logger().Warn("[voice export] skipping unreadable avatar", "voice", voice.Id, "error", err)
		}
	}
	data, err := voicezip.Build(in)
	if err != nil {
		return nil, err
	}
	safe := strings.Trim(unsafeName.ReplaceAllString(strings.ToLower(in.Name), "-"), "-")
	if safe == "" {
		safe = "voice"
	}
	return &Export{Data: data, Filename: "voice-" + safe + ".zip"}, nil
}

func (s *Service) dedupeName(userID, name string) (string, error) {
	siblings, err := s.app.FindRecordsByFilter("voices", "user = {:userId} && (name = {:name} || name ~ {:prefix})", "", 0, 0, dbx.Params{"userId": userID, "name": name, "prefix": name + " ("})
	if err != nil {
		return "", err
	}
	taken := map[string]struct{}{}
	for _, rec := range siblings {
		taken[rec.GetString("name")] = struct{}{}
	}
	if _, ok := taken[name]; !ok {
		return name, nil
	}
	for n := 2; ; n++ {
		candidate := fmt.Sprintf("%s (%d)", name, n)
		if _, ok := taken[candidate]; !ok {
			return candidate, nil
		}
	}
}

func orEmptyMap(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}

func orEmptySlice(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
