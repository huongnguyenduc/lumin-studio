package httpapi

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/auth"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// errUnauthenticated / errForbidden are the two auth-boundary sentinels. mapError renders
// them as a 401 UNAUTHORIZED / 403 FORBIDDEN ErrorEnvelope (ADR-032) — no message leaks which
// check failed. errUnauthenticated = no/invalid credential; errForbidden = valid credential,
// insufficient role.
var (
	errUnauthenticated = errors.New("httpapi: unauthenticated")
	errForbidden       = errors.New("httpapi: forbidden")
)

// authClass is how a single operation is gated at the boundary. The default (authRequired)
// is fail-closed: an operation added later with no explicit entry in classify below requires
// a valid actor rather than silently becoming public.
type authClass int

const (
	// authRequired needs a valid session actor; absent/invalid → 401. The DEFAULT.
	authRequired authClass = iota
	// authPublic needs no credential (login/logout — issuing or clearing a cookie can't
	// itself require one).
	authPublic
	// authOptional resolves the actor iff a cookie is present but never rejects when it is
	// absent — the public web POST /orders path, where §3g still gates channel=inbox on a
	// resolved staff/owner actor.
	authOptional
	// authOwnerOnly needs a valid actor whose role is owner (PATCH /admin/settings/bank-account,
	// the STK write — owner-only per conventions §Bảo mật / ADR-012). This is the requireOwner
	// boundary; transition RBAC (reconcile→PAID, →REFUNDED) stays in the domain guard.
	authOwnerOnly
	// authCustomer needs a valid STOREFRONT customer session (PR-P1-r) — a DIFFERENT realm from the
	// admin classes above (separate cookie + secret, ADR-030). It resolves the customer id from the
	// customer cookie and injects it; absent/invalid → 401. An admin token can never satisfy it.
	authCustomer
	// authOptionalCustomer is the customer-realm mirror of authOptional: it resolves + injects the customer
	// iff a valid customer cookie is present, but NEVER rejects — an absent OR invalid/expired cookie just
	// continues anonymously. Used by the PUBLIC pet page (GetPetPage), where the optional owner identity
	// only unlocks the un-masked contact; a stale cookie must never 401 a page any stranger can read. It is
	// deliberately more lenient than admin authOptional (which 401s a present-but-bad cookie) for that reason.
	authOptionalCustomer
	// authService gates the in-cluster asset-worker's render callback (ReportAssetJobResult, ADR-045). A
	// THIRD realm: the credential is a static shared secret (a Bearer), NOT a user/customer session, so it
	// injects NO actor — the worker has no identity, only proof-of-trust. Compared constant-time against the
	// configured workerCallbackToken; an unset token (empty) matches nothing → the endpoint is fail-closed.
	authService
)

