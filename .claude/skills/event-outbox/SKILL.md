---
name: event-outbox
description: Pattern outbox / publish-on-commit + idempotency khi phát event lên NATS. Dùng khi task phát/tiêu thụ event (admin reconcile→PAID, checkout tạo đơn, asset job) từ path KHÔNG auto-load domain-core.md. Đọc trước khi publish event lên NATS hoặc thêm dual-write.
---

# Event outbox / publish-on-commit — pointer

> **Pointer 3 dòng, defer hoàn toàn** — không restate luật để khỏi drift.

**Nguồn chân lý:** [`.claude/rules/domain-core.md`](../../rules/domain-core.md) + [`decisions.md`](../../../docs/decisions.md)
**ADR-006** (NATS JetStream + outbox).

**Luật (xem nguồn để biết chi tiết):** publish job **chỉ sau** khi row (AssetJob / order event) đã commit — **không
dual-write**; consumer phải **idempotent** (NATS MaxDeliver + redelivery có thể giao lại). Đây là lý do skill này tồn
tại: luật outbox sống ở `domain-core.md` (chỉ auto-load khi chạm `packages/core` / domain), nhưng các path **admin
reconcile** và **storefront checkout** cũng phát event mà **không** auto-load rule đó.
