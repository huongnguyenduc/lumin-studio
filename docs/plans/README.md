# docs/plans — plan triển khai từng feature (plansDirectory)

> `.claude/settings.json` → `"plansDirectory": "./docs/plans"` (ADR-027): plan mode **lưu & đọc** plan ở đây —
> sống sót `/clear` + compaction, review được như một PR. Khác `plan.md` (roadmap theo phase) và
> `active-context.md` (focus đang chạy).

**Mỗi feature nhiều-file:** copy [`../templates/implementation-plan.md`](../templates/implementation-plan.md)
thành `<feature>.md` **trước khi code**. Plan là **advisory** (không gate), nhưng còn `[NEEDS CLARIFICATION]`
thì chưa đủ điều kiện rời plan mode (`agent-harness.md` §Kỷ luật). `spec-guardian` soi diff vs plan này
(plan-drift — ADR-027).
