package guestidentity

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net"
	"strings"
)

const Version = 1

type Signals struct {
	UserAgent        string `json:"userAgent"`
	ScreenWidth      int    `json:"screenWidth"`
	ScreenHeight     int    `json:"screenHeight"`
	DevicePixelRatio string `json:"devicePixelRatio"`
	Timezone         string `json:"timezone"`
	Language         string `json:"language"`
	Platform         string `json:"platform"`
	TouchPoints      int    `json:"touchPoints"`
}

type Hashes struct {
	Token       []byte
	Fingerprint []byte
	Browser     string
	Device      string
}

func NewToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func Build(secret, wedding, token, ip string, s Signals) Hashes {
	device := strings.Join([]string{
		deviceFamily(s.UserAgent),
		strings.ToLower(strings.TrimSpace(s.Platform)),
		fmt.Sprintf("%dx%d", minmax(s.ScreenWidth, s.ScreenHeight), max(s.ScreenWidth, s.ScreenHeight)),
		strings.TrimSpace(s.DevicePixelRatio),
		strings.ToLower(strings.TrimSpace(s.Timezone)),
		baseLanguage(s.Language),
		fmt.Sprintf("%d", s.TouchPoints),
	}, "|")
	network := networkPrefix(ip)
	fingerprint := device + "|" + network
	return Hashes{
		Token:       digest(secret, wedding, "token", token),
		Fingerprint: digest(secret, wedding, "fingerprint-v1", fingerprint),
		Browser:     browserFamily(s.UserAgent),
		Device:      deviceFamily(s.UserAgent),
	}
}

func digest(secret, wedding, purpose, value string) []byte {
	m := hmac.New(sha256.New, []byte(secret))
	_, _ = m.Write([]byte("wedding-gi|" + wedding + "|" + purpose + "|" + value))
	return m.Sum(nil)
}

func networkPrefix(raw string) string {
	ip := net.ParseIP(strings.TrimSpace(raw))
	if ip == nil {
		return "unknown"
	}
	if v4 := ip.To4(); v4 != nil {
		return fmt.Sprintf("%d.%d.%d.0/24", v4[0], v4[1], v4[2])
	}
	v6 := ip.To16()
	return fmt.Sprintf("%x:%x:%x:%x::/64", v6[0:2], v6[2:4], v6[4:6], v6[6:8])
}

func deviceFamily(ua string) string {
	u := strings.ToLower(ua)
	switch {
	case strings.Contains(u, "iphone"):
		return "iphone"
	case strings.Contains(u, "ipad"):
		return "ipad"
	case strings.Contains(u, "android"):
		return "android"
	case strings.Contains(u, "macintosh"):
		return "mac"
	case strings.Contains(u, "windows"):
		return "windows"
	default:
		return "other"
	}
}

func browserFamily(ua string) string {
	u := strings.ToLower(ua)
	switch {
	case strings.Contains(u, "zalo"):
		return "zalo"
	case strings.Contains(u, "fban") || strings.Contains(u, "fbav"):
		return "messenger"
	case strings.Contains(u, "edg/"):
		return "edge"
	case strings.Contains(u, "chrome/") || strings.Contains(u, "crios/"):
		return "chrome"
	case strings.Contains(u, "safari/"):
		return "safari"
	default:
		return "other"
	}
}

func baseLanguage(v string) string {
	v = strings.ToLower(strings.TrimSpace(v))
	if i := strings.IndexAny(v, "-_"); i >= 0 {
		return v[:i]
	}
	return v
}

func minmax(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
