# Active context — focus đang chạy

> **File "đang ở đâu"** (volatile, đổi liên tục). `session-start` echo ~3000 byte đầu khi mở phiên ·
> `pre-compact` ghim làm "plan sống" · `verify-before-stop` nhắc cập nhật khi đổi >1 file source. Giữ phần
> load-bearing (Focus · Next · Ledger) **gần đầu file**. Đây **không** phải nguồn chân lý — chỉ scratchpad phối
> hợp; muốn binding phải thành ADR/luật (`agent-harness.md` §Ranh giới promote memory).

## Focus
**PHASE 0 DONE — cả 5 slice trên `main` (`ab99360`):** compose(#5) · ui(#6) · storefront(#7) · admin(#9) ·
services backbone(#10, squash-merged 2026-06-26 03:28Z). Local `main` đã ff về `ab99360`; nhánh
`feat/phase-0-services-backbone` đã xoá local (remote còn — chưa được duyệt xoá). Còn nợ Phase 0 = **ops (không
code):** GPU gate WSL2 (driver Win + cuda-toolkit + nvidia-container-toolkit + Blender-thấy-GPU) + Dockerfile 2
service (gắn GPU gate) — việc của chủ ở máy nhà, không scaffold được.

**ĐANG CHẠY = Phase "Core · Data model + OrderStatus" (xương sống).** Plan: `docs/plans/core-data-model.md`
(3 slice tuần tự). **Slice 1 = domain spine THUẦN Go, KHÔNG DB → ✅ MERGED (PR #11, `origin/main` `10b31f6`,
2026-06-26 05:01Z, squash).** `services/core-api/internal/order` (state machine port từ `packages/core/
order-state.ts` — edges/RBAC/reason/owner-only/statusHistory/replay/channel-entry) + `internal/money`
(`CalcTotals` server-authoritative; `formatVnd` DEFER tới surface email/OG). Test OSM-01..05 + MNY-01/02 +
property (`testing/quick`); `make verify-go` xanh (**17 test**). ADR-003 (Go re-implement spine server-side;
OpenAPI là hợp đồng TS↔Go). Local `main` đã ff về `10b31f6`; nhánh `feat/core-data-model` đã squash-merged
(còn local + remote, chưa duyệt xoá).

**ĐANG Ở Slice 2 (data layer).** Plan 7 sub-PR `docs/plans/core-data-layer.md` (run wf_0952e60c-e3d). Quyết định
chủ: **golang-migrate** + **defer AssetJob** (ADR-028). **PR-2a (infra) ✅ MERGED #12 → `main` `7441072`.**
**PR-2b (outbox table + tx-insert seam) ✅ MERGED #13 → `main` `861808d`.**
**PR-2c (catalog) ✅ MERGED #14 → `881bc86`. PR-2d (identity: customers/consent_grants/users + reviews FK)
✅ MERGED #15 → `main` `59d4f98`.**
**PR-2e (order spine) ✅ MERGED #16 → `main` `cf31cb2` (2026-06-26 09:39Z, squash; local main ff'd).**
`000005_orders` (orders + order_items) + sqlc overrides (`order_status`/`order_channel`→`order.Status`/`Channel`,
`status_history`→`[]order.StatusEvent`, `shipping_address`→`order.Address`, `personalization`→`*order.Personalization`)
+ 3 tx seams in `internal/db/orders.go`: `CreateOrderTx` (genesis event + items + `order.created`), `ConfirmPaymentTx`
(owner-only reconcile→PAID + `order.paid`), `AdvanceStatusTx` (`FOR UPDATE` lock → `order.Transition` → atomic
flip+append; REFUNDED denormalizes refundProofUrl). Totals via `money.CalcTotals` (no client total). `make verify-go`
green; **integration tests RAN vs real Postgres (colima, not just CI)** incl. a `-race` concurrent-reconcile lock
proof; guard 141 / osm 22. 4-lens adversarial review (wf_ac186d9c): 14→9 confirmed, all fixed (2 IMPORTANT:
empty-items guard + FOR-UPDATE test). **No new deps.**
**PR-2f (fulfillment/asset) ✅ MERGED #17 → `main` `b1b28a0` (2026-06-26, squash; local main ff'd).**
`000006_jobs` (asset_jobs + print_jobs + 2 new enums) + `db/queries/jobs.sql` + `internal/db/jobs.go` (`Jobs` repo +
3rd emit-seam `CreateAssetJobTx` → `asset_job.created`). **D3 resolved (user):** AssetJob shape inferred (no spec
§02 table) → SPLIT `asset_job_type` {model_ingest, sprite_render}; `source_model_url`+`source_version` (content-hash)
reconstructable (ADR-006); outputs→Product (job input-only). **D6 resolved (user):** `print_jobs.stage` STORED (staff
drag-drop, finer than order status, Pet-Tag NFC stage later). print_jobs no emit-seam (admin-internal SSE slice 3).
`make verify-go` green; **9 jobs integration tests RAN vs real Postgres (colima)** + reversibility re-passes; guard
141 / osm 22; **no new deps**.
**PR-2g (config/reference) ✅ MERGED #18 → `main` `ffab5f8` (2026-06-26, squash; local main ff'd).** `000007_settings` (reply_templates + settings singleton [shop_info/bank_account VietQR/
shipping_rules/refund_policy] + `setting_bank_audit`) + `db/queries/settings.sql` + `internal/db/settings.go`
(`Settings` repo + `UpdateBankAccountTx` audit-on-commit seam). **Singleton** = `id boolean PK DEFAULT true CHECK (id)`
+ seed row. **Append-only DB-enforced** = row-level BEFORE UPDATE/DELETE **+** statement-level BEFORE TRUNCATE
triggers both RAISE (not just no-query — TRUNCATE hole caught by review). `setting_bank_audit.seq` (bigserial) =
deterministic newest-first. **refund_policy** per ADR-012 (NOT return_policy); NO e-invoice/tax cols (compliance §5).
vn-compliance loaded. `make verify-go` green; **6 settings integration tests RAN vs real Postgres (colima)** +
reversibility re-passes; guard 141 / osm 22; **no new deps**. **4-lens adversarial review wf_70129d8e: 7 confirmed /
5 refuted, all fixed** (2 IMPORTANT money-out: TRUNCATE-bypass + validate() null/`{}`/`[]`; ordering bound by seq).
**✅ SLICE 2 COMPLETE — all 7 sub-PRs 2a–2g MERGED → `main` `ffab5f8`.** **ĐANG Ở Slice 3 (HTTP/relay) — PLAN +
ADRs LOCKED, chưa code.** Plan `docs/plans/core-http-relay.md` (wf_48252601, 18 agents: 9 readers → 3 design angles →
3-lens judge → synthesis + completeness-critique) reconciled to **13 sub-PRs / 2 tracks**: relay `3a→3b` (NATS
substrate + drain loop) · contract/HTTP `3c-1→3c-2→3d→3e-1→3e-2→{3g,3h,3i,3k}→3j` (+ `3f` intake helpers independent).
**5 ADRs LOCKED in `decisions.md` (user-confirmed 2026-06-26): 029 relay (in-process goroutine · scan-pending-SET ORDER
BY seq, KHÔNG watermark/SKIP-LOCKED/advisory-lock per ADR-009 · publish→PubAck→mark) · 030 auth = SELF-ISSUED JWT
(user chose NOT Cloudflare-Access — `POST /auth/login`+bcrypt+`go-chi/jwtauth` httpOnly cookie · `users.password_hash`
migration 000009 · split 3e-1 login / 3e-2 verify+RBAC) · 031 OpenAPI hand-yaml single-source → oapi-codegen
**strict-server** + openapi-typescript (`packages/api-client`) · 032 error-envelope `{code,messageKey,fields?}` · 033
idempotency DEFERRED.** Migrations (ACTUAL, post-3e-1-landing-first): **000009** user_credentials (3e-1) · **000010**
order_code_seq (3f — plan said 000008 but 3e-1 merged out of plan order taking 000009; a 000008 would be silently
skipped on any DB already migrated to 9, so 3f renumbered to 000010) · **000011** dashboard_idx (3i, shifted).
Adversarial critique earlier caught a money-path BLOCKER (uniformly-public `POST /orders` lets
`channel=inbox` mint a born-PAID order w/o payment → fixed: inbox **staff-gated**) + added `3k` settings/STK endpoint
the data layer deferred to slice-3 RBAC. docs baseline committed `ecd06fa`.
**PR-3a relay substrate ✅ MERGED → PR #19 → `origin/main` `280e94b` (2026-06-27 11:30Z, squash; local `main` ff'd).**
`internal/natsx` (Connect/EnsureTopology/Reachable/Close) + config NATS/relay knobs + `getenvDuration` + main lifecycle
+ `/readyz` NATS check via `NATSStatus` iface; `nats.go` v1.48.0 PINNED (v1.52 forces go 1.25, like pgx). 4-lens review
wf_adea04ba (14→5 confirmed / 0 BLOCKER, all fixed: Docker-free non-fail-fast tests + convergence). guard 142.
**`3b` relay drain loop ✅ MERGED (PR #20) → `origin/main` `c3b2004` (2026-06-27, merge-commit; local `main` ff'd). RELAY TRACK 3a→3b COMPLETE.**
`internal/relay` (drain loop: `SelectPendingOutbox`→publishOne→await PubAck→markPublished; transient-vs-poison split;
panic-recovery; `isTransient` on real nats/jetstream v1.48 sentinels) + 4 outbox sqlc queries (scan pending-SET `ORDER BY
seq`, NO watermark/SKIP-LOCKED) + natsx `+PublishMsg`/`+ReEnsureOnReconnect` (topology-on-reconnect carry-over from the 3a
review) + main.go lifecycle (start relay goroutine, stopRelay cancel+join BEFORE nc.Close/pool.Close on both exit paths).
`make verify-go` green; **9 relay tests RAN vs real PG+NATS (colima, -race)** incl. the **late-low-seq watermark-loss
regression** + dedup-on-republish + no-stream→transient→recover + poison-quarantine; natsx+db no regression. **guard 144
(+2 relay ARM: scan-pending-SET rule lock + relay-start-in-main, both PROVEN binding mutate→RED→restore); osm 22.** REL-01/
REL-02 → `docs/acceptance.md` (EARS-lint pass). **No new deps** (reuse nats.go/pgx/uuid/testcontainers). Adversarial 5-lens
review wf_81c76244 (5 lenses → per-finding refute): **12 raw → 4 confirmed (0 BLOCKER) / 8 refuted, ALL 4 FIXED** — (IMPORTANT)
relay-start ARM grep didn't strip `//` comments → commented-out relay false-PASSED (now strips `//` + loosened `.Run(` so
ctx-rename không false-RED; re-proven: comment-out→RED, rename→GREEN, delete→RED); (NOTE) `time.NewTicker(poll)` panic ngoài
drainOnce recover → non-positive RELAY_POLL_INTERVAL crash cả process → `newRelay` clamp poll/batch/maxAtt≤0→default + test;
(NOTE) panic-recovery 0 coverage → `TestDrainPanicRecovered`; (NOTE) clamp test. guard giữ 144, relay test 9→11.

