package httpapi

import (
	"net"
	"net/http"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// rateLimiter is a per-IP token bucket for the public routes (HANDOFF §5
// "rate-limit these"). In-memory is right-sized: one small pod, one wedding.
// ponytail: no LRU — stale entries are swept when the map grows past a soft cap.
type rateLimiter struct {
	mu      sync.Mutex
	perIP   map[string]*ipLimiter
	rps     rate.Limit
	burst   int
	maxIdle time.Duration
}

type ipLimiter struct {
	lim  *rate.Limiter
	seen time.Time
}

func newRateLimiter(rps float64, burst int) *rateLimiter {
	return &rateLimiter{
		perIP:   make(map[string]*ipLimiter),
		rps:     rate.Limit(rps),
		burst:   burst,
		maxIdle: 10 * time.Minute,
	}
}

// clientIP prefers CF-Connecting-IP: the service only ever sits behind the
// Cloudflare Tunnel (HANDOFF §6), and chi's RealIP is deprecated as spoofable.
// Direct (local/dev) traffic falls back to RemoteAddr.
func clientIP(r *http.Request) string {
	if ip := r.Header.Get("CF-Connecting-IP"); ip != "" {
		return ip
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (rl *rateLimiter) allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	if len(rl.perIP) > 10_000 { // sweep instead of evict-per-request
		for k, v := range rl.perIP {
			if now.Sub(v.seen) > rl.maxIdle {
				delete(rl.perIP, k)
			}
		}
	}
	l, ok := rl.perIP[ip]
	if !ok {
		l = &ipLimiter{lim: rate.NewLimiter(rl.rps, rl.burst)}
		rl.perIP[ip] = l
	}
	l.seen = now
	return l.lim.Allow()
}

// middleware 429s past the per-IP budget.
func (rl *rateLimiter) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !rl.allow(clientIP(r)) {
			writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "quá nhiều yêu cầu, thử lại sau")
			return
		}
		next.ServeHTTP(w, r)
	})
}
