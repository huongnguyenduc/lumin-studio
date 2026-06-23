# Lumin Studio — Tài liệu triển khai (`docs/`)

> Bộ tài liệu **kỹ thuật** sinh ra từ quá trình thiết kế hệ thống. Nó **bổ sung**, không thay thế gói bàn giao gốc.
> Nguồn chân lý gốc vẫn là: [`/spec.md`](../spec.md) (hành vi & dữ liệu) · [`/design-system.md`](../design-system.md) (giao diện) · [`/tokens/*.css`](../tokens) (token) · [`/designs/*.dc.html`](../designs) (thiết kế trực quan).

Các quyết định ở đây là kết quả của 3 vòng thảo luận (kiến trúc → hạ tầng → cải tiến mọi mặt), trong đó vòng 2 và 3 có nghiên cứu + fact-check (xem `decisions.md` để biết "vì sao").

---

## Đọc theo thứ tự (cho agent)

1. [`/CLAUDE.md`](../CLAUDE.md) — orientation gói bàn giao.
2. [`architecture.md`](architecture.md) — hệ thống gồm gì, chạy ở đâu, dữ liệu chảy thế nào.
3. [`decisions.md`](decisions.md) — **vì sao** chốt như vậy (ADR log). Đọc trước khi định đổi bất kỳ lựa chọn nào.
4. [`conventions.md`](conventions.md) — **luật BẮT BUỘC khi viết code** (tiền, i18n, statusHistory, a11y, các mitigation).
5. [`plan.md`](plan.md) — làm gì, theo phase nào, "done" nghĩa là gì.
6. [`acceptance.md`](acceptance.md) — acceptance criteria EARS (xương sống), gắn test id — dạng máy-kiểm-được của "Test P0".
7. [`operations.md`](operations.md) — deploy / CI-CD / backup / observability / GPU.
8. [`compliance.md`](compliance.md) — nghĩa vụ pháp lý Việt Nam.
9. [`agent-harness.md`](agent-harness.md) — cách repo điều khiển Claude Code (hooks, rules, skills, spec-guardian, oracle, stack lint/test). Đọc khi muốn hiểu các cổng chặn. Bối cảnh "học từ harness ngoài": [`agent-harness-learnings.md`](agent-harness-learnings.md).

## Đang làm việc X → đọc Y

| Bạn đang… | Đọc |
|---|---|
| Dựng/đổi data model, luồng đơn | `architecture.md` (§Data flow, §State machine) + `/spec.md` §02/§04 |
| Code tiền / tổng / giá | `conventions.md` §Tiền — int VND, tính ở server, một formatter |
| Thêm chuỗi UI | `conventions.md` §i18n — không hard-code text |
| Đổi trạng thái đơn | `conventions.md` §statusHistory + `architecture.md` §State machine |
| Làm UI / component | `/design-system.md` + `/tokens/` + `conventions.md` §A11y |
| Pipeline 3D / upload model | `architecture.md` §Asset pipeline + `conventions.md` §3D-upload |
| Thanh toán / checkout | `architecture.md` §Order lifecycle + `decisions.md` ADR-010 + `compliance.md` |
| Extension | `decisions.md` ADR-011 (assistive-only — KHÔNG đụng DOM Meta) |
| Deploy / hạ tầng / backup | `operations.md` |
| Pháp lý / consent / đổi trả | `compliance.md` (+ skill `vn-compliance`) |
| Viết test cho invariant lõi (state machine, tiền, checkout) | `acceptance.md` — tick `[x]` khi test liên kết pass |
| Hiểu hooks/cổng chặn / lint-test / skills / oracle | `agent-harness.md` (+ `agent-harness-learnings.md` cho "vì sao") |

## Quy tắc cho agent khi dùng bộ docs này

- **Đừng relitigate** quyết định đã chốt trong `decisions.md`. Muốn đổi → đọc ADR liên quan, nêu lý do mới, rồi cập nhật ADR (đặt `Status: Superseded by ADR-NNN`).
- Mỗi quyết định mới quan trọng → **thêm một ADR** vào `decisions.md`.
- Docs này phải khớp với memory dài hạn (`lumin-architecture-decisions`, `lumin-improvement-roadmap`). Lệch nhau thì sửa cho khớp.
- Khi code, theo `conventions.md` như luật cứng — nó mã hoá các quyết định thành ràng buộc kỹ thuật.
- Repo có **hooks** (`.claude/hooks/`) chặn lệnh nguy hiểm + chặn dừng khi test chưa xanh, và **`.claude/rules/`** tự load luật theo bề mặt. Nếu bị hook chặn, đó là chủ đích — xem `agent-harness.md`, đừng tìm cách lách. Trước khi coi task nhiều-file là "done", gọi subagent `spec-guardian`.
