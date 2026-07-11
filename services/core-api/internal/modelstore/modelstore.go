// Package modelstore signs short-lived S3/Garage presigned POST policies for admin source-model
// uploads (.glb/.stl/.3mf) and enforces the host-pin on the resulting object URL (ADR-036, Phase 3
// P3-j-b). It is the sibling of internal/proofstore for a DIFFERENT asset class: catalog models are
// permanent + world-readable through the CDN, so they live in a separate public bucket with NO
// retention sweeper (contrast proofstore's private, 90-day-swept receipt bucket).
//
// Two callers must never drift on the object URL rules: the presign handler
// (POST /admin/products/{id}/model-upload) mints the key, and the asset-job create handler
// (POST /admin/products/{id}/asset-jobs) host-pins the sourceModelUrl via OwnsURL before enqueuing a
// render job. The presigned POST — not PUT — lets the S3 policy enforce content-length-range +
// Content-Type server-side; PUT would only trust a client-declared size. ADR-036 caps a single POST at
// ≤100MB (the Cloudflare Tunnel body limit, ADR-005) rather than doing S3 multipart: a web-ready model
// sits well under it, and minio-go cannot presign multipart parts. Signing is delegated to minio-go so
// the AWS SigV4 POST policy is a maintained library, not hand-rolled crypto.
package modelstore

import (
	"context"
	"errors"
	"fmt"
	"mime"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/config"
)

// MaxUploadSize caps the presigned POST content-length-range. A single POST body cannot exceed the
// Cloudflare Tunnel's 100MB limit (ADR-005), and ADR-036 chose single-POST-≤100MB over S3 multipart.
// Config may set a lower MODEL_UPLOAD_MAX_BYTES; it may never set a higher one.
const MaxUploadSize = int64(100 * 1024 * 1024)

// ErrInvalidContentType is returned when the requested MIME type is not an allowed source-model type.
// The handler maps it to a 400 so the editor can correct the picker before signing.
var ErrInvalidContentType = errors.New("modelstore: content type must be model/gltf-binary|model/stl|model/3mf")

// modelExts is the allowed source-model MIME → object-extension map. Browsers report these types
// inconsistently for 3D files (often "" or application/octet-stream), so the admin editor maps the
// file extension to one of these canonical types before requesting a signature; the signed policy then
// pins that exact Content-Type. Keep the value set in sync with ownsObjectKey's extension switch.
var modelExts = map[string]string{
	"model/gltf-binary": "glb",
	"model/stl":         "stl",
	"model/3mf":         "3mf",
}

// Store signs upload policies and owns the model object URL/key rules for one configured public bucket.
type Store struct {
	cfg    config.ModelUploadConfig
	client *minio.Client
	now    func() time.Time
	newID  func() uuid.UUID
}

// Presigned is one signed browser upload contract: POST the Fields (in order) plus the file to
// UploadURL; on success the object is addressable at FinalURL (the host-pinned sourceModelUrl an
// asset-job later references).
type Presigned struct {
	UploadURL string
	Fields    map[string]string
	FinalURL  string
	ExpiresAt time.Time
	MaxBytes  int64
}

// New validates cfg and builds a minio client for the model bucket. It returns an error (not a nil
// Store) on any unsafe config so main.go can log-and-disable model uploads while still booting; the
// client performs no I/O here. The fixed Region keeps PresignPost fully offline (no bucket-location
// lookup), so signing never blocks on Garage.
func New(cfg config.ModelUploadConfig) (*Store, error) {
	norm, err := normalizeConfig(cfg)
	if err != nil {
		return nil, err
	}
	endpoint, err := parseHTTPURL(norm.S3Endpoint)
	if err != nil {
		return nil, fmt.Errorf("modelstore: s3 endpoint: %w", err)
	}
	client, err := minio.New(endpoint.Host, &minio.Options{
		Creds:        credentials.NewStaticV4(norm.AccessKeyID, norm.SecretAccessKey, ""),
		Secure:       endpoint.Scheme == "https",
		Region:       norm.S3Region,
		BucketLookup: minio.BucketLookupPath, // Garage speaks path-style; keeps the upload URL deterministic
	})
	if err != nil {
		return nil, fmt.Errorf("modelstore: minio client: %w", err)
	}
	return &Store{
		cfg:    norm,
		client: client,
		now:    func() time.Time { return time.Now().UTC() },
		newID:  uuid.New,
	}, nil
}

