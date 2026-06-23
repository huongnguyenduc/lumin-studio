# Lumin "Shy Cats" — Đặc tả hành vi (Cat Peek)

> Note kỹ thuật để sau này apply 2 con mèo nhút nhát vào web chính thức.
> Bản tham chiếu chạy được: `Lumin Cat Peek.dc.html` (logic nằm trong `<script data-dc-script>`).

---

## 1. Ý tưởng tổng quát

Hai con mèo 2D (1 con tam thể `cat-id="0"`, 1 con mèo đen `cat-id="1"`) **núp sau các element thật của trang** và chỉ **side-peek / top-peek** (ló một phần ra ngoài mép element). Chúng nhút nhát:

- **Đưa chuột lại gần** → con mèo **trốn tuột ra sau element đang núp**, rồi **chạy sang một element khác đang nằm trong viewport** và ló ra ở đó.
- **Cuộn trang** → mèo **chạy theo**: con nào có element chủ trôi khỏi màn hình thì nó nấp đi và ló lại từ một element đang hiển thị.
- **Luôn luôn nằm trong viewport** — dù đang trốn hay đang chạy, mèo không bao giờ văng ra ngoài khung nhìn.

---

## 2. Ba quy tắc cốt lõi (BẮT BUỘC giữ khi port)

### 2.1 Núp SAU element (z-order)
- Mỗi element được dùng làm chỗ núp có `data-anchor` (vd `nav`, `hero`, `card`, `cta`).
- Khi mount: nâng tất cả `[data-anchor]` lên `position:relative; z-index:2`.
- Con mèo đặt `position:absolute; z-index:1` → phần mèo đè lên element bị element che, **chỉ phần ló ra mép là nhìn thấy** → hiệu ứng "núp sau".
- Mèo `pointer-events:none` (không chặn click của trang; phát hiện chuột bằng khoảng cách).

### 2.2 Trốn = tuck VÀO SAU element (không văng ra ngoài màn hình)
Transform "hide" phải đẩy mèo **vào trong / ra sau** element chủ (element này đang ở trên màn hình), KHÔNG đẩy mèo ra xa khỏi mép:
| Kiểu núp (`mode`) | Vị trí nghỉ (peek) | Transform khi trốn |
|---|---|---|
| `top`    | ló lên trên mép trên | `translateY(72%)`  (tụt xuống sau element) |
| `left`   | ló ra mép trái       | `translateX(95%)`  (lùi sang phải vào sau) |
| `right`  | ló ra mép phải       | `translateX(-95%)` (lùi sang trái vào sau) |
| `bottom` | ló xuống mép dưới    | `translateY(-72%)` (rút lên sau element)   |

→ Nhờ vậy lúc trốn mèo chui hẳn ra sau element (vẫn trong viewport), rồi mới chạy chỗ khác.

### 2.3 Chỉ chọn chỗ núp ĐANG TRONG VIEWPORT
- `spotInView(spotIdx, margin)`: element chủ của spot phải giao với viewport (có margin) mới được chọn.
- **Né chuột** (`pickSpot`): trong các spot đang in-view, chọn spot **xa con trỏ nhất**. Nếu không còn spot in-view trống → **đứng yên né tại chỗ**, KHÔNG nhảy ra spot off-screen (`best = cur`).
- **Theo scroll** (`pickViewSpot`): chọn spot in-view **gần tâm dọc màn hình nhất**.
- Hai mèo không bao giờ chọn trùng spot của nhau (`idx !== other`).

---

## 3. Vòng đời sự kiện

- `componentDidMount`:
  - Cache wrapper + danh sách card; nâng `[data-anchor]` lên `z-index:2`.
  - Đặt mảng `spotDefs` (12 chỗ núp neo theo element thật: nav ×2, hero ×2, 6 card, cta ×2).
  - Khởi tạo 2 mèo ở spot 0 và 8, rồi gọi `followScroll()` để ép vào viewport ngay khi load.
  - Lắng nghe `mousemove` (mắt nhìn theo + `checkFlee`), `resize`, `scroll` (throttle bằng `requestAnimationFrame`).
- `mousemove` → `checkFlee()`: nếu khoảng cách chuột→tâm mèo < 165px và không trong cooldown → `flee()`.
- `flee(i)`: chạy transform "hide" (~0.26s) → `placeCat(i, pickSpot(i), animateIn=true)` ló ra ở spot mới (ease-out-back). Cooldown ~700ms, cờ `fleeing` ~950ms.
- `scroll` → `followScroll()`: mèo nào `!spotInView(spot, 90)` thì trốn rồi `placeCat` sang `pickViewSpot`.
- `componentWillUnmount`: gỡ cả 3 listener (mousemove/resize/scroll).

## 4. Chi tiết phụ
- **Mắt nhìn theo chuột**: mỗi `[data-eye]` có `[data-pupil]` dịch theo góc & khoảng cách tới chuột, giới hạn bởi `data-max`.
- **Animation idle**: `@keyframes catblink` (chớp mắt) + `eartwitch` (giật tai) — thuần CSS, không ảnh hưởng logic.
- **Tọa độ**: `computePos` trả vị trí tương đối so với wrapper (toạ độ trang), nên mèo absolute tự trôi theo trang khi cuộn; `getBoundingClientRect` dùng để kiểm tra in-view theo viewport.

## 5. Props (tweak)
- `showCats` (bool) — bật/tắt mèo.
- `trackPointer` (bool) — mắt có nhìn theo chuột không.
- `shy` (bool) — có trốn khi chuột lại gần không (tắt thì vẫn theo scroll).
- `respectReducedMotion` (bool, mặc định true) — khi OS bật "giảm chuyển động": tắt flee + dart, mèo chỉ reposition tức thời theo scroll; loop blink/eartwitch cũng dừng (CSS `@media (prefers-reduced-motion: reduce)`).

### No-cat zones (vùng cấm mèo)
Bọc khu vực cần tập trung (checkout, giỏ hàng, form thanh toán) bằng `[data-no-cat]`. `isNoCat(spot)` khiến mọi spot neo trong vùng đó bị loại khỏi `spotInView` → mèo không bao giờ chọn, và nếu spot hiện tại rơi vào vùng no-cat mèo sẽ tự rời đi. Lý do hành vi: chuyển động ngoại vi cạnh tranh attention đúng lúc khách nhập liệu → giảm conversion.

---

## 6. Checklist khi apply vào WEB CHÍNH THỨC
1. Gắn `data-anchor="..."` lên các element muốn mèo núp (hero, card, nav, footer, CTA…). Cập nhật lại `spotDefs` cho khớp layout thật.
2. Đảm bảo các element đó nhận được `position:relative; z-index:2` (hoặc set sẵn trong CSS); mèo ở `z-index:1`.
3. Nếu trang có header `position:fixed`/sticky: cân nhắc một số spot cho mèo bám header (toạ độ theo viewport thay vì trang) — hiện bản demo dùng toạ độ trang.
4. Giữ nguyên 3 quy tắc ở mục 2 (z-order, hide-tuck-behind, chỉ chọn spot in-view) — đây là phần làm nên hành vi đúng.
5. `pointer-events:none` trên mèo để không cản tương tác trang.
6. Tôn trọng `prefers-reduced-motion`: ĐÃ có — `respectReducedMotion` tắt flee/dart + dừng loop CSS; nhớ giữ khi port. Đồng thời bọc các luồng nhạy cảm bằng `[data-no-cat]`.
7. Hiệu năng: listener mousemove/scroll đều rẻ (chỉ đo khoảng cách + rAF throttle), không gây reflow nặng.