// classify maps a generated operationID to its gate. Unlisted operations fall through to
// authRequired (fail-closed) — the security-critical default. Only endpoints deliberately
// public or optional are enumerated here; a reviewer adding an admin endpoint gets auth for
// free, and one adding a public endpoint must state it explicitly.
func classify(operationID string) authClass {
	switch operationID {
	case "LoginUser", "LogoutUser":
		return authPublic
	case "GetProductBySlug":
		// Public storefront catalog read (PR-P1-a) — no session; active-only detail. Any actor
		// resolution would be dead weight (a dashboard read needs a user; a catalog read never does).
		return authPublic
	case "QuotePrice":
		// Public storefront pricing preview (PR-P1-b) — no session; server-authoritative line/subtotal.
		// Persists nothing; the response IS the authoritative price, so no actor is ever needed.
		return authPublic
	case "GetProducts":
		// Public storefront catalog list (PR-P1-c) — no session; active-only card projection. Like the
		// detail read, a catalog list never needs an actor; keeping it public avoids gating browse behind auth.
		return authPublic
	case "GetProductReviews":
		// Public storefront product-review list (PR-P1-l) — no session; published-only, active-product-only.
		// A public review list never needs an actor; keeping it public avoids gating it behind auth (the
		// published-only + product-existence non-leak boundaries live in the query/handler, not in auth).
		return authPublic
	case "GetCategories":
		// Public storefront category list (PR-P1-d) — no session; the browsable taxonomy for the browse chips.
		// The visibility axis (P3-o o-2 `visible` toggle + active-product EXISTS) is enforced in the query, not
		// auth; the endpoint carries no money. Keeping it public avoids gating browse behind auth (a fail-closed
		// default would 401 the storefront's category chips).
		return authPublic
	case "LookupOrder":
		// Public guest order tracking (PR-P1-n) — no session; a customer looks up their own order by
		// code + phone. It is gated instead by a constant-time code+phone match and a per-code
		// token-bucket + lockout (handler), not by auth: a guest has no account to authenticate with.
		return authPublic
	case "TrackOrder":
		// Public phone-less order tracking (P2-i, D-P2-8) — no session; the confirmation-screen link
		// /o/{code}-{token}. Gated in the handler by a constant-time HMAC capability-token match + the
		// shared per-code token-bucket, not by auth: the token IS the authorization (a guest has none).
		return authPublic
	case "GetCheckoutConfig":
		// Public checkout config (PR-P2-a) — no session; the anonymous STK + VietQR URL + shippable
		// provinces + refund policy the payment step needs. A whitelist read that persists nothing and
		// leaks no PII; keeping it public avoids gating the checkout screen behind auth (guests check out).
		return authPublic
	case "CreatePaymentProofUpload":
		// Public checkout receipt-upload bootstrap (P2-c) — no session; it signs a one-object POST
		// policy with a random server-generated key and persists nothing. The resulting finalUrl is
		// later consumed by the public web POST /orders path.
		return authPublic
	case "CreateImageUpload":
		// Public permanent-image upload bootstrap (P3-t t-6, P3-l) — no session; signs a one-object POST
		// policy with a random server-generated key to the world-readable lumin-assets bucket and persists
		// nothing. Mirrors CreatePaymentProofUpload's public + rate-limited posture.
		return authPublic
	case "CreateOrder":
		return authOptional
	case "UpdateBankAccount",
		"UpdateShippingRules", "UpdateRefundPolicy",
		"CreateReplyTemplate", "UpdateReplyTemplate", "DeleteReplyTemplate":
		// Every settings/config WRITE is owner-only (staff không sửa cài đặt — domain-core RBAC).
		// Shipping rules are money-adjacent (checkout fee); the rest is shop config. Reads
		// (GetSettings/ListReplyTemplates) stay authRequired (owner+staff) via the default.
		return authOwnerOnly
	case "CreateAdminProduct", "UpdateAdminProduct", "DeleteAdminProduct", "UpdateProductModelView",
		"CreateAdminCategory", "UpdateAdminCategory", "DeleteAdminCategory", "ReorderAdminCategories",
		"CreateProductColor", "UpdateProductColor", "DeleteProductColor",
		"CreateProductOption", "UpdateProductOption", "DeleteProductOption",
		"CreateProductPart", "UpdateProductPart", "DeleteProductPart",
		"CreateOptionChoice", "UpdateOptionChoice", "DeleteOptionChoice",
		"CreateProductModelUpload", "CreateProductAssetJob",
		"CreateFilamentMaterial", "UpdateFilamentMaterial", "ImportFilament", "ScrapFilament",
		"CreateMachine", "UpdateMachine", "DeleteMachine",
		"CreateAuxCost", "UpdateAuxCost", "DeleteAuxCost":
		// Every catalog WRITE is owner-only (spec §08: sản phẩm is an owner power; staff manages orders/
		// print-queue/reviews, not the catalog). Category writes (P3-o) are the same catalog-taxonomy power.
		// Model upload + asset-job enqueue mutate the catalog's asset pipeline, so they are owner-only too
		// (P3-j-b). Vật tư mutations (filament material/import/scrap, machines, aux costs — ADR-039) are
		// cost config → owner-only too. The reads (GetAdminProducts/GetAdminProduct/GetAdminCategories/
		// GetProductAssetJobs/ListFilamentMaterials/GetFilamentMaterial/ListMachines/ListAuxCosts) stay
		// authRequired (owner+staff) via the default, mirroring settings.
		return authOwnerOnly
	case "GetAdminStaff", "CreateStaff":
		// Staff & roles (P3-q) is owner-only for BOTH read and write: managing the team — and even
		// seeing the roster — is an owner power (spec §08; the design's role matrix gives staff no
		// access to "Cài đặt & nhân viên"). This is the ONE owner-only admin READ; every other admin
		// read stays owner+staff via the default. The RBAC matrix the FE draws is display-only.
		return authOwnerOnly
	case "ReportAssetJobResult":
		// The asset-worker render callback (ADR-045) — service-token auth, no user session. It writes an
		// asset job's result + the product's model3d_url, so it must never be reachable by a browser/user
		// credential; authService gates it on the static worker secret alone. Explicit (not the fail-closed
		// default) because the default requires a USER actor, which a headless worker can never present.
		return authService
	case "RegisterCustomer", "LoginCustomer", "LogoutCustomer":
		// Storefront customer auth entry points (PR-P1-r) — issuing or clearing a customer cookie
		// can't itself require one (mirrors LoginUser/LogoutUser). Register/login gate on the
		// credential; logout is idempotent.
		return authPublic
	case "SharePetLocation":
		// Public rescue send-once (P3-t t-4b) — a finder (an anonymous stranger who scanned a LOST pet)
		// shares their location once so the owner can find them. No session: the finder has no account and
		// is never the owner. Guarded in the handler by the lost-mode check + a coord range check + a global
		// token-bucket (a public write; the edge WAF is the per-IP sweep). authPublic, not
		// authOptionalCustomer — recognising a viewer buys nothing (a finder is not the owner).
		return authPublic
	case "GetPetPage":
		// Public pet-page read (P3-t t-3/t-4a) — the /t/{shortId} scan target. Anyone who taps the chip
		// reads it (no session required); but the customer session is resolved OPTIONALLY so the owner is
		// recognised (viewerIsOwner → un-masked contact). A stale/absent cookie must not 401 a page any
		// stranger can read, so this is authOptionalCustomer (lenient), not authCustomer.
		return authOptionalCustomer
	case "GetCustomerOrders", "ActivatePetTag", "ToggleLostMode", "UpdatePetProfile", "UpdatePetAppearance":
		// GetCustomerOrders — the authenticated customer's own order history. ActivatePetTag (P3-t t-3) —
		// onboarding attaches the scanned tag to WHICHEVER customer is signed in (spec §10 "tag tự gắn
		// vào tài khoản vừa đăng nhập"). ToggleLostMode (P3-t t-4a) + UpdatePetProfile (P3-t t-4c-1, the
		// in-place editor) + UpdatePetAppearance (P3-t t-4c-2, the theme sheet + reorder mode) — only the
		// owner may write; the owner_account_id guard in SQL is the final authz, but a valid CUSTOMER session
		// (not the admin cookie) is required first. resolveCustomer injects the id; absent/invalid → 401.
		return authCustomer
	default:
		// GetDashboard, ListReplyTemplates, GetSettings, TransitionOrder, + any new operation.
		return authRequired
	}
}

