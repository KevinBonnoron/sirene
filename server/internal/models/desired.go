package models

import (
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/KevinBonnoron/sirene/server/internal/catalog"
)

const desiredCollection = "desired_models"

// Desired is the set of models the operator asked for. It outlives a worker going offline,
// which is the whole point: what is installed is an observation, not the instruction.
type Desired struct {
	app core.App
}

func NewDesired(app core.App) *Desired {
	return &Desired{app: app}
}

func (d *Desired) List() (map[string]struct{}, error) {
	recs, err := d.app.FindAllRecords(desiredCollection)
	if err != nil {
		return nil, err
	}
	out := make(map[string]struct{}, len(recs))
	for _, rec := range recs {
		out[rec.GetString("model")] = struct{}{}
	}
	return out, nil
}

// A catalogue model is described by the binary; a custom one is only described by the
// worker holding it, so its descriptor is kept here or the model has no name to show the
// day that worker is disabled.
func (d *Desired) Add(m catalog.Model) error {
	if m.ID == "" {
		return nil
	}
	rec, err := d.find(m.ID)
	if err != nil {
		return err
	}
	descriptor := d.descriptorOf(m)
	if rec != nil {
		if descriptor == nil || rec.GetString("descriptor") != "" {
			return nil
		}
		rec.Set("descriptor", descriptor)
		return d.app.Save(rec)
	}
	col, err := d.app.FindCollectionByNameOrId(desiredCollection)
	if err != nil {
		return err
	}
	rec = core.NewRecord(col)
	rec.Set("model", m.ID)
	if descriptor != nil {
		rec.Set("descriptor", descriptor)
	}
	if err := d.app.Save(rec); err != nil {
		// The unique index is the arbiter; a racing writer means it is already wanted.
		if existing, findErr := d.find(m.ID); findErr == nil && existing != nil {
			return nil
		}
		return err
	}
	return nil
}

func (d *Desired) Remove(modelID string) error {
	rec, err := d.find(modelID)
	if err != nil || rec == nil {
		return err
	}
	return d.app.Delete(rec)
}

func (d *Desired) descriptorOf(m catalog.Model) types.JSONRaw {
	if catalog.IsCatalogID(m.ID) {
		return nil
	}
	raw, err := json.Marshal(m)
	if err != nil {
		return nil
	}
	return types.JSONRaw(raw)
}

// Custom: the ones whose descriptor no live worker can supply right now.
func (d *Desired) Custom() ([]catalog.Model, error) {
	recs, err := d.app.FindAllRecords(desiredCollection)
	if err != nil {
		return nil, err
	}
	out := []catalog.Model{}
	for _, rec := range recs {
		raw := rec.GetString("descriptor")
		if raw == "" {
			continue
		}
		var m catalog.Model
		if json.Unmarshal([]byte(raw), &m) == nil && m.ID != "" {
			out = append(out, m)
		}
	}
	return out, nil
}

func (d *Desired) find(modelID string) (*core.Record, error) {
	rec, err := d.app.FindFirstRecordByFilter(desiredCollection, "model = {:model}", dbx.Params{"model": modelID})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return rec, err
}