// PresignPost signs a one-object POST form for a single source model. The server picks a random,
// PII-free key; the policy pins the exact Content-Type, a 1..MaxBytes content-length-range and a short
// expiry. FinalURL is derived from the public base (host-pin), never from anything the client controls.
// minio signs locally (Region fixed), so this does not touch the network.
func (s *Store) PresignPost(ctx context.Context, rawContentType string) (Presigned, error) {
	contentType, ext, ok := normalizeContentType(rawContentType)
	if !ok {
		return Presigned{}, ErrInvalidContentType
	}
	now := s.now().UTC()
	expires := now.Add(s.cfg.PostTTL)
	key := s.objectKey(now, ext)

	policy := minio.NewPostPolicy()
	if err := policy.SetBucket(s.cfg.Bucket); err != nil {
		return Presigned{}, err
	}
	if err := policy.SetKey(key); err != nil {
		return Presigned{}, err
	}
	if err := policy.SetExpires(expires); err != nil {
		return Presigned{}, err
	}
	if err := policy.SetContentType(contentType); err != nil {
		return Presigned{}, err
	}
	if err := policy.SetContentLengthRange(1, s.cfg.MaxBytes); err != nil {
		return Presigned{}, err
	}
	if err := policy.SetSuccessStatusAction("201"); err != nil {
		return Presigned{}, err
	}

	u, formData, err := s.client.PresignedPostPolicy(ctx, policy)
	if err != nil {
		return Presigned{}, err
	}
	return Presigned{
		UploadURL: u.String(),
		Fields:    formData,
		FinalURL:  s.finalURL(key),
		ExpiresAt: expires,
		MaxBytes:  s.cfg.MaxBytes,
	}, nil
}

// OwnsURL reports whether raw addresses a model object this store issued: same scheme+host as the
// public base, no query/fragment/encoded path, and a key matching the exact prefix/date/uuid.ext shape
// the signer mints. It is the sourceModelUrl host-pin an asset-job create validates against, so a
// spoofed or foreign URL can never be enqueued as a render source (ADR-036).
func (s *Store) OwnsURL(raw string) bool {
	_, ok := s.objectKeyFromURL(raw)
	return ok
}

// objectKeyFromURL returns the object key iff raw is a URL this store owns (see OwnsURL).
func (s *Store) objectKeyFromURL(raw string) (string, bool) {
	if s == nil {
		return "", false
	}
	u, err := parseHTTPURL(strings.TrimSpace(raw))
	if err != nil {
		return "", false
	}
	base, err := parseHTTPURL(s.cfg.PublicBaseURL)
	if err != nil {
		return "", false
	}
	if !sameURLOrigin(u, base) || u.RawQuery != "" || u.Fragment != "" || u.RawPath != "" {
		return "", false
	}
	key, ok := objectKeyFromFinalPath(u.Path, base.Path)
	if !ok || !s.ownsObjectKey(key) {
		return "", false
	}
	return key, true
}

func (s *Store) objectKey(now time.Time, ext string) string {
	return path.Join(s.cfg.KeyPrefix, now.UTC().Format("2006/01/02"), s.newID().String()+"."+ext)
}

func (s *Store) finalURL(key string) string {
	u, _ := url.Parse(s.cfg.PublicBaseURL)
	u.Path = path.Join(u.Path, key)
	return u.String()
}

// ownsObjectKey enforces the exact key shape the signer mints: <prefix>/YYYY/MM/DD/<uuid>.<ext> with a
// real calendar date, a strict canonical UUID and an allowed model extension. Rejecting anything else
// stops a caller from host-pinning a URL whose path was hand-crafted to sit under the base.
func (s *Store) ownsObjectKey(key string) bool {
	if key == "" || key != path.Clean(key) || strings.HasPrefix(key, "../") || strings.Contains(key, "//") {
		return false
	}
	prefix := s.cfg.KeyPrefix + "/"
	if !strings.HasPrefix(key, prefix) {
		return false
	}
	rel := strings.TrimPrefix(key, prefix)
	parts := strings.Split(rel, "/")
	if len(parts) != 4 {
		return false
	}
	if _, err := time.Parse("2006/01/02", strings.Join(parts[:3], "/")); err != nil {
		return false
	}
	name := parts[3]
	ext := path.Ext(name)
	switch ext {
	case ".glb", ".stl", ".3mf":
	default:
		return false
	}
	// Strict canonical UUID: the signer only ever mints lowercase-dashed uuid.New().String(), so
	// round-trip to accept EXACTLY that shape, not every form uuid.Parse tolerates (urn:/brace/hyphenless).
	base := strings.TrimSuffix(name, ext)
	id, err := uuid.Parse(base)
	return err == nil && id.String() == base
}

