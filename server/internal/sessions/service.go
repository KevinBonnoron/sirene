package sessions

import (
	"database/sql"
	"errors"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
)

type Service struct {
	app core.App
}

func New(app core.App) *Service {
	return &Service{app: app}
}

func notFound() error {
	return apierr.NotFound(apierr.CodeSessionNotFound, "Session not found")
}

func (s *Service) List(userID string) ([]*core.Record, error) {
	recs, err := s.app.FindRecordsByFilter("sessions", "user = {:userId}", "-updated", 0, 0, dbx.Params{"userId": userID})
	if recs == nil {
		recs = []*core.Record{}
	}
	return recs, err
}

func (s *Service) Owned(id, userID string) (*core.Record, error) {
	rec, err := s.app.FindRecordById("sessions", id)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && rec.GetString("user") != userID) {
		return nil, notFound()
	}
	return rec, err
}

func (s *Service) Create(userID, name string, generations []string) (*core.Record, error) {
	col, err := s.app.FindCollectionByNameOrId("sessions")
	if err != nil {
		return nil, err
	}
	if generations == nil {
		generations = []string{}
	}
	rec := core.NewRecord(col)
	rec.Set("name", name)
	rec.Set("user", userID)
	rec.Set("generations", generations)
	if err := s.app.Save(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func (s *Service) Update(id, userID string, name *string, generations *[]string) (*core.Record, error) {
	rec, err := s.Owned(id, userID)
	if err != nil {
		return nil, err
	}
	if name != nil {
		rec.Set("name", *name)
	}
	if generations != nil {
		rec.Set("generations", *generations)
	}
	if err := s.app.Save(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func (s *Service) Delete(id, userID string) error {
	rec, err := s.Owned(id, userID)
	if err != nil {
		return err
	}
	return s.app.Delete(rec)
}

// Audio file access is gated by the generation's own view rule, so the flag is denormalised onto each generation.
func (s *Service) SetPublic(id, userID string, public bool) (*core.Record, error) {
	rec, err := s.Owned(id, userID)
	if err != nil {
		return nil, err
	}
	rec.Set("public", public)
	err = s.app.RunInTransaction(func(tx core.App) error {
		if err := tx.Save(rec); err != nil {
			return err
		}
		for _, genID := range rec.GetStringSlice("generations") {
			gen, err := tx.FindRecordById("generations", genID)
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			if err != nil {
				return err
			}
			gen.Set("public", public)
			if err := tx.Save(gen); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return rec, nil
}
