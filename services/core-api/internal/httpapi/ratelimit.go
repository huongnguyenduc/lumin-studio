package httpapi

import (
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// lookupLimits configures the guest order-lookup limiter (keyed per order code).
type lookupLimits struct {
	rate  rate.Limit    // sustained attempts/second allowed for one code (token refill rate)
	burst int           // bucket size — short bursts (a human retrying + the P1-o auto-poll)
	ttl   time.Duration // idle entries older than this are swept, so the map can't grow unbounded
}

// Defaults sized for a human occasionally checking plus the P1-o auto-poll, while still throttling a
// phone brute-force against a KNOWN code. They are package constants, not env knobs: the concrete
// numbers are coupled to the P1-o poll cadence, which is still an open question (plan §6.6) — baking
// tunable defaults before that consumer exists is premature. A redeploy re-tunes; the single-instance
// home service already accepts that (ADR-009/014). Promote to env knobs in P1-o once the cadence lands.
const (
	defaultLookupRate  = rate.Limit(0.5) // ~30 sustained attempts/min per code
	defaultLookupBurst = 15
	defaultLookupTTL   = 30 * time.Minute
)

func defaultLookupLimits() lookupLimits {
	return lookupLimits{rate: defaultLookupRate, burst: defaultLookupBurst, ttl: defaultLookupTTL}
}

// lookupEntry is the per-code limiter state: a token bucket plus a last-seen stamp for TTL eviction.
type lookupEntry struct {
	lim      *rate.Limiter
	lastSeen time.Time
}

// lookupLimiter is an in-memory, per-order-code token-bucket that throttles the public guest order-
// lookup (conventions §Bảo mật). It is the SECOND layer behind the Cloudflare WAF's per-IP rate limit
// (defense-in-depth). It keys on the order CODE, not the client IP, because the trusted client IP is
// not available in-process this slice (router.go: CF-Connecting-IP is deferred and chi RealIP is
// spoofable). Per-code keying throttles a phone brute-force against a KNOWN order (at 0.5/s the 9-digit
// VN phone space is infeasible to sweep); the WAF stops cross-code IP sweeps.
//
// It deliberately has NO failure-count lockout. A hard lockout keyed on the order code would be a DoS:
// order codes are sequential and guessable (`#LMN-1000,1001,…`), so an attacker could lock a code — and
// because the lock is checked before the phone, the LEGITIMATE owner presenting the correct code+phone
// would be denied their own order tracking (PR-P1-n review, wf_4ef2b511). The token bucket alone already
// makes brute-force infeasible, so the lockout added risk without security; it was dropped.
//
// In-memory fits the single-instance + accept-downtime model (ADR-009/014): a restart resets buckets,
// which an attacker cannot turn into durable gain. A lazy sweep evicts idle entries so probing many
// distinct codes cannot grow the map without bound between sweeps. The clock is injectable (now) so the
// TTL is deterministically testable; production uses time.Now.
type lookupLimiter struct {
	mu        sync.Mutex
	entries   map[string]*lookupEntry
	limits    lookupLimits
	now       func() time.Time
	lastSweep time.Time
}

// newLookupLimiter builds a limiter with the given limits and the real clock.
func newLookupLimiter(l lookupLimits) *lookupLimiter {
	return &lookupLimiter{
		entries: make(map[string]*lookupEntry),
		limits:  l,
		now:     func() time.Time { return time.Now() },
	}
}

// allow reports whether a lookup attempt for code may proceed, consuming one token from the code's
// bucket. It returns false when the bucket is empty (too many recent attempts for this code). It is
// called once per request, BEFORE any DB work, and consumes a token on EVERY call — an unknown code, a
// wrong phone and a legit poll all spend the same, so token cost never distinguishes them.
func (l *lookupLimiter) allow(code string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.sweepLocked(now)
	e := l.entryLocked(code, now)
	e.lastSeen = now
	return e.lim.AllowN(now, 1)
}

// entryLocked returns the entry for code, creating a fresh bucket on first use. Caller holds l.mu.
func (l *lookupLimiter) entryLocked(code string, now time.Time) *lookupEntry {
	e, ok := l.entries[code]
	if !ok {
		e = &lookupEntry{lim: rate.NewLimiter(l.limits.rate, l.limits.burst), lastSeen: now}
		l.entries[code] = e
	}
	return e
}

// sweepLocked evicts entries idle longer than the TTL, at most once per ttl interval so the common
// path stays O(1). Caller holds l.mu.
func (l *lookupLimiter) sweepLocked(now time.Time) {
	if l.limits.ttl <= 0 || now.Sub(l.lastSweep) < l.limits.ttl {
		return
	}
	l.lastSweep = now
	for code, e := range l.entries {
		if now.Sub(e.lastSeen) > l.limits.ttl {
			delete(l.entries, code)
		}
	}
}

// paymentProofUploadLimits configures the public presigned-POST bootstrap limiter.
type paymentProofUploadLimits struct {
	rate  rate.Limit
	burst int
}

const (
	defaultPaymentProofUploadRate  = rate.Limit(0.2) // 12 sustained policies/minute process-wide
	defaultPaymentProofUploadBurst = 12
)

func defaultPaymentProofUploadLimits() paymentProofUploadLimits {
	return paymentProofUploadLimits{rate: defaultPaymentProofUploadRate, burst: defaultPaymentProofUploadBurst}
}

// paymentProofUploadLimiter is intentionally global, not per-IP: core-api still does not have a
// trusted client-IP signal in-process. Cloudflare WAF remains the per-IP sweep layer; this process
// bucket is the local backstop for the unauthenticated signer.
type paymentProofUploadLimiter struct {
	lim *rate.Limiter
	now func() time.Time
}

func newPaymentProofUploadLimiter(l paymentProofUploadLimits) *paymentProofUploadLimiter {
	return &paymentProofUploadLimiter{
		lim: rate.NewLimiter(l.rate, l.burst),
		now: func() time.Time { return time.Now() },
	}
}

func (l *paymentProofUploadLimiter) allow() bool {
	if l == nil {
		return true
	}
	return l.lim.AllowN(l.now(), 1)
}