func sameURLOrigin(a, b *url.URL) bool {
	return strings.EqualFold(a.Scheme, b.Scheme) && strings.EqualFold(a.Host, b.Host)
}

func objectKeyFromFinalPath(rawPath, rawBasePath string) (string, bool) {
	full := cleanURLPath(rawPath)
	base := cleanURLPath(rawBasePath)
	if rawPath != full {
		return "", false
	}
	if base == "" {
		key := strings.TrimPrefix(full, "/")
		return key, key != ""
	}
	prefix := base + "/"
	if !strings.HasPrefix(full, prefix) {
		return "", false
	}
	key := strings.TrimPrefix(full, prefix)
	return key, key != ""
}

func cleanURLPath(p string) string {
	if p == "" {
		return ""
	}
	clean := path.Clean("/" + strings.TrimPrefix(p, "/"))
	if clean == "/" {
		return ""
	}
	return clean
}

// normalizeContentType maps an allowed source-model MIME to its canonical form + extension. It rejects
// any parameters (e.g. "; charset=binary") so the signed policy pins a bare, exact Content-Type.
func normalizeContentType(raw string) (contentType string, ext string, ok bool) {
	mediaType, params, err := mime.ParseMediaType(strings.TrimSpace(raw))
	if err != nil || len(params) > 0 {
		return "", "", false
	}
	ext, ok = modelExts[strings.ToLower(mediaType)]
	if !ok {
		return "", "", false
	}
	return strings.ToLower(mediaType), ext, true
}

// normalizeConfig trims and validates every field, capping PostTTL at 5m and MaxBytes at MaxUploadSize
// so a misconfigured env can never widen the signed policy. A missing required field disables uploads
// (New returns the error) rather than signing an unsafe or partial contract.
func normalizeConfig(cfg config.ModelUploadConfig) (config.ModelUploadConfig, error) {
	cfg.S3Endpoint = strings.TrimSpace(cfg.S3Endpoint)
	cfg.S3Region = strings.TrimSpace(cfg.S3Region)
	cfg.Bucket = strings.TrimSpace(cfg.Bucket)
	cfg.PublicBaseURL = strings.TrimSpace(cfg.PublicBaseURL)
	cfg.AccessKeyID = strings.TrimSpace(cfg.AccessKeyID)
	cfg.SecretAccessKey = strings.TrimSpace(cfg.SecretAccessKey)
	cfg.KeyPrefix = strings.Trim(strings.TrimSpace(cfg.KeyPrefix), "/")

	if cfg.S3Endpoint == "" || cfg.S3Region == "" || cfg.Bucket == "" || cfg.PublicBaseURL == "" ||
		cfg.AccessKeyID == "" || cfg.SecretAccessKey == "" || cfg.KeyPrefix == "" {
		return cfg, fmt.Errorf("modelstore: required field missing")
	}
	if _, err := parseHTTPURL(cfg.S3Endpoint); err != nil {
		return cfg, fmt.Errorf("modelstore: s3 endpoint: %w", err)
	}
	if _, err := parseHTTPURL(cfg.PublicBaseURL); err != nil {
		return cfg, fmt.Errorf("modelstore: public base url: %w", err)
	}
	if cfg.PostTTL <= 0 || cfg.PostTTL > 5*time.Minute {
		return cfg, fmt.Errorf("modelstore: post ttl must be >0 and <=5m")
	}
	if cfg.MaxBytes <= 0 || cfg.MaxBytes > MaxUploadSize {
		return cfg, fmt.Errorf("modelstore: max bytes must be >0 and <=%d", MaxUploadSize)
	}
	return cfg, nil
}

func parseHTTPURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("scheme must be http(s)")
	}
	if u.Host == "" {
		return nil, fmt.Errorf("host is required")
	}
	return u, nil
}
