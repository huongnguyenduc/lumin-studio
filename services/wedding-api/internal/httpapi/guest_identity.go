package httpapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/auth"
	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/guestidentity"
)

const identityCookie = "wedding_gid"
const identityConsentCookie = "wedding_gi_consent"

type resolveIdentityBody struct {
	Token     string                `json:"token"`
	Host      string                `json:"host"`
	EventSlug string                `json:"eventSlug"`
	GuestID   string                `json:"guestId"`
	Source    string                `json:"source"`
	Consent   bool                  `json:"consent"`
	Signals   guestidentity.Signals `json:"signals"`
}

type sharedProfile struct {
	Name string  `json:"name"`
	RSVP *string `json:"rsvp"` // nil = đã nhập tên, chưa chọn tham dự
}

func (s *server) resolveIdentity(w http.ResponseWriter, r *http.Request) {
	var body resolveIdentityBody
	if !readJSON(w, r, &body) {
		return
	}
	wedding, event, ok := s.resolvePublicEvent(w, r, body.Host, body.EventSlug)
	if !ok {
		return
	}
	source := body.Source
	if source != "personalized" {
		source = "shared"
	}
	http.SetCookie(w, &http.Cookie{
		Name: identityConsentCookie, Value: map[bool]string{true: "yes", false: "no"}[body.Consent],
		Path: "/", MaxAge: int((365 * 24 * time.Hour).Seconds()),
		Secure: s.authCookieSecure(), HttpOnly: false, SameSite: http.SameSiteLaxMode,
	})
	if !body.Consent {
		token := strings.TrimSpace(body.Token)
		if token == "" {
			if cookie, cookieErr := r.Cookie(identityCookie); cookieErr == nil {
				token = cookie.Value
			}
		}
		if token != "" {
			hash := guestidentity.Build(
				s.giSecret, wedding, token, "", guestidentity.Signals{},
			).Token
			tx, txErr := s.pool.Begin(r.Context())
			if txErr != nil {
				writeError(w, http.StatusInternalServerError, "DB", txErr.Error())
				return
			}
			defer func() { _ = tx.Rollback(r.Context()) }()
			_, txErr = tx.Exec(r.Context(), `
				DELETE FROM guest_identities WHERE id IN (
				  SELECT identity_id FROM guest_identity_tokens
				  WHERE wedding_slug=$1 AND token_hash=$2
				)`, wedding, hash)
			if txErr == nil {
				txErr = recomputeOpened(r.Context(), tx, wedding)
			}
			if txErr == nil {
				txErr = tx.Commit(r.Context())
			}
			if txErr != nil {
				writeError(w, http.StatusInternalServerError, "DB", txErr.Error())
				return
			}
		}
		http.SetCookie(w, &http.Cookie{
			Name: identityCookie, Value: "", Path: "/", MaxAge: -1,
			Secure: s.authCookieSecure(), HttpOnly: true, SameSite: http.SameSiteLaxMode,
		})
		_, err := s.pool.Exec(r.Context(), `
			INSERT INTO anonymous_open_counts (event_slug, source, opens)
			VALUES ($1, $2, 1)
			ON CONFLICT (event_slug, day, source)
			DO UPDATE SET opens = anonymous_open_counts.opens + 1`, event, source)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "DB", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"consent": false})
		return
	}
	if source == "personalized" {
		// The open belongs to the guest's OWN event — the host only picks the
		// default one, and a couple's second event may not own a subdomain.
		guestEvent, found := s.guestEventInWedding(w, r, body.GuestID, wedding)
		if !found {
			return
		}
		event = guestEvent
	}

	token := strings.TrimSpace(body.Token)
	if token == "" {
		if cookie, err := r.Cookie(identityCookie); err == nil {
			token = cookie.Value
		}
	}
	if token == "" {
		var err error
		token, err = guestidentity.NewToken()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "TOKEN", err.Error())
			return
		}
	}
	hashes := guestidentity.Build(s.giSecret, wedding, token, clientIP(r), body.Signals)
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()

	var identityID string
	confidence := "token"
	tokenTrustedForProfile := true
	err = tx.QueryRow(r.Context(), `
		SELECT identity_id,trusted_for_profile FROM guest_identity_tokens
		WHERE wedding_slug = $1 AND token_hash = $2`,
		wedding, hashes.Token).Scan(&identityID, &tokenTrustedForProfile)
	if err == pgx.ErrNoRows {
		identityID, confidence, err = matchFingerprint(r.Context(), tx, wedding, hashes)
		tokenTrustedForProfile = confidence != "fingerprint"
	}
	if err != nil && err != pgx.ErrNoRows {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	expiresAt, err := identityExpiry(r.Context(), tx, event)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	if identityID == "" {
		confidence = "new"
		err = tx.QueryRow(r.Context(), `
			INSERT INTO guest_identities
			  (wedding_slug, fingerprint_hash, fingerprint_ver, browser_family,
			   device_family, match_confidence, consented_at, expires_at)
			VALUES ($1,$2,$3,$4,$5,$6,now(),$7)
			RETURNING id`,
			wedding, hashes.Fingerprint, guestidentity.Version, hashes.Browser,
			hashes.Device, confidence, expiresAt).Scan(&identityID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "DB", err.Error())
			return
		}
	} else {
		_, err = tx.Exec(r.Context(), `
			UPDATE guest_identities SET
			  fingerprint_hash=$2, browser_family=$3, device_family=$4,
			  match_confidence=$5, last_seen_at=now(),
			  expires_at=greatest(expires_at,$6)
			WHERE id=$1`,
			identityID, hashes.Fingerprint, hashes.Browser, hashes.Device,
			confidence, expiresAt)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "DB", err.Error())
			return
		}
	}
	_, err = tx.Exec(r.Context(), `
		INSERT INTO guest_identity_tokens
		  (identity_id, wedding_slug, token_hash, trusted_for_profile)
		VALUES ($1,$2,$3,$4) ON CONFLICT (wedding_slug, token_hash) DO NOTHING`,
		identityID, wedding, hashes.Token, tokenTrustedForProfile)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}

	isAdmin := false
	if scope, valid := s.auth.ScopeFromRequest(r); valid && (scope == wedding || scope == auth.ScopeAll) {
		isAdmin = true
		_, err = tx.Exec(r.Context(), `
			INSERT INTO admin_identity_claims (identity_id, wedding_slug, claimed_via)
			VALUES ($1,$2,'session') ON CONFLICT (identity_id) DO NOTHING`, identityID, wedding)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "DB", err.Error())
			return
		}
		if err = recomputeOpened(r.Context(), tx, wedding); err != nil {
			writeError(w, http.StatusInternalServerError, "DB", err.Error())
			return
		}
	} else {
		err = tx.QueryRow(r.Context(),
			`SELECT EXISTS(SELECT 1 FROM admin_identity_claims WHERE identity_id=$1)`,
			identityID).Scan(&isAdmin)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "DB", err.Error())
			return
		}
	}

	var guestID any
	if source == "personalized" {
		guestID = body.GuestID
	}
	_, err = tx.Exec(r.Context(), `
		INSERT INTO invite_opens (identity_id,event_slug,guest_id,source)
		VALUES ($1,$2,$3,$4)`, identityID, event, guestID, source)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	if source == "personalized" && !isAdmin {
		_, err = tx.Exec(r.Context(),
			`UPDATE guests SET opened_at=coalesce(opened_at,now()) WHERE id=$1 AND event_slug=$2`,
			body.GuestID, event)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "DB", err.Error())
			return
		}
	}

	var profile *sharedProfile
	if source == "shared" && confidence == "token" && tokenTrustedForProfile {
		var p sharedProfile
		err = tx.QueryRow(r.Context(), `
			SELECT name,rsvp FROM shared_guest_responses
			WHERE identity_id=$1 AND event_slug=$2`, identityID, event).Scan(&p.Name, &p.RSVP)
		if err == nil {
			profile = &p
		} else if err != pgx.ErrNoRows {
			writeError(w, http.StatusInternalServerError, "DB", err.Error())
			return
		}
	}
	if err = tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: identityCookie, Value: token, Path: "/",
		MaxAge: int(time.Until(expiresAt).Seconds()), Secure: s.authCookieSecure(),
		HttpOnly: true, SameSite: http.SameSiteLaxMode,
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"consent": true, "identityId": identityID, "token": token,
		"isAdmin": isAdmin, "matchConfidence": confidence, "profile": profile,
	})
}

