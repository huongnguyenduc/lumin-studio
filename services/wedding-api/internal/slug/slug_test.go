package slug

import "testing"

func TestMake(t *testing.T) {
	cases := map[string]string{
		"Cô Lan & Chú Minh":  "co-lan-chu-minh", // HANDOFF §4's own example
		"Gia đình Bác Ba":    "gia-dinh-bac-ba", // đ → d
		"Anh Đức":            "anh-duc",         // Đ → d
		"  Bạn  Hươngg!!  ":  "ban-huongg",      // trim + collapse separators
		"Chị Thuỷ (công ty)": "chi-thuy-cong-ty",
		"123":                "123",
		"":                   "khach", // never an empty id
		"!!!":                "khach",
		"ếữợ":                "euo", // stacked VN diacritics fully strip
	}
	for label, want := range cases {
		if got := Make(label); got != want {
			t.Errorf("Make(%q) = %q, want %q", label, got, want)
		}
	}
}

func TestUnique(t *testing.T) {
	used := map[string]bool{"co-lan": true, "co-lan-2": true}
	taken := func(s string) bool { return used[s] }

	if got := Unique("chu-minh", taken); got != "chu-minh" {
		t.Errorf("free base = %q, want chu-minh", got)
	}
	if got := Unique("co-lan", taken); got != "co-lan-3" {
		t.Errorf("collision = %q, want co-lan-3", got)
	}
}