**`3c-1` OpenAPI contract authoring ✅ MERGED (PR #21) → `origin/main` `f1b35d2` (2026-06-27 23:45Z, squash; local `main` ff'd). (branch `feat/core-http-relay-3c-1` off `c3b2004`.)**
Head of the contract/HTTP track (unblocks 3c-2→3d→3e→{3g,3h,3i,3k}→3j). Hand-authored
`services/core-api/openapi.yaml` (OpenAPI **3.0.3**, slice-3 surfaces ONLY — auth/orders/transitions/dashboard/
settings-STK/reply-templates; NO catalog read DTOs per scope): nested `Order` DTO (not flat sqlc row) +
`CreateWebOrderInput`/`CreateInboxOrderInput` (oneOf+discriminator on `channel`; inputs OMIT unitPrice/total/subtotal
→ server-authoritative, always-must #2) + `TransitionRequest` + `ErrorEnvelope {code,messageKey,fields?}` (ADR-032) +
Settings/BankAccount{bin,accountNumber,accountName}/ReplyTemplate + DashboardSnapshot + cookieAuth securityScheme.
Money `integer,format:int64`; props camelCase. **4-way enum parity test** `internal/contract/parity_test.go` (yaml.v3
indirect→direct): OrderStatus/Channel/Role byte-identical across **OpenAPI == internal/order == packages/core Zod == PG
000001**; encodes the `system` asymmetry explicitly (actor **Role** {owner,staff,system} vs stored **UserRole**/PG
`user_role` {owner,staff}). spec-sync `spec.md §02` Review `text`→`body` (DB/Go already `body`). ADR-031 implemented (no
new ADR — landed `ecd06fa`). `make verify-go` green (golangci 0, sqlc vet+diff, `go test -race` incl parity); **guard
145** (+1 contract ARM: openapi.yaml→parity must reference all 4 sources, PROVEN binding missing→144/1); osm 22;
**parity PROVEN binding** (REFUNDED drift→RED→restore). **No EARS row** (contract-authoring, no runtime invariant).
**Adversarial 4-lens review wf_a95388f8-5d8: 3 confirmed (1 BLOCKER) / 4 refuted, all confirmed FIXED.** BLOCKER
(openapi lens, reviewer RAN oapi-codegen v2.5.1): inline `oneOf`+discriminator on `POST /orders` → oapi-codegen emits
an OPAQUE `union json.RawMessage` w/ unexported field + 0 methods → strict-server can't read the order payload → FIX:
extract into NAMED `CreateOrderInput` schema (+$ref) → **re-ran oapi-codegen: 10 union methods now (As*/From*/Merge*/
Discriminator/ValueByDiscriminator/Marshal/Unmarshal), exit 0**. NOTE optionIds→`format:uuid` (both item schemas).
NOTE contract ARM was presence-only → tightened (≥4 `Test*Parity` + `assertSame` + `order.Statuses`, PROVEN binding:
gamed-stub→144/1). Refuted (sound): trackingCode-→SHIPPING contract is intentional (plan §3h/D12) · Order.createdAt
deliberate superset · regex/literal can't false-pass (fail-safe). guard stays 145.

**`3c-2` codegen + `packages/api-client` scaffolding ✅ MERGED (PR #22) → `origin/main` `d10d30e` (2026-07-01 07:16Z,
squash; local `main` ff'd). CONTRACT/HTTP TRACK HEAD 3c-1→3c-2 COMPLETE.** Wires the contract → BOTH generated clients (ADR-031/§6 D8
strict-server), NO domain endpoints (that's 3d). **GO:** `internal/api/{oapi-codegen.yaml,gen.go}` (pin
`oapi-codegen@v2.5.1` in `//go:generate`) → committed `api.gen.go` (strict-server + chi-server; the named
`CreateOrderInput` union from the 3c-1 BLOCKER stays intact) + dep `github.com/oapi-codegen/runtime v1.1.2`
**PINNED** (v1.4.2 pulls x/crypto→go 1.24; **go directive stays 1.23.6** như pgx/nats) + `.golangci.yml` gen-exclude
(`generated:lax` + `paths: '.*\.gen\.go$'`) + `make verify-go` gains `oapi` target + `go generate ./internal/api/...`
+ `git diff --exit-code` stale-check. **TS:** NEW `@lumin/api-client` (openapi-typescript **7.13.0** → committed
`src/schema.gen.ts` + openapi-fetch **0.13.8** `createApiClient`, cookie-cred default per ADR-030) + DRY stale-gate
`test/schema.stale.test.ts` (regen via the shared `codegen.mjs` render fn → byte-equality) + `**/*.gen.ts`
eslint+prettier-ignore. **HARNESS:** guard oapi ARM (verify-go recipe PHẢI chứa CẢ `go generate …internal/api` VÀ
`git diff --exit-code…internal/api`; comment-strip nên verb bị `#`-comment không false-pass) **145→146**; D13
`docs/plan.md` acceptance-ledger checkbox ✅ ticked (parser pre-existed+passes+armed; Go REL-01/02 GIỮ `[ ]` cố ý —
parser chỉ resolve id TS). `make verify-go` rc=0 · `pnpm verify` rc=0 · guard **146** · osm 22; **cả 3 gate mới PROVEN
binding** (mutate→RED→restore). **Deps:** +oapi-codegen/runtime v1.1.2 +apapsch/go-jsonmerge/v2 (Go) +openapi-typescript
+openapi-fetch (TS). **4-lens review wf_58d3da06: 2 confirmed (0 BLOCKER · both NOTE) / 0 refuted, BOTH FIXED** —
(NOTE) guard ARM grep unanchored → `#`-commented verb false-passed (cùng class lỗ `//` của 3b) → strip comment lines
(hardened sibling sqlc ARM luôn), re-proven comment-out→RED; (NOTE) oapi-codegen.yaml comment mis-attached to no-op
`skip-prune` → moved rationale into `generate:` block + dropped the line. (1 review lens stalled/no-report — its
territory self-verified: go 1.23 preserved, golangci 0, CI go-1.23+network compatible.)

**`3d` HTTP foundation ✅ MERGED (PR #23) → `origin/main` `eac9b0f` (2026-07-01 09:29Z, squash; local `main` ff'd).
CONTRACT/HTTP TRACK 3c-1→3c-2→3d COMPLETE (keystone landed).** (branch `feat/core-http-relay-3d` off `main` `d10d30e`, now merged/stale.) The keystone the whole HTTP track funnels through (unblocks 3e→{3g,3h,3i,3k}→3j). Chose
**strict-server** wiring (ADR-031 D8): `internal/httpapi/{errors.go,server.go,stubs.go}` + rewired `router.go`. **errors.go**
= the ONE domain-error→(status,`api.ErrorEnvelope{code,messageKey,fields?}`) table (ADR-032): `*order.TransitionError`
reuses its code verbatim (INVALID_EDGE→409·RBAC→403·REASON/REFUND/PROOF_REQUIRED→422·INVALID_ACTOR/TIMESTAMP→400·unknown→422)
+ `db.Err*`/`money.ErrInvalidAmount`→404/422 + unmapped→500; `msgKey(code)="errors."+code` (code↔key can't drift; frontend
owns `errors` namespace, added 3j+). Two strict hooks REPLACE the oapi-codegen plaintext defaults (`http.Error(w,err.Error())`
would leak the Vietnamese `TransitionError.Message` — always-must #3): `handleResponseError` (maps domain err → envelope; logs
only genuine 500s server-side, NEVER forwards err.Error()) + `handleRequestError` (bind/decode fail → 400 VALIDATION, no raw
parser echo). **server.go** = `Server{logger,pool,nats}` (implements `api.StrictServerInterface`; `queries`/`authVerifier`
DEFERRED to 3g/3e to keep staticcheck unused-field clean) + `(*Server).readiness` method (moved from router free-func) +
`withTx(ctx,txBeginner,fn)` (Begin→fn→Commit, rollback on err/panic; `txBeginner` iface = Docker-free unit-testable, `*pgxpool.Pool`
satisfies). **stubs.go** = 8 not-implemented handlers (→501 NOT_IMPLEMENTED envelope) replaced per-endpoint by 3e–3k. **router.go**:
`NewStrictHandlerWithOptions(srv,nil,{Request/ResponseErrorHandlerFunc})` + **`HandlerWithOptions` w/ `ChiServerOptions.ErrorHandlerFunc`**
(nil StrictMiddlewareFunc slice = the auth-boundary seam 3e-2 fills). `NewRouter(logger,pool,nats)` signature UNCHANGED (existing readyz
tests stay green). **HARNESS:** guard **147** (+1 error-envelope ARM: errors.go landed → router must wire BOTH error seams
[strict `ResponseErrorHandlerFunc` + chi `ChiServerOptions`] + mapError must map TransitionError; PROVEN binding — rename-token→RED,
comment-out→RED, restore→green) + **fixed the pre-existing NATS-readiness ARM** (it pinned `router.go` but readiness moved to `server.go`
→ widened to grep httpapi prod files, `--exclude=*_test.go` + strip comments). **ERR-01** → `docs/acceptance.md` (Go-gated `[ ]`).
`make verify-go` rc=0 (golangci 0, sqlc vet+diff, oapi stale-check, `go test -race` incl httpapi) · guard **147** · osm 22 · TS
acceptance-ledger 17/17 (acceptance.md consumed) · Docker-free (no DB/NATS test). **No new deps · no new ADR** (implements ADR-032).
~300 lines non-test src (< 400 budget).
**5-lens adversarial review wf_f3cb8fbd: 10 raw → 5 confirmed / 5 refuted, ALL FIXED.** (IMPORTANT ×2, same defect two lenses)
`api.HandlerFromMux` left the CHI-wrapper `ErrorHandlerFunc` at oapi-codegen's plaintext default → `POST /orders/{non-uuid}/transitions`
returned `text/plain` `Invalid format for parameter id: …` (echo input + broke the ADR-032 JSON contract; param-binding fires BEFORE the
strict layer) → switched to `HandlerWithOptions` w/ `ChiServerOptions.ErrorHandlerFunc: srv.handleRequestError` + `TestBadPathParamReturns400Validation`
(proven backstop: revert→RED) + ARM now requires `ChiServerOptions`. (BLOCKER ×2, same, self-inflicted) the `ERR-01` row wrapped
`the system shall` onto line 2 → REC-18 EARS-lint is line-oriented → guard went 146/1 RED (I'd run guard BEFORE adding the row) → reflowed
onto one physical line. (NOTE) NATS ARM dir-grep could match tests/comments → hardened. Refuted (sound): ARM over-claim (param path never
carries the Vietnamese message), 501-not-in-contract (deliberate stubs), route-group-not-established (plan-sanctioned strict-server + auth
seam to 3e-2), 2× ARM-presence-only (backstopped by the real Go tests).

**`3e-1` auth self-issued login ✅ BUILT · verify green · 5-lens review DONE (4→3 confirmed/1 refuted, ALL FIXED) · chờ push→PR.
(branch `feat/core-http-relay-3e-1` off `main` `eac9b0f`.)** The critical-path head after 3d; unblocks 3e-2 (verify+RBAC) → the
whole handler fan-out. ADR-030 self-issued JWT. **User sub-decisions (AskUserQuestion): owner-seed = `make seed-owner` CLI
(pure-DDL migration, NO committed secret); token = 12h JWT, NO refresh.** Landed: migration **`000009_user_credentials`**
(`ALTER TABLE users ADD COLUMN password_hash text` NULLABLE — a credential-less user can't log in) + `UpsertOwnerCredential`
upsert-on-email (idempotent rotate) · **`internal/auth`** (`Issuer` HS256 via `go-chi/jwtauth/v5`; `Issue`→httpOnly+Secure+
SameSite=**Strict** cookie, token-in-cookie-only; `Clear`; `VerifyPassword` bcrypt **timing-equalized** w/ a dummy-hash compare
on the nil/unknown path → no user-enumeration; `HashPassword`) · **`internal/httpapi/auth.go`** `LoginUser`/`LogoutUser`
(lookup→bcrypt→mint; uniform 401 for unknown-email==wrong-password; 500-on-DB-fault no-leak) using the generated
`LoginUser200JSONResponse{Body,Headers.SetCookie}` (openapi Set-Cookie header now formal) · `cmd/seed-owner` + Makefile target ·
config `JWT_SECRET`/`JWT_TTL`(12h)/`COOKIE_SECURE`(true)/`ALLOW_DEV_JWT_SECRET` + **`UsesForgeableJWTSecret()` → main.go
FAIL-FAST** when the public dev secret would sign tokens without opt-in (money-out: forgeable owner → reconcile→PAID/STK). `users`
`SELECT *` auto-picks `password_hash` (sqlc `*string`). **Server** gained `auth *auth.Issuer` + `users userReader` seam
(Docker-free login unit tests via injected fake); `NewServer`/`NewRouter` +1 param (readyz tests pass nil). `make verify-go` rc=0
(golangci 0, sqlc vet+diff, oapi+sqlc regen committed, `go test -race`) · **guard 148** (+1 auth ARM PROVEN binding ×3: HttpOnly ·
bcrypt.CompareHashAndPassword · login VerifyPassword(nil) — each mutate→RED→restore) · TS api-client typecheck+stale-gate+lint green
(schema.gen.ts regen for Set-Cookie) · acceptance **Cụm 6 AUTH-01/02** (Go-gated `[ ]`) · docs/operations.md §4b (seed + env). **Deps:
+go-chi/jwtauth/v5 v5.4.0 (+lestrrat jwx/v3 tree), x/crypto v0.37→v0.38 indirect→DIRECT; go directive HELD 1.23.6.** **No new ADR**
(implements ADR-030). **5-lens adversarial review wf_eab30b50: 4 raw → 3 confirmed (0 BLOCKER, all IMPORTANT) / 1 refuted (README
out-of-scope), ALL FIXED** — (security) dev-secret Warn insufficient → FAIL-FAST + `ALLOW_DEV_JWT_SECRET` opt-in + `UsesForgeableJWTSecret`
predicate + config tests; (contract) openapi didn't formally declare Set-Cookie header → added `headers:` (regen'd api.gen.go typed
`Headers.SetCookie`, handler now consumes it, custom cookie-response types deleted) + TS schema regen; (spec-adr) operations.md
missing seed-owner docs → §4b. ~430 lines non-test src (auth is invariant-dense; plan budgeted 320, soft ≤400 — cohesive 1-axis).

> Lịch sử app-shell/backbone Phase-0 (storefront/admin/services scaffold) đã archive — xem `git log` + PR #5–#10.

**`3e-1` auth self-issued login ✅ MERGED (PR #24) → `origin/main` `0f665c4` (2026-07-01 15:33Z, squash; local `main` ff'd,
branch deleted).** Contract/HTTP track head 3c-1→3c-2→3d→3e-1 COMPLETE (auth ISSUE side landed).

**`3e-2` auth: JWT-verify middleware + RBAC + actor injection ✅ MERGED (PR #25) → `origin/main` `a442757` (2026-07-01,
squash; local `main` ff'd, branch deleted).** Fills the `StrictMiddlewareFunc` auth seam 3d left (`nil`
slice → now `[]api.StrictMiddlewareFunc{srv.authMiddleware}`); unblocks the whole handler fan-out {3g/3h/3i/3k→3j}. **One
strict-server middleware** branches on the generated operationID (`classify`): **fail-closed default** (unlisted op →
`authRequired`) · `authPublic` {LoginUser,LogoutUser} · `authOptional` {CreateOrder} (resolve iff cookie present, never
reject when absent — the web-create path; §3g still gates channel=inbox) · `authOwnerOnly` {UpdateBankAccount} = the
`requireOwner` STK edge. **`resolveActor`** verifies the cookie via new **`auth.Verify`** (HS256 sig + exp/nbf via
`jwtauth.VerifyToken`, returns `Claims{sub,role}`) → `uuid.Parse(sub)` → **`Identity.UserByID`** (new `GetUserByID` sqlc +
method; NO migration — users table exists) → **role from the DB row, NOT the token claim** (stale token can't outrank a
role change / deactivation; `!Active`→401) → `actorRole` maps user_role→`order.Role` **explicitly so it can NEVER yield
`system`** (server-internal actor, never a login identity). Injects `Actor{ByUser=users.id string, Role, At=server-clock}`
into ctx via unexported key (`actor.go`) — standardizes `statusHistory.byUser` on users.id string. **Does NOT re-implement
RBAC math** — domain guard (`order.RoleAllowed`/`Transition`) stays source of truth; mw only authenticates + gates the
owner-only settings edge. errors.go +`errUnauthenticated`→401 `UNAUTHORIZED` / +`errForbidden`→403 `FORBIDDEN` (+code
`FORBIDDEN`); DB-fault on lookup → raw err → 500 no-leak. Fixed pre-existing `TestDomainRouteReturns501Envelope` (dashboard
now gated → authenticate first via new `testAuthedRouter`). **`make verify-go` rc=0** (golangci 0, sqlc vet+diff, oapi
stale-check clean [no openapi change], `go test -race`) · **guard 149** (+1 auth-boundary ARM PROVEN binding: router wire
`StrictMiddlewareFunc{srv.authMiddleware}` non-nil + `auth.Verify` + `UserByID`; nil-wire→148/1→restore→149) · osm 22 ·
core ledger 43/43 (RBA-01 stays `[ ]` Go-gated). **RBA-01** → acceptance Cụm 7. **No new deps · no new ADR** (implements
ADR-030/032). ~190 non-test src. Docker-free unit + wire tests (nil pool); UserByID integration folded into
`TestUserRoundTrip` (skip-local/run-CI). **spec-guardian PASS: 0 BLOCKER/0 WARN/1 NOTE** (optional path 401s on a
present-but-BROKEN cookie vs treating anonymous — deliberate: `lumin_session` is admin-only SameSite=Strict, web customer
never carries it; locked by `TestAuthMiddlewareOptionalRejectsInvalidCookie`).

**`3e-2` auth boundary ✅ MERGED (PR #25) → `origin/main` `a442757` (2026-07-01, squash; local `main` ff'd).**
**`3f` order-intake prereqs ✅ MERGED (PR #26) → `origin/main` `7ab0159` (2026-07-02, squash; local `main` ff'd).**
`internal/pricing` (server-authoritative `PriceItem`/`ShippingFee`) + by-id catalog sqlc + customer find-or-create +
migration **`000010_order_code_seq`** (note: 3f's code-seq took **000010**, not the plan's 000008 — monotonic numbering
above main per memory; 3i dashboard_idx → next free number). Acceptance Cụm 8 `PRC-01/02`. **→ handler fan-out unblocked.**

**`3h` transition endpoints ✅ MERGED (PR #27) → `origin/main` `5fad85a` (2026-07-02, squash; local `main` ff'd).**
`POST /orders/{id}/transitions` — the RBAC-gated status-change endpoint.
`internal/httpapi/transition.go` (`TransitionOrder` handler) + `dto.go` (shared nested-Order assembler `toOrderDTO`/
`assembleOrderDTO`, reused by 3g) + `internal/db` `SetTrackingCodeTx` seam (+ `SetTrackingCode` sqlc query, **no migration** —
`orders.tracking_code` exists since 000005) + errors.go `errTrackingCodeRequired`→**422 `TRACKING_CODE_REQUIRED`**.
**Dispatch footgun (locked #9):** `to=PAID` → `ConfirmPaymentTx` (only `order.paid` emitter); every other edge →
`AdvanceStatusTx`. **Money-in owner-gate at the BOUNDARY:** `ConfirmPaymentTx` hardcodes `role=owner` so the domain guard
can't reject staff on reconcile → handler rejects `staff`+`to=PAID` with 403 *before* the tx (money-OUT →REFUNDED stays
gated by the domain guard via the actor's real role through AdvanceStatusTx). **SHIPPING:** requires non-empty
`trackingCode` (422 if missing) + `SetTrackingCodeTx` in the **same tx** as the flip (atomic — never SHIPPING w/o code;
QC-photo half deferred, §0). Actor (Role/ByUser/At) from ctx + server clock, never the body. Removed the `TransitionOrder`
501 stub. **guard 150→151** (+1 transition ARM PROVEN binding: `ConfirmPaymentTx` + `order.RoleOwner` + `SetTrackingCodeTx`
in transition.go). **acceptance Cụm 9 `PAY-01`/`SHP-01`** (Go-gated `[ ]`). **No new deps · no new ADR** (impl locked #9/§6 D12).
Tests: 6 Docker-free (staff-reconcile-403 · shipping-tracking-422 · missing-actor-401 · nil-body-400 · `toOrderDTO` full +
empty-optionals + malformed-ts) + 2 httpapi integration (PENDING→PAID→PRINTING→SHIPPING walk: exactly-one-order.paid + no
paid on non-money edges + tracking persist atomic + DTO assembly; invalid-edge→409/missing→404 envelope) + 1 db
`TestSetTrackingCode` — **integration RAN vs real PG (colima), all green**.

**AUTH BOUNDARY COMPLETE → handler fan-out unblocked {3g/3h/3i/3k→3j}.**

**`3g` checkout `POST /orders` ✅ BUILT (`df16b83` build + `4a3ff8f` review-fixes, branch `feat/core-http-relay-3g` off
`main` `5fad85a`) · post-build multi-lens review DONE · fixes applied · verify+integration(colima) green · guard 152 ·
spec-guardian PASS · **PR #28 OPEN · CI green (app-gates/selftest/services-gates) · chờ user merge-gate.**** `internal/httpapi/
checkout.go` CreateOrder strict handler behind optional-auth: ONE handler/mount branch on resolved actor (D2) · **inbox
staff-gate** (channel=inbox mints born-PAID → 403 unless actor — critique BLOCKER/CHK-05) · web CHK-04 `paymentProofUrl`
http(s)+host at boundary · ADR-012 ack+echo · **ADR-019 loud-reject** client unitPrice/subtotal/total/shippingFee → 400 ·
money via `pricing.PriceItem`+`ShippingFee`+`CalcTotals` · one tx FindOrCreateCustomer + GrantConsentIfAbsent (PDPL
order_fulfillment only) + NextOrderCode + `CreateOrderTx` (genesis + `order.created` publish-on-commit) · guest genesis
`ByUser="customer"`. **Post-build review `wf_4364e692-084` (6 money-path lenses × per-finding refute, 17 agents): 11 raw
→ 8 confirmed (ALL NOTE) / 0 BLOCKER / 0 IMPORTANT / 1 uncertain / 2 refuted — money authority + inbox-gate + PDPL +
tx-outbox atomicity ALL held.** Fixes (4 files): (①) `clientMoneyFields` now **case-folds** (`isMoneyKey`+`EqualFold`) —
`{"Total":…}`/`{"Items":[{"UnitPrice":…}]}` bypassed the exact-case reject (NO money impact — input DTO has no price
field, server re-prices — but fail-loud was weaker than doc'd) + regression test; (#6) `assembleOrderDTO` → free func
taking `sqlc.DBTX`; checkout assembles DTO **inside the write tx** so a post-write read failure rolls back instead of
committing an order the client is told failed (dup-on-retry, idempotency deferred §6 D5); 3h keeps post-commit `s.pool`
(unchanged); (#8) missing settings singleton → **logged 500** not unlogged client 404 (`%v` breaks ErrNotFound chain);
(#7 doc) `validate()` email `@`-check unreached (openapi_types.Email validates at decode → `fields:{body}`) — kept as
deliberate defense-in-depth per the existing test, doc made honest; (#3 doc) inbox no-actor stays **403** (acceptance
CHK-05 locks it — RBAC framing, POST /orders public for web) + reconciling comment vs actor.go generic "ok=false ⇒
unauth". No-action: #2 authOptional-401-on-broken-cookie (3e-2 already-adjudicated) · #5 policy_version-refresh (deferred
in-code) · #4 consent-clean · uncertain inbox-emits-`order.created`-not-`order.paid` (spec'd CHK-05, by-design).
`make verify-go` rc=0 (golangci 0, sqlc vet+diff, oapi stale-check clean [no openapi change], `go test -race`) ·
**integration RAN vs real Postgres (colima, -race):** web-end-to-end (assemble-in-tx path) · inbox-staff-born-PAID · 7
pricing rejections · transition walk (3h path unregressed) · guard **152** (3g ARM intact) · scratch verifier files
deleted. **No new deps · no new ADR** (implements ADR-019/017/012/030). **spec-guardian PASS: 0 BLOCKER / 0 WARN / 1 NOTE**
(3h transition.go:92 keeps post-commit `s.pool` assembly — out-of-scope, deliberate, lower-risk [no new row → no
dup-order hazard]; spec-guardian confirmed assemble-in-tx STRICTLY reduces the ADR-033 dup surface w/o weakening ADR-006:
the `order.created` outbox INSERT rolls back with the order). CHK-04/05 acceptance Cụm 10 `[ ]` (Go-gated).

**`3f` order-intake prerequisites ✅ BUILT · verify+integration(colima) green · spec-guardian PASS (renumber WARN fixed) ·
chờ push→PR. (branch `feat/core-http-relay-3f` off `main` `a442757`.)** Server-authoritative money building blocks feeding
the 3g checkout handler; NO HTTP layer. **`internal/pricing`** (NEW pkg): `PriceItem` derives per-line UnitPrice from
catalog (`product.BasePrice` + `color.PriceDelta` + Σ `option.PriceDelta`) — `Selection` input carries NO client price
(structurally can't trust a client total, ADR-019); validates color membership+`available`, option membership, duplicate
options, engrave text ≤ `option.MaxChars` (rune-counted, spec §05); overflow-checked. `ShippingFee` resolves fee from
`settings.shipping_rules` jsonb by province (exact or `"*"` wildcard, NO district ADR-017) → `ErrNoShippingRule`(→422 in 3g)
when none match, never silently 0. **db:** `GetProductByID`+`Catalog.ProductByID` (by-id intake read) · `NextOrderCode`
seam (`#LMN-%04d` via **`nextval('order_code_seq')`** minted in-tx, collision-free §6 D9) · `Identity.FindOrCreateCustomer`
(find-by-phone|insert; documented find-then-insert race = dup-customer not money-error) · `GrantConsentIfAbsent` (idempotent
PDPL consent via `ON CONFLICT` on the active partial-unique index — append-then-mark preserved). **Migration `000010`**
`order_code_seq` (`CREATE SEQUENCE START WITH 1000`). **spec-guardian WARN FIXED:** plan said 000008 but 3e-1 merged first
taking 000009 → a 000008 would be silently skipped by golang-migrate on an already-migrated DB → **renumbered 000008→000010**
(3i dashboard_idx shifts 000010→000011; plan.md updated). `make verify-go` rc=0 (golangci 0, sqlc vet+diff [+3 new queries
regen], oapi stale-check clean [no openapi change], `go test -race`) · **guard 150** (+1 order-intake ARM PROVEN binding ×3:
PriceItem derives BasePrice+PriceDelta · Selection has no client price field · NextOrderCode uses nextval — each
mutate→149/1→restore) · osm 22 · **integration tests RAN vs real Postgres (colima, -race):** ProductByID · NextOrderCode
(monotonic+unique+#LMN-1000) · FindOrCreateCustomer (idempotent by phone) · GrantConsentIfAbsent (idempotent) + reversibility
re-passes with the renamed migration · pricing unit+property Docker-free. **PRC-01/PRC-02** → acceptance Cụm 8 (Go-gated `[ ]`).
**~290 non-test src (< 450 budget → single PR, no 3f-1/3f-2 split). No new deps · no new ADR** (implements ADR-019/017; §6 D9/D10).
**spec-guardian PASS: 0 BLOCKER / 1 WARN (renumber, FIXED) / 1 NOTE** (find-or-create race, disclosed+accepted). **Contract-doc
drift left for user:** `decisions.md` ADR-033 still says "migration 000008" (non-normative aside; hard-blocked file → not
edited unilaterally; flag in PR).

## Next steps (1–3)
1. **Slice 3 · PR-3g — ✅ PR #28 OPEN · CI green · awaiting user merge-gate.** BUILT + reviewed + verified + landed (see
   Focus). Flagged in PR: `decisions.md` ADR-033 "migration 000008" aside still stale (hard-blocked file, not edited
   unilaterally). After merge: ff local `main`, prune `feat/core-http-relay-3g`.
2. **Then remaining fan-out (parallel-safe):** **`3i` dashboard aggregates** (→ migration **000011**_dashboard_idx, since 3f
   took 000010; Asia/Ho_Chi_Minh "today" boundary; net-revenue formula) · **`3k` settings/STK** (owner-only, audit seam) →
   **`3j`** admin dashboard frontend (needs 3i; the a11y/i18n/visual-fidelity axis). Full DAG: `core-http-relay.md §1`.
3. **Housekeeping:** prune now-merged local branches `feat/core-http-relay`(3a)/`-3b`/`-3c-1`/`-3c-2`/`-3d`/`-3f`/`-3h` +
   older `feat/core-data-layer-2e/2f/2g`/`feat/core-data-model`/`feat/phase-0-*` when chủ duyệt (all squash-merged → won't
   show under `git branch --merged`; verify by PR#, not sha). Harness follow-ups: the **testcontainers ARM** greps Go
   `_test.go` for `postgres.Run` unanchored → a `//`-commented boot call could false-pass (same comment-out class fixed for
   recipe ARMs); **decisions.md ADR-033 "migration 000008" aside now stale** (3f took 000010) — fix in a harness/doc round
   (hard-blocked file). Sau Core phase: ADR-026 lane B/C/D · REC-20/28/39.

## Open questions
- *(không có cho slice backbone — scope đã chốt "backbone only" với user; ADR đã khoá quyết định.)*

## Task ledger (git-anchored — B3 / ADR-025)
> **Convention:** sau `/compact` hay sang phiên mới, **tin ledger + `git log` hơn trí nhớ** — đừng re-dispatch
> task `done`. Task chỉ `done` khi code chạy + test xanh. Cột commit ghi `<base7>..<head7>`.

| Task | Trạng thái | Commits | Review |
|---|---|---|---|
| Harness audit r2/r3 + ADR-027 (workflow giao-PR) | done | PR #1/#2 (main=f751a41) | guard.test 138 / osm 11 |
| **Phase 0 — backbone (tokens + core + arm gates)** | **done (PR #4 open)** | `feat/phase-0-backbone` `eef1755` | verify rc=0 · guard 139 · osm 22 |
| **Phase 0 — fix ultrareview PR #4 (A/B/C/D, 25 finding)** | **done (PR #4)** | `feat/phase-0-backbone` (+1 commit) | verify rc=0 · 43 test · guard 139 · osm 22 |
| **Phase 0 — compose skeleton** | **merged (PR #5)** | `origin/main` `30c5652` | `docker compose config -q` OK · verify rc=0 |
| **Phase 0 — `packages/ui` 13 primitives + token-coverage gate** | **merged (PR #6)** | `origin/main` `296c44a` | verify rc=0 · ui 105 / tokens 9 / core 37 · guard 139 · osm 22 · spec-guardian + /review: 2+2 a11y fixed |
| **Phase 0 — app shell 1/2: storefront (Next+next-intl+fonts+Tailwind)** | **merged → main** | PR #7 squash → `origin/main` `b77acb7` | `next build` ✓ · verify rc=0 · storefront i18n test + ui 105/tokens 9/core 37 · guard 139 · osm 22 · spec-guardian PASS (0/0/2) |
| **Phase 0 — app shell 2/2: admin (sidebar+dashboard, reuse infra)** | **merged → main** | PR #9 squash → `origin/main` `bf1b7a5` (re-land of #8) | Next 15 + Hanken Grotesk · `next build` ✓ · verify rc=0 · admin i18n test · guard 139 · osm 22 · spec-guardian PASS (0/0/2) · status-Badge map = 7 ORDER_STATUSES |
| **Phase 0 — services backbone (Go core-api + Rust asset-worker scaffold + arm gates)** | **merged (PR #10)** | squash → `origin/main` `ab99360` | make verify-go ✓ (golangci v2.12.2 + `go test -race`) · make verify-rs ✓ · ARM-GUARD .go→verify-go+.rs→verify-rs ✓ · guard 139 · osm 22 · 4-lens review 0 BLOCKER |
| **Core slice 1 — Go domain spine (OrderStatus state machine + money, no DB)** | **merged (PR #11)** | squash → `origin/main` `10b31f6` (2026-06-26 05:01Z) | `make verify-go` ✓ (gofmt+vet+golangci v2+`go test -race`, **17 test**) · 5-lens review wf_3ccae648: 0 BLOCKER · 2 fix proven binding (money overflow-guard + impossible-date test, mutate-run-restore) · 3 NOTE doc'd (Go server intentionally stricter on malformed ts/url) · guard 139 · osm 22 · spec-guardian PASS |
| **Core slice 2 — data layer** | planned (7 sub-PR) | plan `docs/plans/core-data-layer.md` (wf_0952e60c-e3d) | critique: 1 blocker fixed (sqlc up-only glob) + 4 important folded; user chose golang-migrate + defer AssetJob (ADR-028) |
| **Core slice 2 · PR-2a — data-layer infra (migrate + sqlc + pgx pool + gate arming)** | **merged (PR #12)** | squash → `origin/main` `7441072` | `make verify-go` ✓ (gofmt+vet+golangci 0+**sqlc vet+sqlc diff** no-DB+`go test -race`) · guard.test.sh **141** (sqlc ARM-GUARD proven binding mutate→RED) · osm 22 · ADR-028 · pgx v5.7.5/go 1.23/sqlc v1.30.0 · 3-lens review: spec-guardian PASS (0/0/1 NOTE→`extension` doc'd) + Go-correctness SOUND + harness-gate SOUND. Defer→2b: testcontainers + reversibility test (no local Docker) |
| **Core slice 2 · PR-2b — outbox table + tx-insert seam (dual-write spine)** | **merged (PR #13)** | squash → `origin/main` `861808d` | `make verify-go` ✓ (sqlc vet validates `InsertOutbox`; integration tests RAN in CI — services-gates 1m38s); guard **141** (testcontainers real-check ACTIVE → `postgres.Run`) · osm 22 · `EnqueueOutbox(pgx.Tx,…)` tx-first-arg dual-write guard ADR-006 · deps +google/uuid v1.6.0 (runtime) +testcontainers v0.34.0 (test); in-test SQL applier (no golang-migrate dep). Relay→slice 3 · 3-lens review PASS (1 test-isolation fix) |
| **Core slice 2 · PR-2c — catalog (categories/products/colors/options/reviews)** | **merged (PR #14)** | squash → `origin/main` `881bc86` | `make verify-go` ✓ (services-gates 1m16s CI); guard 141 · osm 22 · material TEXT+CHECK; money int8 CHECK≥0; nullable reviews.customer_id→pgtype.UUID (FK in 000004); thin `Catalog` repo; **no new deps**; EARS deferred · 2-lens review PASS/SOUND |
| **Core slice 2 · PR-2d — identity (customers/consent_grants/users + reviews FK)** | **merged (PR #15)** | squash → `origin/main` `59d4f98` | `make verify-go` ✓ (sqlc vet 8 queries; consent append-then-mark + no-district + user-role-no-system tests via testcontainers skip-local/run-CI) · guard 141 · osm 22 · consent partial-UNIQUE active; addresses jsonb NO district (ADR-017); ON DELETE SET NULL reviews FK (PDPL erase); thin `Identity` repo; vn-compliance loaded; **no new deps** |
| **Core slice 2 · PR-2e — order spine (orders/order_items + 3 tx seams)** | **merged (PR #16)** | squash → `origin/main` `cf31cb2` | `make verify-go` ✓ (golangci 0, sqlc vet+diff clean, `go test -race`); **integration tests RAN vs real Postgres (colima)** — 12 order tests incl. `-race` concurrent-reconcile FOR-UPDATE proof, jsonb/enum overrides, outbox atomicity, refund-proof consistency, RBAC, money CHECK · guard 141 · osm 22 · 4-lens review wf_ac186d9c: 14→9 confirmed all fixed (2 IMPORTANT: empty-items guard `ErrNoItems` + concurrent-lock test) · **no new deps** |
| **Core slice 2 · PR-2f — fulfillment/asset (asset_jobs + print_jobs + 3rd emit-seam)** | **merged (PR #17)** | squash → `origin/main` `b1b28a0` | `make verify-go` ✓ (golangci 0, sqlc vet+diff clean, `go test -race`); **9 jobs integration tests RAN vs real Postgres (colima)** — asset_job.created emit + payload pointer, rollback-atomicity, dup-id reject, both job-types, lifecycle mark, print-queue round-trip + stage advance, ON DELETE CASCADE; reversibility re-passes (000006 down drops 2 new enums) · guard 141 · osm 22 · D3 split asset_job_type{model_ingest,sprite_render}/outputs→Product · D6 print stage STORED · **no new deps** |
| **Core slice 2 · PR-2g — config/reference (settings singleton + reply_templates + append-only bank audit)** | **merged (PR #18)** | squash → `origin/main` `ffab5f8` | `make verify-go` ✓ (golangci 0, sqlc vet+diff clean, `go test -race`); **6 settings integration tests RAN vs real Postgres (colima)** — singleton guard, audit seam atomic+rollback+accumulate, **append-only UPDATE+DELETE+TRUNCATE blocked**, validate() rejects null/`{}`/`[]`, seq newest-first + nil-reason→NULL, reply-template round-trip; reversibility re-passes (000007 down drops 2 tables + trigger fn, no new enums) · guard 141 · osm 22 · **closes slice 2** · 5-lens review wf_70129d8e 7 confirmed/5 refuted all fixed (TRUNCATE-bypass + validate hole) · **no new deps** |
| **Core slice 3 — HTTP + relay (plan + ADR-029..033 locked)** | done (plan) | `feat/core-http-relay` `ecd06fa` | 13 sub-PRs / 2 tracks; planning wf_48252601 |
| **Core slice 3 · PR-3a — relay substrate (natsx connect + topology + readyz + lifecycle)** | **merged (PR #19)** | squash → `origin/main` `280e94b` (2026-06-27 11:30Z) | `make verify-go` ✓ (golangci 0, sqlc vet+diff, race); **2 natsx integration tests RAN vs real NATS+JetStream (colima)**; guard **142** (NATS ARM proven binding mutate→RED); osm 22; **nats.go v1.48.0 pinned** (v1.52→go1.25); **4-lens review wf_adea04ba 14→5 confirmed / 0 BLOCKER all fixed** (Docker-free non-fail-fast tests + convergence test + main.go comment + config exact-defaults); CI green (app-gates+selftest+services-gates incl first NATS-in-CI testcontainers) |
| **Core slice 3 · PR-3b — relay drain loop (outbox→NATS publish-on-commit)** | **merged (PR #20)** | merge → `origin/main` `c3b2004` (2026-06-27) | `make verify-go` ✓; **9 relay integration tests RAN vs real PG+NATS (colima, -race)** — pending→published+Nats-Msg-Id, **late-low-seq watermark-loss regression**, no-stream→transient→recover (0 attempts burn), dedup-on-republish, poison→failed head-of-line, + **7 Docker-free unit**; guard **144** (+2 relay ARM PROVEN binding: scan-pending-SET lock + relay-start-in-main); osm 22; REL-01/02 → acceptance.md `[ ]` (Go-gated by guard ARM + Go tests); **no new deps**; **5-lens review wf_81c76244: 12 raw→4 confirmed (0 BLOCKER) ALL FIXED**; CI green (incl relay-vs-NATS-in-CI) |
| **Core slice 3 · PR-3c-1 — OpenAPI contract authoring + 4-way enum parity + spec-sync** | **merged (PR #21)** | squash → `origin/main` `f1b35d2` (2026-06-27 23:45Z) | hand-authored `openapi.yaml` (3.0.3, slice-3 surfaces only, nested Order DTO, **named `CreateOrderInput` oneOf** web/inbox, inputs omit unitPrice/total → server-authoritative, ErrorEnvelope, Settings/STK/ReplyTemplate/Dashboard, cookieAuth) + `internal/contract/{parity_test,structure_test}.go` (**4-way enum parity** OpenAPI==order==packages/core==PG; Role{owner,staff,system} vs UserRole/PG user_role{owner,staff}; + refs-resolve/opId-unique) + `spec.md §02` Review text→body + guard contract ARM; `make verify-go` ✓ (golangci 0, sqlc vet+diff, race incl parity) · **guard 145** (+1 contract ARM, tightened ≥4 Test*Parity+assertSame, PROVEN binding) · osm 22 · **parity PROVEN binding** REFUNDED-drift→RED · yaml.v3 indirect→direct (only dep change) · ADR-031 (no new ADR) · no EARS · **4-lens review wf_a95388f8-5d8: 3 confirmed (1 BLOCKER oapi-codegen opaque-union → named schema, RE-RAN codegen → 10 union methods) / 4 refuted, all fixed** |
| **Core slice 3 · PR-3c-2 — codegen (oapi-codegen strict-server) + `@lumin/api-client` + guard oapi ARM + D13** | **merged (PR #22)** | squash → `origin/main` `d10d30e` (2026-07-01 07:16Z) | `make verify-go` ✓ (golangci 0, sqlc vet+diff, **oapi generate+git-diff stale-check**, race) · `pnpm verify` ✓ (lint+typecheck+test incl new stale-gate + format:check; prettier/eslint ignore `*.gen.ts`) · guard **146** (+1 oapi ARM PROVEN binding: recipe must have `go generate`+`git diff --exit-code`, comment-strip vs `#`-false-pass) · osm 22 · committed `api.gen.go` (strict-server + chi-server, named `CreateOrderInput` union) + `schema.gen.ts` (openapi-typescript 7.13.0) · **go directive 1.23.6 preserved** (runtime v1.1.2 pinned) · D13 `plan.md` ledger checkbox ticked (Go REL-* stay `[ ]`) · **4-lens review wf_58d3da06: 2 confirmed (0 BLOCKER, both NOTE) / 0 refuted, both FIXED** (guard comment-strip + oapi-yaml comment) · deps +oapi-codegen/runtime v1.1.2 +openapi-typescript/openapi-fetch |
| **Core slice 3 · PR-3e-1 — auth self-issued login (migration 000009 + `internal/auth` + login/logout + seed-owner CLI)** | **merged (PR #24)** | squash → `origin/main` `0f665c4` (2026-07-01 15:33Z) | `make verify-go` ✓ (golangci 0, sqlc vet+diff, oapi+sqlc regen committed, `go test -race`) · guard **148** (+1 auth ARM PROVEN binding ×3: HttpOnly · bcrypt.CompareHashAndPassword · login VerifyPassword(nil); each mutate→RED→restore) · TS api-client typecheck+stale-gate+lint ✓ (schema.gen.ts regen for Set-Cookie) · ADR-030 self-issued JWT (no new ADR); user sub-decisions = seed-owner CLI (no committed secret) + 12h/no-refresh · **FAIL-FAST on forgeable dev-secret** · httpOnly+Secure+SameSite=Strict cookie, uniform-401 no-enumeration · AUTH-01/02 acceptance `[ ]` (Go-gated) · **deps +go-chi/jwtauth/v5 v5.4.0 +x/crypto direct; go 1.23.6 HELD** · **5-lens review wf_eab30b50: 4→3 confirmed (0 BLOCKER) / 1 refuted, ALL FIXED** |
| **Core slice 3 · PR-3f — order-intake prereqs (pricing + shipping + code-seq + customer/consent)** | **merged (PR #26)** | squash → `origin/main` `7ab0159` (2026-07-02) | `make verify-go` ✓ (golangci 0, sqlc vet+diff [+3 new queries regen], oapi stale-check clean, `go test -race`) · **integration RAN vs real Postgres (colima, -race):** ProductByID · NextOrderCode (monotonic/unique/#LMN-1000) · FindOrCreateCustomer (idempotent-by-phone) · GrantConsentIfAbsent (idempotent) + reversibility re-passes (renamed migration) · pricing unit+property Docker-free · guard **150** (+1 order-intake ARM PROVEN binding ×3: PriceItem derive BasePrice+PriceDelta · Selection no client-price field · NextOrderCode nextval; each mutate→149/1→restore) · osm 22 · **`internal/pricing`** PriceItem (catalog-derive UnitPrice, never client price, ADR-019) + engrave maxChars(rune) + ShippingFee-from-settings (province, no district ADR-017, 422-not-0) · `GetProductByID`+`nextval` order-code(`#LMN-%04d`)+FindOrCreateCustomer+idempotent-consent · **migration 000010** (renumbered from plan 000008 — spec-guardian WARN: 3e-1 took 000009 first; 3i→000011) · PRC-01/02 acceptance Cụm 8 `[ ]` (Go-gated) · **~290 non-test src (single PR, no split)** · **no new deps · no new ADR** (impl ADR-019/017) · **spec-guardian PASS: 0 BLOCKER / 1 WARN (renumber, FIXED) / 1 NOTE** (find-or-create race disclosed) · decisions.md ADR-033 "000008" aside left stale (hard-blocked file, flag in PR) |
| **Core slice 3 · PR-3e-2 — auth boundary: JWT-verify strict-mw + RBAC + actor injection** | **merged (PR #25)** | squash → `origin/main` `a442757` (2026-07-01) | `make verify-go` ✓ (golangci 0, sqlc vet+diff [+`GetUserByID` regen], oapi stale-check clean [no openapi change], `go test -race`) · guard **149** (+1 auth-boundary ARM PROVEN binding: router wire `StrictMiddlewareFunc{srv.authMiddleware}` non-nil + `resolveActor` `auth.Verify` + role-from-`UserByID`; nil-wire→148/1→restore) · osm 22 · core ledger 43/43 · fills the `nil` StrictMiddlewareFunc seam 3d left → unblocks fan-out {3g/3h/3i/3k→3j} · **fail-closed classify** (unlisted op→require) · public{login,logout} · optional{CreateOrder} · owner-only{UpdateBankAccount}=requireOwner · **role from DB row not token claim, `actorRole` never `system`, `!Active`→401** · Actor{ByUser=users.id,Role,At} ctx-inject · does NOT re-impl RBAC (domain guard source of truth) · errUnauthenticated→401·errForbidden→403·DB-fault→500-no-leak · RBA-01 acceptance `[ ]` (Go-gated) · **no new deps · no new ADR** (impl ADR-030/032) · ~190 non-test src · **spec-guardian PASS: 0 BLOCKER/0 WARN/1 NOTE** (optional path 401s present-but-broken cookie — deliberate, admin-only SameSite=Strict cookie) |
| **Core slice 3 · PR-3d — HTTP foundation (ErrorEnvelope + domain-error→status mapper + Server struct + withTx + strict-server stubs)** | **merged (PR #23)** | squash → `origin/main` `eac9b0f` (2026-07-01 09:29Z) | `make verify-go` ✓ (golangci 0, sqlc vet+diff, oapi stale-check, `go test -race` incl httpapi mapError/withTx/501-envelope/400-body-bind/400-param-bind tests) · guard **147** (+1 error-envelope ARM PROVEN binding [needs BOTH strict+chi seams] · + hardened NATS ARM [exclude tests+strip comments]; mutate→RED→restore) · osm 22 · TS ledger 17/17 · strict-server (ADR-031 D8); ADR-032 one-envelope + no-leak of Vietnamese `TransitionError.Message` NOR raw param/parser strings (BOTH oapi seams overridden) ; 8 endpoints = 501 stubs (3e–3k) · ERR-01 acceptance `[ ]` (Go-gated) · **no new deps · no new ADR** · Docker-free · ~300 lines non-test src · **5-lens review wf_f3cb8fbd: 10→5 confirmed/5 refuted, ALL FIXED** (2×IMPORTANT chi-wrapper plaintext leak on bad path-param → HandlerWithOptions+ChiServerOptions.ErrorHandlerFunc + regression test; 2×BLOCKER self-inflicted ERR-01 EARS line-wrap → reflowed; 1×NOTE NATS ARM widen) |
| **Core slice 3 · PR-3h — transition endpoints (dispatch-footgun + owner-gate + trackingCode-on-SHIPPING)** | **merged (PR #27)** | squash → `origin/main` `5fad85a` (2026-07-02) | Docker-free httpapi (staff-reconcile→403 · shipping-no-tracking→422 · missing-actor→401 · nil-body→400 · `toOrderDTO` full/empty-optionals/malformed-ts) + **integration RAN vs real Postgres (colima, -race):** PENDING→PAID→PRINTING→SHIPPING walk (exactly-one `order.paid` on reconcile · none on non-money edges [footgun] · trackingCode persist atomic · nested-DTO assembly) + invalid-edge→409/missing→404 envelope + `db.TestSetTrackingCode` (RETURNING reflects in-tx flip + ErrNotFound; **caught+fixed a leaked-tx→pool.Close-hang in my own test**) · guard **151** (+1 transition ARM PROVEN binding: `ConfirmPaymentTx`+`order.RoleOwner`+`SetTrackingCodeTx` in transition.go) · **dispatch footgun** `to=PAID`→`ConfirmPaymentTx` (only `order.paid` emitter) else→`AdvanceStatusTx` (locked #9) · **money-in owner-gate at BOUNDARY** (ConfirmPaymentTx hardcodes owner→domain guard can't reject staff→handler 403 pre-tx; money-OUT →REFUNDED stays domain-guarded via actor role) · SHIPPING `trackingCode` required + `SetTrackingCodeTx` same-tx atomic (no migration, col exists 000005) · shared `dto.go` assembler (3g reuses) · Actor from ctx/server-clock never body · PAY-01/SHP-01 acceptance Cụm 9 `[ ]` (Go-gated) · **~150 non-test src · no new deps · no new ADR** (impl locked #9/§6 D12) |
| **Core slice 3 · PR-3g — checkout `POST /orders` (web public + staff-gated inbox + server-priced money)** | **BUILT + post-build review + fixes · chờ push→PR** | `feat/core-http-relay-3g` `df16b83` (base build) + review-fixes (uncommitted) off `main` `5fad85a` | `make verify-go` ✓ (golangci 0, sqlc vet+diff, oapi stale-check clean, `go test -race`) · **integration RAN vs real Postgres (colima, -race):** web-end-to-end (assemble-in-tx path) · inbox-staff-born-PAID · 7 pricing rejections · transition-walk unregressed · guard **152** (3g ARM intact: pricing.PriceItem+ShippingFee+errForbidden inbox-gate+CreateOrderTx) · **post-build multi-lens review `wf_4364e692-084` (6 money-path lenses × per-finding refute, 17 agents): 11 raw → 8 confirmed ALL NOTE / 0 BLOCKER / 0 IMPORTANT / 1 uncertain / 2 refuted** — fixes: ① `clientMoneyFields` case-fold (`{"Total"}`/`{"Items":[{"UnitPrice"}]}` bypassed exact-case reject; no money impact, restores fail-loud) + regression test · #6 assemble-DTO-inside-tx (post-write read fail rolls back, no dup-on-retry) · #8 missing settings→logged 500 not client 404 · #7-doc email-`@`-check unreached backstop (openapi_types.Email validates at decode) · #3-doc inbox 403 locked CHK-05 · no-action #2/#4/#5/uncertain (locked/deferred/by-design) · scratch verifier files deleted · **no new deps · no new ADR** (impl ADR-019/017/012/030) · CHK-04/05 acceptance Cụm 10 `[ ]` (Go-gated) · **spec-guardian PASS 0/0/1 NOTE** (3h post-commit path out-of-scope) |
| ADR-026 lane B/C/D · REC-20/28/39 | todo | — | — |

## Lần verify xanh gần nhất
**Core slice 3 · PR-3f — order-intake prereqs (2026-07-02):** `make verify-go` rc=0 (gofmt + vet + golangci v2 **0** +
sqlc vet + sqlc diff [+`GetProductByID`/`NextOrderCode`/`InsertConsentGrantIfAbsent` regen] + oapi stale-check clean [no
openapi change] + `go test -race`) · guard.test.sh **150 / 0** · osm 22 · packages/core 45/45 (acceptance ledger 22, PRC-01/02
stay `[ ]`). **New:** `internal/pricing/pricing.go` (`PriceItem` catalog-derive UnitPrice + engrave-maxChars rune-count +
`ShippingFee` from settings province, no-district) + `pricing_test.go` (unit + overflow/dup/engrave-boundary + property
`TestPriceItemIsSumOfCatalogParts`) · migration `000010_order_code_seq` (`CREATE SEQUENCE START WITH 1000`) + `NextOrderCode`
query/seam (`#LMN-%04d` via nextval) · `GetProductByID`+`Catalog.ProductByID` · `Identity.FindOrCreateCustomer` +
`GrantConsentIfAbsent` + `InsertConsentGrantIfAbsent` query (ON CONFLICT active partial-idx) · guard order-intake ARM · acceptance
Cụm 8. **Integration RAN vs real Postgres (colima, -race):** `TestProductByID`/`TestNextOrderCode`/`TestFindOrCreateCustomer`/
`TestGrantConsentIfAbsent` + `TestMigrationsReversible` re-passes with renamed migration. Guard: +1 order-intake ARM PROVEN
binding ×3 (PriceItem BasePrice+PriceDelta · Selection no client-price · nextval; mutate→149/1→restore). **No new deps · no new
ADR** (ADR-019/017; §6 D9/D10). **spec-guardian PASS 0/1-WARN(renumber 000008→000010, FIXED)/1-NOTE.** colima ĐÃ dùng (integration
+ reversibility RAN, then stopped).
**Core slice 3 · PR-3e-2 — auth boundary + RBAC (2026-07-01):** `make verify-go` rc=0 (gofmt + vet + golangci v2 **0** +
sqlc vet + sqlc diff [+`GetUserByID` regen committed] + oapi generate+git-diff stale-check [clean — no openapi change] +
`go test -race`) · guard.test.sh **149 / 0** · osm 22 · packages/core 43/43 (ledger 20, RBA-01 stays `[ ]`). **New:**
`internal/httpapi/middleware_auth.go` (`authMiddleware` StrictMiddlewareFunc · `classify` fail-closed · `resolveActor`
verify→uuid→UserByID→role-from-DB · `actorRole` never-system) + `actor.go` (Actor + unexported ctx key) + `auth.Verify`/
`Claims` (jwtauth.VerifyToken sig+exp) + `db.Identity.UserByID` (+`GetUserByID` sqlc) + errors.go 401/403 (+code FORBIDDEN)
+ router wires the mw (non-nil slice). **Tests:** 17 httpapi mw tests (missing/tampered/unknown/inactive cookie · DB-fault→500 ·
public-skip · optional present/absent/invalid · owner-only allow/reject · classify-fail-closed · actorRole-never-system ·
3 wire tests through NewRouter) + fixed `TestDomainRouteReturns501Envelope` (authenticate first via `testAuthedRouter`) +
UserByID folded into `TestUserRoundTrip` (skip-local/run-CI). Guard: +1 auth-boundary ARM PROVEN binding (nil-wire→148/1→restore).
**No new deps · no new ADR** (ADR-030/032). **spec-guardian PASS 0/0/1** (present-but-broken optional cookie → 401, deliberate).
colima KHÔNG cần (mw tests Docker-free; UserByID integration skips local).
**Core slice 3 · PR-3e-1 — auth self-issued login (2026-07-01):** `make verify-go` rc=0 (gofmt + vet + golangci v2 **0** +
sqlc vet + sqlc diff + oapi generate+git-diff stale-check + `go test -race`) · guard.test.sh **148 / 0** · osm 22 · TS
api-client (typecheck + `schema.stale.test.ts` + eslint) ✓ · packages/core 42/42 (acceptance ledger 19, AUTH-01/02 consumed).
**New:** migration `000009_user_credentials` (nullable `password_hash`, pure DDL) + `db/queries/users.sql` `UpsertOwnerCredential`
+ sqlc regen; `internal/auth/auth.go` (`Issuer` jwtauth/v5 HS256 · `Issue`/`Clear` httpOnly+Secure+SameSite=Strict cookie ·
`VerifyPassword` bcrypt timing-equalized · `HashPassword`); `internal/httpapi/auth.go` (`LoginUser`/`LogoutUser`, uniform-401
no-enumeration, 500-no-leak, generated `Headers.SetCookie`); `internal/httpapi/server.go` (`auth`+`users userReader` seam);
`cmd/seed-owner`; config JWT/cookie knobs + `UsesForgeableJWTSecret` fail-fast; `main.go` wiring; `openapi.yaml` Set-Cookie
headers (+api.gen.go/schema.gen.ts regen); guard auth ARM; acceptance Cụm 6; operations.md §4b. **Tests:** auth unit (cookie
flags/claims/foreign-secret-reject/clear/VerifyPassword), httpapi login E2E (success-cookie-not-in-body · wrong-pw/unknown-email
uniform-401 · inactive · DB-fault-500-no-leak · logout-clears), config auth-defaults + `TestUsesForgeableJWTSecret` table, db
`TestUpsertOwnerCredentialRoundTrip` (integration, skip-local/run-CI) + NULL-hash assertion. Guard: +1 auth ARM PROVEN binding ×3
(HttpOnly · bcrypt-compare · VerifyPassword(nil); mutate→RED→restore). **Deps:** +go-chi/jwtauth/v5 v5.4.0 (+lestrrat jwx/v3),
x/crypto→direct; **go directive HELD 1.23.6**. **No new ADR** (ADR-030). **5-lens review wf_eab30b50: 4→3 confirmed / 1 refuted,
ALL FIXED** (dev-secret fail-fast + openapi Set-Cookie header + operations.md docs). colima NOT needed (DB integration skips local).
**Core slice 3 · PR-3d — HTTP foundation (2026-07-01):** `make verify-go` rc=0 (gofmt + vet + golangci v2 **0** + sqlc
vet + sqlc diff + oapi generate+git-diff stale-check + `go test -race`) · guard.test.sh **147 / 0** · osm 22. **New:**
`internal/httpapi/errors.go` (mapError ADR-032 table + `writeError` + strict hooks `handleResponseError`/`handleRequestError`),
`server.go` (`Server{logger,pool,nats}` impl `api.StrictServerInterface` + `(*Server).readiness` + `withTx`+`txBeginner`),
`stubs.go` (8×501 NOT_IMPLEMENTED), rewired `router.go` (`NewStrictHandlerWithOptions`+`HandlerFromMux`, sig unchanged).
Tests: `TestMapErrorTable` (18 cases), `TestMapErrorNeverLeaksDomainMessage`, `TestDomainRouteReturns501Envelope`,
`TestBadJSONBodyReturns400Validation`, withTx commit/rollback/panic/begin-err/commit-err (fake `pgx.Tx`, Docker-free).
Guard: +1 error-envelope ARM **PROVEN binding** (rename `ResponseErrorHandlerFunc`/`mapError`/`ChiServerOptions` token→RED ·
comment-out→RED · restore→147); NATS-readiness ARM widened from pinning `router.go` to grepping httpapi **prod** files (readiness
moved to a `Server` method; `--exclude=*_test.go` + strip comments so a test/comment can't false-PASS). ERR-01 → acceptance.md `[ ]`.
**5-lens review wf_f3cb8fbd (10→5 confirmed/5 refuted, ALL FIXED):** the router mounted via `HandlerFromMux`, leaving the CHI-wrapper
`ErrorHandlerFunc` at oapi-codegen's plaintext default → a non-UUID `{id}` on the transition route leaked `text/plain` + echoed input
(param-binding fires before the strict layer) → now `HandlerWithOptions` w/ `ChiServerOptions.ErrorHandlerFunc` + `TestBadPathParamReturns400Validation`
(revert→RED proven); the `ERR-01` row's line-wrap tripped REC-18 EARS-lint (guard 146/1 — I'd verified guard before adding the row) → reflowed.
**No new deps · no new ADR** (implements ADR-032). colima KHÔNG cần.
**Core slice 3 · PR-3c-2 — codegen + `@lumin/api-client` (2026-07-01):** `make verify-go` rc=0 (gofmt + vet + golangci
v2 **0** + sqlc vet + sqlc diff + **`go generate ./internal/api/…` + `git diff --exit-code` oapi stale-check** + `go
test -race`) · `pnpm verify` rc=0 (turbo lint + typecheck + test incl the NEW `@lumin/api-client` stale-gate +
format:check) · guard **146** · osm 22. **GO codegen:** `oapi-codegen@v2.5.1` (pinned in `//go:generate`; config
`internal/api/oapi-codegen.yaml` = strict-server + chi-server + models) → committed `internal/api/api.gen.go` (1400
dòng; `ServerInterface`/`StrictServerInterface` cho cả 8 op; named `CreateOrderInput` discriminated union — giữ đúng
fix BLOCKER của 3c-1). Dep `github.com/oapi-codegen/runtime v1.1.2` **pinned** (v1.4.2→x/crypto→go 1.24; **go.mod giữ
1.23.6**). `.golangci.yml` `generated:lax` + `paths:'.*\.gen\.go$'`. **TS:** NEW `packages/api-client` (`@lumin/api-client`):
openapi-typescript **7.13.0** → committed `src/schema.gen.ts` + openapi-fetch **0.13.8** `createApiClient` (cookie-cred
default per ADR-030) + `scripts/codegen.mjs` (một render fn) + `test/schema.stale.test.ts` (import chính render fn đó →
byte-equality gate) + `**/*.gen.ts` eslint+prettier-ignore. **Harness:** guard oapi ARM 145→**146** (recipe PHẢI chạy
CẢ `go generate` + `git diff --exit-code`; strip dòng comment nên verb bị `#`-comment không false-pass — hardened
sibling sqlc ARM luôn). **D13:** `docs/plan.md` acceptance-ledger checkbox ✅ (parser `packages/core/test/
acceptance.ledger.test.ts` pre-existed + passes + armed; Go REL-01/02 GIỮ `[ ]` — parser chỉ resolve id TS). **Cả 3
gate mới PROVEN binding** (mutate→RED→restore: oapi ARM drop-enforce→145/1; Go stale-check contract-drift→RED; TS
stale-check schema-drift→RED; comment-out re-proven→RED sau fix). Docker-free (PR này không test DB/NATS). **4-lens
review wf_58d3da06: 2 confirmed (0 BLOCKER, both NOTE) / 0 refuted, BOTH FIXED** — (NOTE) guard ARM unanchored grep để
verb `#`-comment false-pass (cùng class lỗ `//` của 3b) → strip comment lines; (NOTE) `oapi-codegen.yaml` comment tả
embedded-spec nhưng gắn nhầm dòng no-op `skip-prune` → chuyển vào `generate:` + bỏ dòng. (1/4 review lens stalled
no-report; territory của nó — go-1.23 preserved / golangci 0 / CI compatible — đã tự verify.) **Deps:**
+oapi-codegen/runtime v1.1.2 +apapsch/go-jsonmerge/v2 (Go); +openapi-typescript +openapi-fetch (TS). **No new ADR**
(implements ADR-031/§6 D8). **No EARS row** (codegen tooling). colima KHÔNG cần (Docker-free PR).
**Core slice 3 · PR-3c-1 — OpenAPI contract authoring (2026-06-28):** `make verify-go` ✓ (gofmt + go vet + golangci v2
**0** + sqlc vet + sqlc diff + `go test -race`). Docker-free (contract authoring; no DB/NATS test). Hand-authored
`services/core-api/openapi.yaml` (**OpenAPI 3.0.3**) = the single wire contract (ADR-031): paths for
auth(login/logout) · `POST /orders` (oneOf web/inbox + discriminator) · `POST /orders/{id}/transitions` ·
`GET /admin/dashboard` · `GET /admin/settings` · owner-only `PATCH /admin/settings/bank-account` ·
`GET /admin/reply-templates`; schemas = nested `Order` DTO (NOT flat sqlc row) + `OrderItemInput` (omits unitPrice —
server re-derives, always-must #2) + Customer/Address/Personalization/StatusEvent + `ErrorEnvelope{code,messageKey,
fields?}` + Settings/BankAccount{bin,accountNumber,accountName}/ReplyTemplate + Dashboard{stats,recentOrders,todos} +
LoginRequest/AuthUser; cookieAuth securityScheme; money `integer,format:int64`; camelCase. `internal/contract/
parity_test.go` = **4-way enum parity** (OpenAPI == `internal/order` == `packages/core` Zod == PG `000001`) for
OrderStatus(7)/Channel(2)/Role(3), + the `system` asymmetry: actor **Role**{owner,staff,system} vs stored
**UserRole**/PG `user_role`{owner,staff}, asserted explicitly (Role minus system == UserRole). `spec.md §02` Review
field `text`→`body` (DB/Go already `body`; Personalization.text untouched). guard **145** (+1 contract ARM:
openapi.yaml present → parity_test must reference all 4 sources — PROVEN binding: removed parity_test → 144/1);
**parity PROVEN binding** (drift `REFUNDED`→`REFUNDEDX` in openapi → `TestOrderStatusParity` RED → restored). osm 22.
Only dep change: `gopkg.in/yaml.v3` indirect→direct (parity test parses the YAML). **No new ADR** (implements ADR-031,
landed `ecd06fa`). **No EARS row** (contract-authoring, no runtime invariant). **4-lens review wf_a95388f8-5d8: 3
confirmed (1 BLOCKER) / 4 refuted, all fixed** — BLOCKER: inline `oneOf`+discriminator on `POST /orders` made
oapi-codegen v2.5.1 emit an opaque `union json.RawMessage` (unexported, 0 methods) that strict-server can't read →
extracted a NAMED `CreateOrderInput` schema → **re-ran oapi-codegen: 10 union methods, exit 0**; +optionIds `format:uuid`;
+tightened contract ARM (≥4 Test*Parity + assertSame, proven binding). (colima NOT needed — Docker-free PR.)
**Core slice 3 · PR-3b — relay drain loop (2026-06-27):** `make verify-go` ✓ (gofmt + go vet + golangci v2 **0** + sqlc
vet + sqlc diff + `go test -race`). **9 relay tests RAN vs real Postgres + NATS/JetStream** (testcontainers via local
**colima**, -race, not just CI): `TestRelayDrainsPendingToStream` (pending→published, literal event_type subject +
`Nats-Msg-Id`=outbox.id in ORDERS), `TestRelayLateLowSeqDrains` (**the watermark-loss regression** — a lower-seq tx that
commits AFTER a higher-seq tx already published still drains; a `seq>cursor` would lose it = silent money-event loss),
`TestRelayNoStreamTransientThenRecovers` (no-stream → transient: row stays pending + attempts 0 + inline topology
re-ensure → drains next tick), `TestRelayDedupCollapsesRepublish` (crash-after-PubAck → same `Nats-Msg-Id` republish →
stream stays 1 msg) + **7 Docker-free unit** (`isTransient` set, happy, broker-down-skips-publish, transient-no-attempts-burn,
poison-quarantined-head-of-line, **panic-recovered-loop-continues, newRelay-clamps-non-positive-knobs** — 2 latter from review).
`internal/relay/relay.go` (drain loop) + 4 `db/queries/outbox.sql`
queries (`SelectPendingOutbox` scans pending-SET `ORDER BY seq`, **no watermark/SKIP-LOCKED**) + natsx `PublishMsg`/
`ReEnsureOnReconnect` + main.go lifecycle (relay goroutine, stopRelay cancel+join before nc.Close/pool.Close). **publish →
await PubAck → mark** order; transient (conn down / no-stream) leaves batch pending + no attempts burn + re-ensures;
poison (PubAck reject on reachable broker) → `attempts++` → `failed` after `RelayMaxAttempts`, head-of-line preserved;
panic-recovery wraps each tick. guard **144** (+2 relay ARM proven binding mutate→RED→restore), osm 22, **no new deps**.
5-lens adversarial review wf_81c76244 running. NOTE: colima started locally to run integration tests — stopped after.
**Core slice 2 · PR-2g — config/reference (2026-06-26):** `make verify-go` ✓ (gofmt + go vet + golangci v2 **0** +
sqlc vet + sqlc diff + `go test -race`). **6 settings integration tests RAN vs real Postgres** (testcontainers via
local **colima**, not just CI): singleton guard (2nd `id=true`→PK reject / `id=false`→CHECK reject), the
`UpdateBankAccountTx` audit seam (update+audit atomic, rollback leaves neither, history accumulates),
**DB-enforced append-only — UPDATE + DELETE + TRUNCATE all rejected** (row-level + statement-level triggers),
`validate()` rejecting JSON null/`{}`/`[]`/non-object STK, **seq-ordered newest-first** + nil-reason→NULL, reply-template
round-trip; `TestMigrationsReversible` re-passes (000007 down drops both tables + the trigger function; no new enum
types). `000007_settings` + `db/queries/settings.sql` + `internal/db/settings.go` (`Settings` repo + `UpdateBankAccountTx`
seam). **bank_account split off `UpdateSettings`** → only the seam writes it (+ its audit row, conventions §57).
guard 141 · osm 22 · **no new deps**. **Adversarial review wf_70129d8e (5 lenses → per-finding verify): 7 confirmed /
5 refuted, all confirmed fixed** — 2 IMPORTANT money-out (TRUNCATE bypassed the row-level append-only trigger → added
BEFORE TRUNCATE guard + test; `validate()` accepted JSON null/`{}`/`[]` → require non-empty object) + seq/ordering test.
NOTE: colima started locally to run integration tests — stopped after.
**Core slice 2 · PR-2f — fulfillment/asset (2026-06-26):** `make verify-go` ✓ (gofmt + go vet + golangci v2 **0** +
sqlc vet + sqlc diff + `go test -race`). **9 jobs integration tests RAN vs real Postgres** (testcontainers via local
**colima**, not just CI): asset-job create emits `asset_job.created` (payload carries source pointer + jobType, ADR-006),
rollback leaves 0 job + 0 outbox, duplicate job-id rejected (PK; dedup_key UNIQUE backstop), both `model_ingest` +
`sprite_render` queued, NotFound, worker-callback lifecycle mark (queued→processing→ready + completed_at), print-queue
round-trip + staff stage-advance (NEED_PRINT→PRINTING) + `ON DELETE CASCADE` (print job dies with its order item), and
`TestMigrationsReversible` re-passes (000006 down drops `asset_job_status`/`asset_job_type`). `000006_jobs` + `db/queries/
jobs.sql` + `internal/db/jobs.go` (`Jobs` repo + `CreateAssetJobTx`). **D3** (asset shape, user): split `asset_job_type`
{model_ingest, sprite_render}, `source_model_url`+`source_version`, outputs→Product. **D6** (user): print stage STORED.
guard 141 · osm 22 · **no new deps**. NOTE: colima started locally to run integration tests — stopped after.
**Core slice 2 · PR-2e — order spine (2026-06-26):** `make verify-go` ✓ (golangci **0**, sqlc vet+diff clean,
`go test -race`). **Integration tests RAN against real Postgres** (testcontainers via local **colima**, not just CI):
all order tests PASS incl. `TestConcurrentReconcileSerializes` (two goroutines race PENDING_CONFIRM→PAID under
`-race`; FOR-UPDATE lock → 1 commit + 1 INVALID_EDGE, exactly one `order.paid`, no double-append) + jsonb/enum sqlc
override round-trips + outbox rollback-atomicity + refund-proof denormalization consistency + owner-only RBAC + money
CHECK + multi-hop replay. `000005_orders` + `db/queries/orders.sql` (incl. `GetOrderForUpdate` FOR UPDATE) +
`internal/db/orders.go` (3 tx seams) + `internal/order/order.go` (Address/Personalization/GenesisEvent). Totals via
`money.CalcTotals` (no client total). 4-lens adversarial review (wf_ac186d9c): 14 raw → 9 confirmed, **all addressed**
(2 IMPORTANT: `CreateOrderTx` empty-items guard `ErrNoItems` + concurrent-reconcile lock test). guard 141 · osm 22 ·
**no new deps**. NOTE: colima started locally to run integration tests — stop after merge (home box normally Docker-less).
**Core slice 2 · PR-2d — identity + PDPL consent (2026-06-26):** `make verify-go` ✓ — `000004_identity` (customers/
consent_grants/users + ALTER reviews ADD customer_id FK→customers ON DELETE SET NULL) + 8 sqlc queries + thin
`Identity` repo. consent_grants append-then-mark (partial UNIQUE active per customer/scope/channel; withdraw=now(),
no delete); addresses jsonb NO district (ADR-017); user_role owner/staff only (no system). Tests (testcontainers
skip-local/run-CI): customer round-trip + address-no-district + consent grant/withdraw/re-grant + active-uniqueness
+ user round-trip. vn-compliance skill loaded. **No new deps.** guard 141, osm 22.
**Core slice 2 · PR-2c — catalog (2026-06-26):** `make verify-go` ✓ (GOTOOLCHAIN=local go 1.23.6) — `000003_catalog`
(categories/products/colors/options/reviews; material TEXT+CHECK, money int8 CHECK≥0, product_status/option_type/
review_status native enums, reviews.customer_id bare uuid→FK in 000004) + 9 sqlc queries + thin `Catalog` repo
(internal/db/catalog.go, ErrNotFound on slug-get). sqlc vet validates 9 queries; nullable customer_id→pgtype.UUID,
max_chars→*int32, rating_avg→*float32, jsonb→[]byte. Tests (testcontainers skip-local/run-CI): round-trip +
negative-money CHECK + rating-1..5 CHECK + null-customer review. guard 141, osm 22. **No new deps** (reuse pgx/uuid/
testcontainers từ 2b). Catalog không có TS contract (packages/core order-only). EARS deferred (slice-1 precedent).
**Core slice 2 · PR-2b — outbox table + tx-insert seam (2026-06-26):** `make verify-go` ✓ (GOTOOLCHAIN=local
go 1.23.6) — migration `000002_outbox` + `InsertOutbox` query + `EnqueueOutbox(ctx, tx pgx.Tx, ev OutboxEvent)`
(tx-first-arg dual-write guard, ADR-006). sqlc overrides uuid→google/uuid, outbox.payload→json.RawMessage.
Tests: pure `validate` (runs everywhere) + testcontainers atomicity (rollback→0/commit→1/dup-dedup→reject) +
migration-reversibility (in-test SQL applier, no golang-migrate dep) — **skip local (no Docker, recover-guard
quanh `SkipIfProviderIsNotHealthy` panic), RUN in CI**. `sqlc vet` giờ validate `InsertOutbox` vs outbox schema.
guard.test.sh **141** (testcontainers real-check ACTIVE), osm 22. Deps +google/uuid v1.6.0 (runtime) +
testcontainers-go v0.34.0/postgres module (test) — go directive giữ 1.23. go.sum phình (lock-file, docker/otel
transitive). macOS arm64: cảnh báo cgo go-m1cpu vô hại (không có ở CI linux).
**Core slice 2 · PR-2a — data-layer infra (2026-06-26):** `make verify-go` ✓ — gofmt + go vet + golangci v2.12.2
(**0 issues**) + **`sqlc vet`** + **`sqlc diff`** (no-DB: query↔schema compile + generated-code không stale) +
`go test -race ./...` (config 6 / db 3 / httpapi 4 incl readyz-503-khi-DB-chết / money / order; sqlc + cmd no-test).
`tests/harness/guard.test.sh` **141 / 0** (+2: sqlc-vet-in-recipe + testcontainers-arm-when-land; sqlc ARM-GUARD
**proven binding** — gỡ `sqlc vet` khỏi Makefile → guard ĐỎ → restore). `osm-mutation.test.sh` 22 / 0. Toolchain
verify dưới **GOTOOLCHAIN=local go 1.23.6** (CI go-1.23 sẽ qua). go.mod: pgx **v5.7.5** (v5.10 ép go 1.25 → pin
xuống) + x/crypto/sync/text 1.23-compat; sqlc CLI **v1.30.0** (CI `harness.yml` thêm step cài binary pinned).
Bug bắt lúc dựng: query file `_ping.sql` → `_ping.sql.go` bị Go **bỏ qua** (file `_`-prefix) → `*Queries` thiếu
`Ping` → đổi tên `ping.sql`.
**Core slice 1 — Go spine (2026-06-26):** `make verify-go` ✓ (gofmt + go vet + golangci v2.12.2 + `go test -race`,
**17 test**: `internal/order` state machine OSM-01..05 + replay + property; `internal/money` `CalcTotals` MNY-01/02
+ overflow + property). 5-lens adversarial review (wf_3ccae648, 16 agent): 0 BLOCKER, 7 confirmed (2 positive),
fix 2 — (a) money int64 **overflow guard** (`addChecked`/`mulChecked` → `errOverflow` thay vì wrap âm câm; vector
= quantity ác ý) + (b) test ngày bất-khả (`2026-13-99...Z`) ép **time.Parse backstop** của `isISOUTC`; cả hai
**proven binding** (mutate-run-restore → RED). 3 NOTE giữ-nguyên-có-chủ-đích: server Go **strict hơn** TS reference
ở ts/url dị dạng (an toàn hơn — đã ghi comment). guard 139 · osm 22 · spec-guardian PASS.
**Services backbone (2026-06-26):** `make verify-go` ✓ (gofmt-clean + `go vet` + **golangci-lint v2.12.2**
[ADR-020 — local tool nâng v1.64.8→v2, `.golangci.yml` v2-schema] + **`go test -race ./...`** — config 3 /
httpapi 3 = **6** test, `health`/`readyz`/404) · `make verify-rs` ✓ (`cargo fmt --check` + `cargo clippy
--all-targets -D warnings` + `cargo test` — **3** test) · `tests/harness/guard.test.sh` — **139 / 0** (ARM-GUARD
giờ thấy `.go`→`verify-go` + `.rs`→`verify-rs` ✓) · `osm-mutation.test.sh` — **22 / 0** · `pnpm verify` — **rc=0**
(services NGOÀI JS-workspace; `/services/` vào `.prettierignore` để prettier không tranh gofmt/rustfmt).
**Review 4-lens (workflow wf_f5948e52, adversarial-verify):** 0 BLOCKER · 2 WARN đã sửa (CI golangci PATH→
`$GITHUB_PATH`; v1→v2 ADR-020) · notes đã áp (Go timeout/Timeout-cooperative TODO + writeJSON buffer-then-write;
Rust flush-log + warn-on-err + default-pin test). golangci bắt 1 finding thật lúc dựng: `chi middleware.RealIP`
deprecated (SA1019, IP-spoofable) → bỏ, dùng CF-Connecting-IP ở edge-phase. core-api `:8080` (khớp Caddy/compose).
**App shells (2026-06-26, lịch sử):** `pnpm verify` rc=0 · `next build` storefront ✓ · guard 139 · osm 22 ·
spec-guardian PASS (0/0/2).

## Lưu ý git (2026-06-26, cập nhật)
- `origin/main` = **`f1b35d2`** (PR #21 PR-3c-1 OpenAPI contract squash-merged 2026-06-27 23:45Z). Local main ĐÃ ff về
  `f1b35d2`, working tree clean (đang trên nhánh `feat/core-http-relay-3c-2`). **Relay track 3a→3b + contract 3c-1 ALL
  MERGED** (slice 2 2a–2g cũng đã merged trước đó). Verify:
  `git cat-file -t origin/main:services/core-api/openapi.yaml` = blob (contract on main). (lịch sử pointer: PR #20 3b
  `c3b2004`; PR #19 3a `280e94b`; PR #18 2g `ffab5f8`; PR #10 `ab99360`.)
- **Housekeeping nợ (chờ chủ duyệt xoá):** 9 local `:gone` branches (`feat/core-data-layer-2e`, `feat/core-data-model`,
  `feat/phase-0-*` x7, `fix/dev-handoff-refunded`) + the now-merged `feat/core-data-layer-2g` (squashed into `ffab5f8`)
  — prune khi chủ OK. `main` local đã ff `ffab5f8`.
- **Services-backbone slice (nhánh `feat/phase-0-services-backbone` off `bf1b7a5`):** thêm `services/core-api`
  (Go+Chi) + `services/asset-worker` (Rust+tokio+async-nats) + root `Makefile` (verify-go/verify-rs) + CI
  `services-gates` + `/services/` vào `.prettierignore`. Go module = `github.com/huongnguyenduc/lumin-studio/
  services/core-api`. **Scaffold-only:** không DB/NATS-live/domain (await shutdown signal). Dockerfile + mở
  comment compose = DEFERRED (gắn GPU gate). Lock-file (go.sum + Cargo.lock) committed → diff "lớn" nhưng code
  tay nhỏ; diff-size advisory sẽ kêu (bỏ qua, do lock-file).
- **golangci-lint v2 (ADR-020):** local tool ở `~/go/bin` đã nâng **v1.64.8 → v2.12.2** (install.sh) để verify;
  `.golangci.yml` là **v2-schema** (`version: "2"`). CI `services-gates` cài đúng v2.12.2. Máy khác checkout
  repo này **cần golangci-lint v2** (v1 không parse được config v2). `verify-go` = gofmt + go vet + golangci v2
  + `go test -race`. `sqlc vet` (ADR-020) vẫn DEFERRED tới khi có query sqlc (arm-when-land).
- **(lịch sử)** `b77acb7` = PR #7 storefront-shell. Chứa `apps/storefront` + infra.
- **⚠️ STACKED-MERGE FOOTGUN (đã sửa):** PR #8 (admin) base = `feat/phase-0-storefront-shell` (KHÔNG phải
  main). Khi #7 squash-merge vào main *riêng*, GitHub auto-đóng #8 là "MERGED" — nhưng diff #8 chỉ vào nhánh
  storefront-shell đã chết (`c13202d`), **chưa bao giờ tới main**. `git cat-file origin/main:apps/admin` =
  "NOT on main". → Re-land bằng `git rebase --onto b77acb7 5b95786` (4 commit admin, 0 conflict) sang nhánh
  mới **`feat/phase-0-admin`** → **PR #9** (base=main, đã push). Bài học: **đừng tin nhãn "merged" của stacked
  PR — verify `git cat-file <main>:<path>`.** Backup nhánh gốc: tag `backup-admin-pre-reland` (= e0fce89).
- Branch **`feat/phase-0-admin-shell`** (orig, tip `e0fce89`): GIỮ làm backup, đừng force-push (PR #8 ref nó).
- **/review fixes round (2026-06-26, force-push cả 2 PR — chủ duyệt):** (1) `error.tsx` retry (cả 2 app) đổi
  pill thủ công → `@lumin/ui <Button>` (md=h-11=44px, token primary AA) khỏi drift design-system; (2) thêm
  `CtaLink` (storefront) gói pop/outline cho CTA-điều-hướng (Button render `<button>`, không mang href được) +
  ép `min-h-[44px]` → bỏ 3 blob class lặp ở hero/featured; (3) sửa comment "Hanken Grotesque"→"Grotesk" ở
  storefront `tailwind.config.ts`; (4) `TODO(phase-1)` scope client catalog khi `@lumin/core` phình; (5) viết
  lại body PR #7/#8 (xoá claim "Fontsource/Plus Jakarta" cũ — thực tế là `next/font/google` + Hanken Grotesk).
  build/verify/guard 139/osm 22 xanh lại sau fix. Copyright year `© 2026` để **cố ý** baked (deterministic, né
  `new Date()`) — không phải defect.
- **Deferred (ghi để PR sau):** `@lumin/ui` Button `lg` dùng `h-13` không có spacing token → render 0 height;
  shell tránh `lg`. Fix gọn ở packages/ui (thêm token `13`/đổi `h-[52px]`) — KHÔNG trộn vào PR app-shell.
- **Font name fix (2026-06-26):** body font dùng đúng **Hanken Grotesk** (design-system.md/tokens viết sai
  "Hanken Grotesque" — đó là lý do trước đây tưởng không có). **Upgrade Next 14→15** (React giữ 18.3, peer cho
  phép) để next/font/google; bỏ Fontsource. design-system.md/tokens vẫn ghi "Hanken Grotesque" → nên sửa ở PR
  packages sau (literal name bị app override qua CSS-var nên không vỡ). `prettier-plugin-tailwindcss` +
  `@next/eslint-plugin` vẫn deferred — không phải ARM gate.
