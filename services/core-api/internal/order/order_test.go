package order

import (
	"encoding/json"
	"errors"
	"testing"
)

// GenesisEvent seeds an order's statusHistory with a from=nil creation record. It validates
// the actor and timestamp like Transition, and ReplayStatus must accept the leading from=nil
// event and reconstruct the entry status.
func TestGenesisEvent(t *testing.T) {
	for _, to := range []Status{PendingConfirm, Paid} {
		ev, err := GenesisEvent(to, TransitionContext{ByUser: "chu-shop", At: validAt})
		if err != nil {
			t.Fatalf("GenesisEvent(%s) unexpected error: %v", to, err)
		}
		if ev.From != nil {
			t.Fatalf("genesis From = %v, want nil (creation has no prior state)", *ev.From)
		}
		if ev.To != to || ev.At != validAt || ev.ByUser != "chu-shop" {
			t.Fatalf("genesis event = %+v", ev)
		}
		got, err := ReplayStatus([]StatusEvent{ev})
		if err != nil {
			t.Fatalf("ReplayStatus([genesis %s]): %v", to, err)
		}
		if got != to {
			t.Fatalf("ReplayStatus = %s, want %s", got, to)
		}
	}
}

func TestGenesisEventValidates(t *testing.T) {
	if _, err := GenesisEvent(PendingConfirm, TransitionContext{ByUser: "  ", At: validAt}); err == nil {
		t.Fatal("empty byUser must be rejected")
	} else if te := new(TransitionError); !errors.As(err, &te) || te.Code != ErrInvalidActor {
		t.Fatalf("err = %v, want INVALID_ACTOR", err)
	}
	if _, err := GenesisEvent(PendingConfirm, TransitionContext{ByUser: "chu", At: "2026-13-99T99:99:99Z"}); err == nil {
		t.Fatal("calendar-impossible timestamp must be rejected")
	} else if te := new(TransitionError); !errors.As(err, &te) || te.Code != ErrInvalidTimestamp {
		t.Fatalf("err = %v, want INVALID_TIMESTAMP", err)
	}
}

// Address serializes to province/ward/street and — structurally — can never carry a district
// key (ADR-017: the district administrative level was abolished).
func TestAddressJSONNoDistrict(t *testing.T) {
	b, err := json.Marshal(Address{Province: "Hà Nội", Ward: "Cửa Nam", Street: "12 Hàng Bài"})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, k := range []string{"province", "ward", "street"} {
		if _, ok := m[k]; !ok {
			t.Fatalf("address missing %q: %s", k, b)
		}
	}
	if _, ok := m["district"]; ok {
		t.Fatalf("address must NOT carry a district key (ADR-017): %s", b)
	}
	if len(m) != 3 {
		t.Fatalf("address has %d keys, want exactly 3 (province/ward/street): %s", len(m), b)
	}
}

func TestPersonalizationJSON(t *testing.T) {
	b, err := json.Marshal(Personalization{Text: "Bống", ZoneID: "base-front"})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(b) != `{"text":"Bống","zoneId":"base-front"}` {
		t.Fatalf("personalization JSON = %s, want camelCase text/zoneId", b)
	}
}
