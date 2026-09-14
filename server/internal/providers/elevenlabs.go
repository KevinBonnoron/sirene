package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
	"github.com/KevinBonnoron/sirene/server/internal/catalog"
)

const elevenLabsBase = "https://api.elevenlabs.io/v1"

var cloudClient = &http.Client{Timeout: 5 * time.Minute}

// ElevenLabs encodes display info as "Name - description".
var voiceLabel = regexp.MustCompile(`^(.+?)\s*[-–]\s*(.+)$`)

func parseVoiceLabel(name string) catalog.PresetVoice {
	if m := voiceLabel.FindStringSubmatch(name); m != nil {
		return catalog.PresetVoice{Label: strings.TrimSpace(m[1]), Description: strings.TrimSpace(m[2])}
	}
	return catalog.PresetVoice{Label: name}
}

func elevenLabsError(res *http.Response) error {
	body, _ := io.ReadAll(io.LimitReader(res.Body, 4<<10))
	return apierr.Upstream(apierr.CodeUpstreamElevenLabs, fmt.Sprintf("ElevenLabs API error (%d): %s", res.StatusCode, string(body)))
}

func ElevenLabsListVoices(ctx context.Context, apiKey string) ([]catalog.PresetVoice, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, elevenLabsBase+"/voices", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("xi-api-key", apiKey)
	res, err := cloudClient.Do(req)
	if err != nil {
		return nil, apierr.Upstream(apierr.CodeUpstreamElevenLabs, "ElevenLabs API unreachable")
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, elevenLabsError(res)
	}
	var data struct {
		Voices []struct {
			VoiceID string `json:"voice_id"`
			Name    string `json:"name"`
		} `json:"voices"`
	}
	if err := json.NewDecoder(res.Body).Decode(&data); err != nil {
		return nil, apierr.Upstream(apierr.CodeUpstreamElevenLabs, "ElevenLabs API error: invalid response")
	}
	out := make([]catalog.PresetVoice, 0, len(data.Voices))
	for _, v := range data.Voices {
		pv := parseVoiceLabel(v.Name)
		pv.ID = v.VoiceID
		out = append(out, pv)
	}
	return out, nil
}

func ElevenLabsCreateSpeech(ctx context.Context, apiKey, text, voiceID string, speed float64) ([]byte, error) {
	if speed == 0 {
		speed = 1
	}
	// ElevenLabs rejects voice_settings.speed outside this range.
	speed = min(max(speed, 0.7), 1.2)
	payload, _ := json.Marshal(map[string]any{
		"text":     text,
		"model_id": "eleven_multilingual_v2",
		"voice_settings": map[string]any{
			"stability":        0.5,
			"similarity_boost": 0.75,
			"speed":            speed,
		},
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, elevenLabsBase+"/text-to-speech/"+voiceID, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("xi-api-key", apiKey)
	req.Header.Set("Accept", "audio/mpeg")
	req.Header.Set("Content-Type", "application/json")
	res, err := cloudClient.Do(req)
	if err != nil {
		return nil, apierr.Upstream(apierr.CodeUpstreamElevenLabs, "ElevenLabs API unreachable")
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, elevenLabsError(res)
	}
	return io.ReadAll(res.Body)
}
