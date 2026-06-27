package contract

// Structural smoke gate for openapi.yaml: every internal $ref resolves to a defined
// component, and every operation has a unique operationId. oapi-codegen / openapi-typescript
// (PR-3c-2) will enforce far more, but they do not exist yet — until they land this keeps a
// dangling ref or a duplicate operationId from sitting in the contract unnoticed. Pairs with
// the enum parity tests; both run in `make verify-go`.

import (
	"os"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func loadRawContract(t *testing.T) map[string]any {
	t.Helper()
	data, err := os.ReadFile(openapiPath)
	if err != nil {
		t.Fatalf("read openapi.yaml: %v", err)
	}
	var doc map[string]any
	if err := yaml.Unmarshal(data, &doc); err != nil {
		t.Fatalf("parse openapi.yaml: %v", err)
	}
	return doc
}

func asMap(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

// collectRefs walks the decoded YAML tree gathering every "$ref" string value.
func collectRefs(node any, out *[]string) {
	switch n := node.(type) {
	case map[string]any:
		for k, v := range n {
			if k == "$ref" {
				if s, ok := v.(string); ok {
					*out = append(*out, s)
				}
				continue
			}
			collectRefs(v, out)
		}
	case []any:
		for _, v := range n {
			collectRefs(v, out)
		}
	}
}

func TestContractRefsResolve(t *testing.T) {
	doc := loadRawContract(t)
	components := asMap(doc["components"])
	schemas := asMap(components["schemas"])
	responses := asMap(components["responses"])
	if len(schemas) == 0 {
		t.Fatalf("openapi.yaml: components.schemas is empty")
	}

	var refs []string
	collectRefs(doc, &refs)
	if len(refs) == 0 {
		t.Fatalf("openapi.yaml: no $ref found — the contract is suspiciously flat")
	}

	for _, ref := range refs {
		name := ref[strings.LastIndex(ref, "/")+1:]
		switch {
		case strings.HasPrefix(ref, "#/components/schemas/"):
			if _, ok := schemas[name]; !ok {
				t.Errorf("dangling $ref %q — no such schema (codegen in 3c-2 would fail)", ref)
			}
		case strings.HasPrefix(ref, "#/components/responses/"):
			if _, ok := responses[name]; !ok {
				t.Errorf("dangling $ref %q — no such response", ref)
			}
		default:
			t.Errorf("unexpected $ref shape %q (only intra-document component refs are used)", ref)
		}
	}
}

func TestContractOperationIDsUnique(t *testing.T) {
	doc := loadRawContract(t)
	paths := asMap(doc["paths"])
	if len(paths) < 8 {
		t.Fatalf("openapi.yaml: expected >= 8 paths for the slice-3 surface, got %d", len(paths))
	}

	seen := map[string]string{} // operationId -> "METHOD path"
	httpMethods := map[string]bool{"get": true, "post": true, "put": true, "patch": true, "delete": true}
	for path, item := range paths {
		for method, op := range asMap(item) {
			if !httpMethods[method] {
				continue
			}
			where := strings.ToUpper(method) + " " + path
			opMap := asMap(op)
			id, _ := opMap["operationId"].(string)
			if id == "" {
				t.Errorf("%s: missing operationId (oapi-codegen needs one per operation)", where)
				continue
			}
			if prev, dup := seen[id]; dup {
				t.Errorf("duplicate operationId %q on %s and %s", id, prev, where)
			}
			seen[id] = where
		}
	}
}