func matchFingerprint(
	ctx context.Context,
	tx pgx.Tx,
	wedding string,
	h guestidentity.Hashes,
) (string, string, error) {
	rows, err := tx.Query(ctx, `
			SELECT id FROM guest_identities
			WHERE wedding_slug=$1 AND fingerprint_ver=$2 AND fingerprint_hash=$3
			  AND expires_at > now()
			  AND NOT EXISTS (
			    SELECT 1 FROM admin_identity_claims a WHERE a.identity_id=guest_identities.id
			  )
			ORDER BY last_seen_at DESC LIMIT 2`, wedding, guestidentity.Version, h.Fingerprint)
	if err != nil {
		return "", "", err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return "", "", err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if len(ids) == 1 {
		return ids[0], "fingerprint", nil
	}
	return "", "new", nil
}

func identityExpiry(ctx context.Context, tx pgx.Tx, event string) (time.Time, error) {
	var expiry time.Time
	err := tx.QueryRow(ctx, `
		SELECT CASE
		  WHEN data->>'date' ~ '^[0-9]{2}\.[0-9]{2}\.[0-9]{4}$'
		  THEN to_date(data->>'date','DD.MM.YYYY')::timestamptz + interval '90 days'
		  ELSE now() + interval '90 days'
		END
		FROM events WHERE slug=$1`, event).Scan(&expiry)
	return expiry, err
}

func (s *server) resolvePublicEvent(
	w http.ResponseWriter,
	r *http.Request,
	host string,
	requested string,
) (string, string, bool) {
	wedding, err := s.weddingByHost(r.Context(), host)
	if err != nil {
		writeHostErr(w, err)
		return "", "", false
	}
	var event string
	if requested != "" {
		err = s.pool.QueryRow(r.Context(),
			`SELECT slug FROM events WHERE slug=$1 AND wedding_slug=$2`, requested, wedding).Scan(&event)
	} else {
		hostname := strings.ToLower(strings.Split(host, ":")[0])
		err = s.pool.QueryRow(r.Context(), `
			SELECT slug FROM events WHERE wedding_slug=$1
			ORDER BY (lower(subdomain)=$2) DESC, sort_order, slug LIMIT 1`,
			wedding, hostname).Scan(&event)
	}
	if err == pgx.ErrNoRows {
		writeError(w, http.StatusNotFound, "EVENT_NOT_FOUND", "không tìm thấy đám cưới")
		return "", "", false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return "", "", false
	}
	return wedding, event, true
}

// guestEventInWedding returns the event a guest link belongs to, refusing any
// guest outside the wedding serving this host (cross-couple isolation).
func (s *server) guestEventInWedding(
	w http.ResponseWriter,
	r *http.Request,
	guestID string,
	wedding string,
) (string, bool) {
	var event string
	err := s.pool.QueryRow(r.Context(),
		`SELECT g.event_slug FROM guests g JOIN events e ON e.slug = g.event_slug
		 WHERE g.id = $1 AND e.wedding_slug = $2`, guestID, wedding).Scan(&event)
	if err == pgx.ErrNoRows {
		writeError(w, http.StatusNotFound, "GUEST_NOT_FOUND", "không tìm thấy khách mời")
		return "", false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return "", false
	}
	return event, true
}

func (s *server) postSharedRSVP(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token     string `json:"token"`
		Host      string `json:"host"`
		EventSlug string `json:"eventSlug"`
		Name      string `json:"name"`
		RSVP      string `json:"rsvp"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" || len([]rune(name)) > maxWishNameLen {
		writeError(w, http.StatusBadRequest, "BAD_NAME", "tên không được trống và tối đa 100 ký tự")
		return
	}
	// "" = chỉ lưu tên (khách gõ xong nhưng chưa chọn tham dự/không tham dự).
	if body.RSVP != "" && body.RSVP != "yes" && body.RSVP != "no" {
		writeError(w, http.StatusBadRequest, "BAD_RSVP", `rsvp phải là "yes", "no" hoặc rỗng`)
		return
	}
	var rsvp *string
	if body.RSVP != "" {
		rsvp = &body.RSVP
	}
	wedding, event, ok := s.resolvePublicEvent(w, r, body.Host, body.EventSlug)
	if !ok {
		return
	}
	hashes := guestidentity.Build(s.giSecret, wedding, body.Token, "", guestidentity.Signals{})
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	var identityID string
	var trusted bool
	var tokenCreatedAt time.Time
	err = tx.QueryRow(r.Context(), `
		SELECT identity_id,trusted_for_profile,created_at FROM guest_identity_tokens
		WHERE wedding_slug=$1 AND token_hash=$2`,
		wedding, hashes.Token).Scan(&identityID, &trusted, &tokenCreatedAt)
	if err == pgx.ErrNoRows {
		writeError(w, http.StatusUnauthorized, "IDENTITY_NOT_FOUND", "phiên khách mời không hợp lệ")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	var hasOpen bool
	err = tx.QueryRow(r.Context(), `
		SELECT EXISTS(SELECT 1 FROM invite_opens
		WHERE identity_id=$1 AND event_slug=$2 AND source='shared')`,
		identityID, event).Scan(&hasOpen)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	if !hasOpen {
		writeError(w, http.StatusUnauthorized, "IDENTITY_NOT_FOUND", "phiên khách mời không hợp lệ")
		return
	}
	if !trusted {
		var forkedID string
		err = tx.QueryRow(r.Context(), `
			INSERT INTO guest_identities
			  (wedding_slug,fingerprint_hash,fingerprint_ver,browser_family,device_family,
			   match_confidence,consented_at,first_seen_at,last_seen_at,expires_at)
			SELECT wedding_slug,fingerprint_hash,fingerprint_ver,browser_family,device_family,
			       'new',now(),now(),now(),expires_at
			FROM guest_identities WHERE id=$1
			RETURNING id`, identityID).Scan(&forkedID)
		if err == nil {
			_, err = tx.Exec(r.Context(), `
				UPDATE guest_identity_tokens
				SET identity_id=$1,trusted_for_profile=true
				WHERE wedding_slug=$2 AND token_hash=$3`,
				forkedID, wedding, hashes.Token)
		}
		if err == nil {
			_, err = tx.Exec(r.Context(), `
				UPDATE invite_opens SET identity_id=$1
				WHERE identity_id=$2 AND event_slug=$3 AND source='shared' AND opened_at >= $4`,
				forkedID, identityID, event, tokenCreatedAt)
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "DB", err.Error())
			return
		}
		identityID = forkedID
	}
	// coalesce: lưu-tên-thôi (rsvp NULL) KHÔNG được xoá lựa chọn đã có; rsvp_at
	// chỉ nhích khi thực sự gửi kèm một lựa chọn.
	tag, err := tx.Exec(r.Context(), `
		INSERT INTO shared_guest_responses (identity_id,event_slug,name,rsvp,rsvp_at)
		VALUES ($1,$2,$3,$4,CASE WHEN $4::text IS NULL THEN NULL ELSE now() END)
		ON CONFLICT (identity_id,event_slug) DO UPDATE
		SET name=excluded.name,
		    rsvp=coalesce(excluded.rsvp,shared_guest_responses.rsvp),
		    rsvp_at=CASE WHEN excluded.rsvp IS NULL THEN shared_guest_responses.rsvp_at
		                 ELSE now() END,
		    updated_at=now()`,
		identityID, event, name, rsvp)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusUnauthorized, "IDENTITY_NOT_FOUND", "phiên khách mời không hợp lệ")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) createIdentityClaim(w http.ResponseWriter, r *http.Request) {
	wedding, ok := weddingScope(w, r)
	if !ok {
		return
	}
	token, err := guestidentity.NewToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "TOKEN", err.Error())
		return
	}
	hash := guestidentity.Build(s.giSecret, wedding, token, "", guestidentity.Signals{}).Token
	_, err = s.pool.Exec(r.Context(), `
		INSERT INTO identity_claim_tokens (wedding_slug,token_hash,expires_at)
		VALUES ($1,$2,now()+interval '10 minutes')`, wedding, hash)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"token": token, "expiresAt": time.Now().Add(10 * time.Minute),
	})
}

func (s *server) consumeIdentityClaim(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IdentityToken string `json:"identityToken"`
		Host          string `json:"host"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	wedding, err := s.weddingByHost(r.Context(), body.Host)
	if err != nil {
		writeHostErr(w, err)
		return
	}
	claimHash := guestidentity.Build(s.giSecret, wedding, chi.URLParam(r, "token"), "", guestidentity.Signals{}).Token
	identityHash := guestidentity.Build(s.giSecret, wedding, body.IdentityToken, "", guestidentity.Signals{}).Token
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	var identityID string
	err = tx.QueryRow(r.Context(), `
		SELECT identity_id FROM guest_identity_tokens
		WHERE wedding_slug=$1 AND token_hash=$2`, wedding, identityHash).Scan(&identityID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "IDENTITY_NOT_FOUND", "phiên khách mời không hợp lệ")
		return
	}
	tag, err := tx.Exec(r.Context(), `
		UPDATE identity_claim_tokens SET consumed_at=now()
		WHERE wedding_slug=$1 AND token_hash=$2 AND consumed_at IS NULL AND expires_at>now()`,
		wedding, claimHash)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusGone, "CLAIM_EXPIRED", "link xác nhận đã hết hạn hoặc đã dùng")
		return
	}
	_, err = tx.Exec(r.Context(), `
		INSERT INTO admin_identity_claims (identity_id,wedding_slug,claimed_via)
		VALUES ($1,$2,'link') ON CONFLICT (identity_id) DO NOTHING`, identityID, wedding)
	if err == nil {
		err = recomputeOpened(r.Context(), tx, wedding)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func recomputeOpened(ctx context.Context, tx pgx.Tx, wedding string) error {
	_, err := tx.Exec(ctx, `
		UPDATE guests g SET opened_at=coalesce((
		  SELECT min(o.opened_at) FROM invite_opens o
		  WHERE o.guest_id=g.id
		    AND NOT EXISTS (
		      SELECT 1 FROM admin_identity_claims a WHERE a.identity_id=o.identity_id
		    )
		), g.legacy_opened_at)
		WHERE g.event_slug IN (SELECT slug FROM events WHERE wedding_slug=$1)`, wedding)
	return err
}

func (s *server) listSharedGuests(w http.ResponseWriter, r *http.Request) {
	event := r.URL.Query().Get("event")
	if event == "" || !s.eventInScope(w, r, event) {
		return
	}
	var wedding string
	if err := s.pool.QueryRow(r.Context(),
		`SELECT wedding_slug FROM events WHERE slug=$1`, event).Scan(&wedding); err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	currentIdentity := ""
	if cookie, err := r.Cookie(identityCookie); err == nil {
		hash := guestidentity.Build(
			s.giSecret, wedding, cookie.Value, "", guestidentity.Signals{},
		).Token
		_ = s.pool.QueryRow(r.Context(), `
			SELECT identity_id FROM guest_identity_tokens
			WHERE wedding_slug=$1 AND token_hash=$2`, wedding, hash).Scan(&currentIdentity)
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT i.id,i.browser_family,i.device_family,i.match_confidence,i.first_seen_at,i.last_seen_at,
		       p.name,p.rsvp,p.rsvp_at,
		       EXISTS(SELECT 1 FROM admin_identity_claims a WHERE a.identity_id=i.id),
		       count(o.id),min(o.opened_at),max(o.opened_at)
		FROM guest_identities i
		JOIN invite_opens o ON o.identity_id=i.id AND o.event_slug=$1 AND o.source='shared'
		LEFT JOIN shared_guest_responses p ON p.identity_id=i.id AND p.event_slug=$1
		GROUP BY i.id,p.name,p.rsvp,p.rsvp_at
		ORDER BY max(o.opened_at) DESC`, event)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, browser, device, confidence string
		var firstSeen, lastSeen time.Time
		var name, rsvp *string
		var rsvpAt, firstOpen, lastOpen *time.Time
		var admin bool
		var opens int
		if err := rows.Scan(&id, &browser, &device, &confidence, &firstSeen, &lastSeen,
			&name, &rsvp, &rsvpAt, &admin, &opens, &firstOpen, &lastOpen); err != nil {
			writeError(w, http.StatusInternalServerError, "DB", err.Error())
			return
		}
		items = append(items, map[string]any{
			"id": id, "browserFamily": browser, "deviceFamily": device,
			"matchConfidence": confidence,
			"firstSeenAt":     firstSeen, "lastSeenAt": lastSeen, "name": name,
			"rsvp": rsvp, "rsvpAt": rsvpAt, "isAdmin": admin, "openCount": opens,
			"isCurrent": id == currentIdentity, "firstOpenedAt": firstOpen, "lastOpenedAt": lastOpen,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *server) setIdentityAdmin(w http.ResponseWriter, r *http.Request) {
	wedding, ok := weddingScope(w, r)
	if !ok {
		return
	}
	var body struct {
		Admin bool `json:"admin"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	id := chi.URLParam(r, "id")
	if body.Admin {
		_, err = tx.Exec(r.Context(), `
			INSERT INTO admin_identity_claims (identity_id,wedding_slug,claimed_via)
			SELECT id,$2,'manual' FROM guest_identities WHERE id=$1 AND wedding_slug=$2
			ON CONFLICT (identity_id) DO NOTHING`, id, wedding)
	} else {
		_, err = tx.Exec(r.Context(),
			`DELETE FROM admin_identity_claims WHERE identity_id=$1 AND wedding_slug=$2`, id, wedding)
	}
	if err == nil {
		err = recomputeOpened(r.Context(), tx, wedding)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) deleteIdentity(w http.ResponseWriter, r *http.Request) {
	wedding, ok := weddingScope(w, r)
	if !ok {
		return
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	tag, err := tx.Exec(r.Context(),
		`DELETE FROM guest_identities WHERE id=$1 AND wedding_slug=$2`,
		chi.URLParam(r, "id"), wedding)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "IDENTITY_NOT_FOUND", "không tìm thấy thiết bị")
		return
	}
	if err = recomputeOpened(r.Context(), tx, wedding); err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) deleteAllIdentities(w http.ResponseWriter, r *http.Request) {
	wedding, ok := weddingScope(w, r)
	if !ok {
		return
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if _, err = tx.Exec(r.Context(),
		`DELETE FROM guest_identities WHERE wedding_slug=$1`, wedding); err == nil {
		err = recomputeOpened(r.Context(), tx, wedding)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) purgeExpiredIdentities(ctx context.Context) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err = tx.Exec(ctx, `
		UPDATE guests g SET legacy_opened_at=CASE
		  WHEN g.legacy_opened_at IS NULL OR x.first_open < g.legacy_opened_at THEN x.first_open
		  ELSE g.legacy_opened_at
		END
		FROM (
		  SELECT o.guest_id,min(o.opened_at) AS first_open
		  FROM invite_opens o
		  JOIN guest_identities i ON i.id=o.identity_id
		  WHERE i.expires_at <= now() AND o.guest_id IS NOT NULL
		    AND NOT EXISTS (
		      SELECT 1 FROM admin_identity_claims a WHERE a.identity_id=o.identity_id
		    )
		  GROUP BY o.guest_id
		) x
		WHERE g.id=x.guest_id`); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM guest_identities WHERE expires_at <= now()`); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM identity_claim_tokens WHERE expires_at <= now()`); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *server) authCookieSecure() bool {
	return s.auth.CookieSecure()
}
