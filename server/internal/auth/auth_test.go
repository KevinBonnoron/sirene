package auth

import (
	"regexp"
	"strings"
	"testing"
)

func TestGenerateSecretShapeAndHash(t *testing.T) {
	re := regexp.MustCompile(`^sk_[A-Za-z0-9_-]{32}$`)
	for i := 0; i < 20; i++ {
		s := GenerateSecret()
		if !re.MatchString(s) {
			t.Fatalf("unexpected secret shape %q", s)
		}
	}
	if prefix := GenerateSecret()[:prefixDisplayLen]; len(prefix) != 11 || !strings.HasPrefix(prefix, KeyPrefix) {
		t.Fatalf("unexpected display prefix %q", prefix)
	}
	// Vector produced with node: createHash('sha256').update(secret).digest('hex').
	if got := HashSecret("sk_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"); got != "35b28284331d41b594126c5159932d4f13de0907f8100df91adce65de2c2d0dd" {
		t.Fatalf("unexpected hash %q", got)
	}
}

func TestNormalizeScopes(t *testing.T) {
	if got, err := NormalizeScopes(nil); err != nil || got != nil {
		t.Fatal("nil must mean full access")
	}
	empty := []string{}
	if _, err := NormalizeScopes(&empty); err == nil {
		t.Fatal("empty list must be rejected")
	}
	bad := []string{"nope"}
	if _, err := NormalizeScopes(&bad); err == nil {
		t.Fatal("unknown scope must be rejected")
	}
}

func TestUserCodeFormat(t *testing.T) {
	re := regexp.MustCompile(`^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$`)
	for i := 0; i < 50; i++ {
		if code := generateUserCode(); !re.MatchString(code) {
			t.Fatalf("bad user code %q", code)
		}
	}
}
