package uploadstore

import (
	"testing"

	miniocors "github.com/minio/minio-go/v7/pkg/cors"
)

func TestCorsHasOrigin(t *testing.T) {
	cfg := miniocors.NewConfig([]miniocors.Rule{
		{AllowedOrigin: []string{"https://a.luminstudio.vn"}},
		{AllowedOrigin: []string{"https://b.luminstudio.vn"}},
	})
	if !corsHasOrigin(cfg, "https://a.luminstudio.vn") {
		t.Fatal("expected existing origin to be found")
	}
	if corsHasOrigin(cfg, "https://c.luminstudio.vn") {
		t.Fatal("expected new origin to be absent")
	}
	if corsHasOrigin(miniocors.NewConfig(nil), "https://a.luminstudio.vn") {
		t.Fatal("expected empty config to have no origins")
	}
}