// authMiddleware is the StrictMiddlewareFunc wired into the strict-server handler (router.go).
// It runs for every operation, branches on classify(operationID), resolves the actor from the
// session cookie, and injects it into the context the downstream handler receives. It NEVER
// re-implements RBAC math: it authenticates + resolves the role and (for owner-only edges)
// checks it, then hands the actor to the handler, which passes it into the domain guard
// (order.RoleAllowed/Transition) — the domain stays the source of truth (defense in depth).
func (s *Server) authMiddleware(next api.StrictHandlerFunc, operationID string) api.StrictHandlerFunc {
	return func(ctx context.Context, w http.ResponseWriter, r *http.Request, request interface{}) (interface{}, error) {
		class := classify(operationID)
		if class == authPublic {
			return next(ctx, w, r, request)
		}

		// authService: the asset-worker render callback (ADR-045). A static shared-secret Bearer, compared
		// constant-time — no actor is resolved or injected (the worker has no identity). Fail-closed on an
		// unset token: an empty workerCallbackToken can never equal a presented Bearer AND we reject up front,
		// so a forgotten secret disables the endpoint rather than accepting an empty credential.
		if class == authService {
			if s.workerCallbackToken == "" {
				return nil, errUnauthenticated
			}
			if subtle.ConstantTimeCompare([]byte(bearerToken(r)), []byte(s.workerCallbackToken)) != 1 {
				return nil, errUnauthenticated
			}
			return next(ctx, w, r, request)
		}

		// The storefront customer realm resolves from its OWN cookie + issuer (separate secret), never
		// the admin path below — an admin token can't authenticate a customer request and vice versa.
		if class == authCustomer {
			id, ok, err := s.resolveCustomer(r)
			if err != nil {
				return nil, err // customer cookie present but invalid → 401
			}
			if !ok {
				return nil, errUnauthenticated // no customer session
			}
			return next(withCustomer(ctx, id), w, r, request)
		}

		// authOptionalCustomer never rejects: inject the customer iff the cookie resolves, else continue
		// anonymously — a stale/absent customer cookie must not 401 the public pet page (see the class doc).
		if class == authOptionalCustomer {
			if id, ok, err := s.resolveCustomer(r); err == nil && ok {
				return next(withCustomer(ctx, id), w, r, request)
			}
			return next(ctx, w, r, request)
		}

		actor, ok, err := s.resolveActor(ctx, r)
		if err != nil {
			// A cookie was present but unusable (bad signature/expired/unknown or deactivated
			// user), or a genuine DB fault. resolveActor already distinguished them: an auth
			// failure is errUnauthenticated (→401), a DB fault is the raw error (→500).
			return nil, err
		}
		if !ok {
			// No credential at all.
			if class == authOptional {
				return next(ctx, w, r, request)
			}
			return nil, errUnauthenticated
		}
		if class == authOwnerOnly && actor.Role != order.RoleOwner {
			return nil, errForbidden
		}
		return next(withActor(ctx, actor), w, r, request)
	}
}

