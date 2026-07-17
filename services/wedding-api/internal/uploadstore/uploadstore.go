// Package uploadstore signs presigned POST policies for host-configurable media
// (HANDOFF §3.5/§5) against the dedicated wedding-assets Garage bucket. Lean
// mirror of core-api's proofstore: POST (not PUT) so the S3 policy enforces
// content-length-range + Content-Type server-side; minio-go signs (no hand-rolled
// crypto); random hashed object keys → immutable public URLs.
package uploadstore

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/config"
)

// MaxUploadSize caps every signed policy (HANDOFF §3.5 music cap ~10MB; images
// sit well under it; the Cloudflare Tunnel caps bodies at 100MB anyway).
const MaxUploadSize = int64(10 * 1024 * 1024)

// ErrInvalid marks caller errors (unknown kind / MIME not allowed for the kind /
// size out of range) — the handler maps it to 400.
var ErrInvalid = errors.New("uploadstore: invalid upload request")

// kindMIME allowlists per settings slot. SVG is deliberately absent (stored
// user-controlled SVG served from our origin = script injection risk).
var kindMIME = map[string]map[string]string{ // kind → mime → file extension
	"hero":    imageMIME,
	"gallery": imageMIME,
	"map":     imageMIME,
	"og":      imageMIME,
	"icon":    {"image/png": "png", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico"},
	"music":   {"audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a"},
}

var imageMIME = map[string]string{"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}

// Store signs upload policies for the configured bucket.
type Store struct {
	cfg    config.UploadConfig
	client *minio.Client
}

// Presigned is one signed browser upload: POST Fields + the file to UploadURL;
// on success the object is addressable at FinalURL (host-pinned).
type Presigned struct {
	UploadURL string            `json:"uploadUrl"`
	Fields    map[string]string `json:"fields"`
	FinalURL  string            `json:"finalUrl"`
	ExpiresAt time.Time         `json:"expiresAt"`
	MaxBytes  int64             `json:"maxBytes"`
}

// New validates cfg and builds the minio client (no I/O here). Any missing field
// → error, so main.go can log-and-disable uploads while still booting.
func New(cfg config.UploadConfig) (*Store, error) {
	if cfg.S3Endpoint == "" || cfg.PublicBaseURL == "" || cfg.AccessKeyID == "" ||
		cfg.SecretAccessKey == "" || cfg.Bucket == "" {
		return nil, errors.New("uploadstore: incomplete config (endpoint/public base/bucket/key)")
	}
	endpoint, err := url.Parse(cfg.S3Endpoint)
	if err != nil || endpoint.Host == "" {
		return nil, fmt.Errorf("uploadstore: s3 endpoint %q: %w", cfg.S3Endpoint, err)
	}
	client, err := minio.New(endpoint.Host, &minio.Options{
		Creds:        credentials.NewStaticV4(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
		Secure:       endpoint.Scheme == "https",
		Region:       cfg.S3Region, // fixed region keeps PresignedPostPolicy fully offline
		BucketLookup: minio.BucketLookupPath,
	})
	if err != nil {
		return nil, fmt.Errorf("uploadstore: minio client: %w", err)
	}
	return &Store{cfg: cfg, client: client}, nil
}

// Presign signs one upload for a settings slot. The server picks the object key
// (random uuid under the kind prefix) — clients never choose keys.
func (s *Store) Presign(kind, mimeType string, size int64) (Presigned, error) {
	allowed, ok := kindMIME[kind]
	if !ok {
		return Presigned{}, fmt.Errorf("%w: unknown kind %q", ErrInvalid, kind)
	}
	ext, ok := allowed[strings.ToLower(strings.TrimSpace(mimeType))]
	if !ok {
		return Presigned{}, fmt.Errorf("%w: mime %q not allowed for %s", ErrInvalid, mimeType, kind)
	}
	if size <= 0 || size > MaxUploadSize {
		return Presigned{}, fmt.Errorf("%w: size %d out of range (1..%d)", ErrInvalid, size, MaxUploadSize)
	}

	key := fmt.Sprintf("%s/%s.%s", kind, uuid.NewString(), ext)
	expires := time.Now().Add(s.cfg.PresignTTL)

	policy := minio.NewPostPolicy()
	for _, err := range []error{
		policy.SetBucket(s.cfg.Bucket),
		policy.SetKey(key),
		policy.SetExpires(expires),
		policy.SetContentType(mimeType),
		policy.SetContentLengthRange(1, MaxUploadSize),
		policy.SetSuccessStatusAction("201"),
	} {
		if err != nil {
			return Presigned{}, fmt.Errorf("uploadstore: policy: %w", err)
		}
	}
	uploadURL, fields, err := s.client.PresignedPostPolicy(context.Background(), policy)
	if err != nil {
		return Presigned{}, fmt.Errorf("uploadstore: sign: %w", err)
	}
	return Presigned{
		UploadURL: uploadURL.String(),
		Fields:    fields,
		FinalURL:  strings.TrimSuffix(s.cfg.PublicBaseURL, "/") + "/" + key,
		ExpiresAt: expires,
		MaxBytes:  MaxUploadSize,
	}, nil
}
