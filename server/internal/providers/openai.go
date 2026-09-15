package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/KevinBonnoron/sirene/server/internal/apierr"
	"github.com/KevinBonnoron/sirene/server/internal/catalog"
)

const openAIBase = "https://api.openai.com/v1"

var OpenAIVoices = []catalog.PresetVoice{
	{ID: "alloy", Label: "Alloy", Description: "Neutral and balanced"},
	{ID: "ash", Label: "Ash", Description: "Warm and conversational"},
	{ID: "coral", Label: "Coral", Description: "Bright and optimistic"},
	{ID: "echo", Label: "Echo", Description: "Deep and resonant"},
	{ID: "fable", Label: "Fable", Description: "Engaging storyteller"},
	{ID: "nova", Label: "Nova", Description: "Clear and energetic"},
	{ID: "onyx", Label: "Onyx", Description: "Rich and authoritative"},
	{ID: "sage", Label: "Sage", Description: "Calm and measured"},
	{ID: "shimmer", Label: "Shimmer", Description: "Soft and warm"},
}

func OpenAICreateSpeech(ctx context.Context, apiKey, text, voice string, speed float64) ([]byte, error) {
	if speed == 0 {
		speed = 1
	}
	speed = min(max(speed, 0.25), 4)
	payload, _ := json.Marshal(map[string]any{"model": "tts-1", "input": text, "voice": voice, "speed": speed})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, openAIBase+"/audio/speech", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := cloudClient.Do(req)
	if err != nil {
		return nil, apierr.Upstream(apierr.CodeUpstreamOpenAI, "OpenAI API unreachable")
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 4<<10))
		var parsed struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal(body, &parsed) == nil && parsed.Error.Message != "" {
			return nil, apierr.Upstream(apierr.CodeUpstreamOpenAI, parsed.Error.Message)
		}
		return nil, apierr.Upstream(apierr.CodeUpstreamOpenAI, fmt.Sprintf("OpenAI TTS error (%d): %s", res.StatusCode, string(body)))
	}
	return io.ReadAll(res.Body)
}
