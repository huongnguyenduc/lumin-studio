// Package slug derives guest ids from salutation labels (HANDOFF §4): lowercase,
// Vietnamese diacritics stripped, non-alphanumerics collapsed to '-', and an
// incrementing -2/-3… suffix on collision. The slug doubles as the invite token
// in the public link; it is generated ONCE at creation and never changes on
// rename (links already sent must keep working). Guessable by design — accepted
// trade-off for a wedding.
package slug

import (
	"strconv"
	"strings"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

// stripMarks decomposes (NFD) and drops combining marks: "Cô Lan" → "Co Lan".
var stripMarks = transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)

// Make derives the base slug: "Cô Lan & Chú Minh" → "co-lan-chu-minh".
// An empty/all-symbol label yields "khach" so a guest never gets an empty id.
func Make(label string) string {
	s, _, err := transform.String(stripMarks, strings.ToLower(label))
	if err != nil {
		s = strings.ToLower(label) // NFD cannot realistically fail; keep the raw string if it does
	}
	// đ/Đ are letters, not combining marks — NFD leaves them; map explicitly.
	s = strings.ReplaceAll(s, "đ", "d")

	var b strings.Builder
	dash := false
	for _, r := range s {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
			dash = false
		default:
			if !dash && b.Len() > 0 {
				b.WriteByte('-')
				dash = true
			}
		}
	}
	out := strings.TrimSuffix(b.String(), "-")
	if out == "" {
		return "khach"
	}
	return out
}

// Unique returns base, or base-2 / base-3 … until taken() reports free.
func Unique(base string, taken func(string) bool) string {
	if !taken(base) {
		return base
	}
	for n := 2; ; n++ {
		candidate := base + "-" + strconv.Itoa(n)
		if !taken(candidate) {
			return candidate
		}
	}
}