// bearerToken extracts a JWT from an "Authorization: Bearer <token>" header, or "" when the header
// is absent or not a Bearer credential. The MV3 extension (ADR-043) authenticates this way — it
// can't carry the SameSite=Strict session cookie cross-origin, so it stores the token in
// chrome.storage.local and presents it here. The scheme match is case-insensitive (RFC 6750 §2.1).
func bearerToken(r *http.Request) string {
	const prefix = "Bearer "
	h := r.Header.Get("Authorization")
	if len(h) > len(prefix) && strings.EqualFold(h[:len(prefix)], prefix) {
		return strings.TrimSpace(h[len(prefix):])
	}
	return ""
}

// resolveActor reads the session credential — an Authorization: Bearer token (the MV3 extension,
// ADR-043) or, failing that, the session cookie — and turns it into an authoritative Actor. It
// returns (_, false, nil) when no credential is present (anonymous — the optional path continues);
// an errUnauthenticated when one is present but the token is invalid, its subject is not a user id,
// or the user is gone/deactivated; and a raw (non-sentinel) error only on a genuine DB fault (mapped
// to 500). The role comes from the users row, not the token claim, so a token minted before a role
// change or deactivation cannot outrank the current record.
func (s *Server) resolveActor(ctx context.Context, r *http.Request) (Actor, bool, error) {
	// Bearer takes precedence over the cookie: a client sending it (the extension) intends token
	// auth. Either credential is verified with the one Issuer + the role re-read below, so cookie
	// and Bearer are interchangeable admin-realm credentials.
	token := bearerToken(r)
	if token == "" {
		cookie, err := r.Cookie(auth.SessionCookieName)
		if err != nil || cookie.Value == "" {
			return Actor{}, false, nil
		}
		token = cookie.Value
	}
	claims, err := s.auth.Verify(token)
	if err != nil {
		return Actor{}, false, errUnauthenticated
	}
	id, err := uuid.Parse(claims.Subject)
	if err != nil {
		return Actor{}, false, errUnauthenticated
	}
	user, err := s.users.UserByID(ctx, id)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			return Actor{}, false, errUnauthenticated
		}
		return Actor{}, false, err
	}
	if !user.Active {
		return Actor{}, false, errUnauthenticated
	}
	role, err := actorRole(user.Role)
	if err != nil {
		// A user_role the domain layer doesn't accept should be impossible (PG enum is
		// owner|staff); fail closed rather than fabricate an actor.
		return Actor{}, false, errUnauthenticated
	}
	return Actor{ByUser: user.ID.String(), Role: role, At: time.Now().UTC()}, true, nil
}

// resolveCustomer reads the customer session cookie and returns the authenticated customer id. It
// returns (_, false, nil) when no customer cookie is present, and errUnauthenticated when a cookie is
// present but its token is invalid (bad signature/expired — verified with the CUSTOMER issuer's
// secret, so an admin token fails here) or its subject is not a uuid. Unlike resolveActor it does NO
// DB read: the token subject IS the scoping customer id (GetCustomerOrders filters by it, so a since-
// deleted account simply sees an empty list) — one fewer query, and no role/active axis to re-read.
// ponytail: no existence re-check; a deleted customer's token is harmless until it expires (stateless
// JWT, same posture as the admin realm). Add a DB confirm only if hard logout/ban lands.
func (s *Server) resolveCustomer(r *http.Request) (uuid.UUID, bool, error) {
	cookie, err := r.Cookie(auth.CustomerCookieName)
	if err != nil || cookie.Value == "" {
		return uuid.UUID{}, false, nil
	}
	claims, err := s.customerAuth.Verify(cookie.Value)
	if err != nil {
		return uuid.UUID{}, false, errUnauthenticated
	}
	id, err := uuid.Parse(claims.Subject)
	if err != nil {
		return uuid.UUID{}, false, errUnauthenticated
	}
	return id, true, nil
}

// actorRole maps the stored user_role to a domain order.Role. It is explicit (not a raw cast)
// so the mapping can NEVER yield order.RoleSystem — `system` is a server-internal transition
// actor, never a login identity a session may carry.
func actorRole(r sqlc.UserRole) (order.Role, error) {
	switch r {
	case sqlc.UserRoleOwner:
		return order.RoleOwner, nil
	case sqlc.UserRoleStaff:
		return order.RoleStaff, nil
	default:
		return "", errUnauthenticated
	}
}
