package config

import "os"

var Version = "dev"

type Config struct {
	InferenceURL string
	UIDir        string
}

func FromEnv() Config {
	return Config{
		InferenceURL: envOr("INFERENCE_URL", "http://localhost:8000"),
		UIDir:        os.Getenv("SIRENE_UI_DIR"),
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
