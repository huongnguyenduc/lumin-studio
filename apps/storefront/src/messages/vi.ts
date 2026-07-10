// Storefront chrome microcopy (default locale `vi`). Sentence case, warm voice ("chúng mình / bạn")
// per CLAUDE.md §6 + conventions §Giọng. Domain microcopy (cart/checkout/validation) lives in
// @lumin/core and is merged under the `core` namespace (see ./index.ts). ICU args: {name}, {value}.
// NO prices are baked into copy — money is always formatted by @lumin/core's formatVnd at render
// time (enforced by test/messages.test.ts).
export const vi = {
  meta: {
    title: 'Lumin Studio — đèn & đồ trang trí in 3D theo đơn',
    description: 'Thiết kế và in 3D đèn, đồ trang trí theo đơn. Ấm, tái chế, làm riêng cho bạn.',
  },
  nav: {
    brand: 'lumin',
    home: 'Trang chủ',
    categories: 'Danh mục',
    collection: 'Bộ sưu tập',
    cart: 'Giỏ',
    account: 'Tài khoản',
    searchLabel: 'Tìm kiếm',
    searchPlaceholder: 'Tìm mô hình, gadget, quà tặng…',
    notificationsLabel: 'Thông báo',
    openMenuLabel: 'Mở menu',
    primaryNav: 'Điều hướng chính',
    skipToContent: 'Tới nội dung chính',
  },
  hero: {
    eyebrow: '✦ In theo đơn · không tồn kho',
    heading: 'Đèn & đồ trang trí in 3D, làm riêng cho bạn.',
    body: 'Thiết kế ấm, vật liệu tái chế, in theo đơn — không đại trà. Chọn mẫu, khắc tên và chọn màu của riêng bạn.',
    primaryCta: 'Khám phá bộ sưu tập',
    secondaryCta: 'Cách chúng mình làm',
    note: 'Giao trong 3–5 ngày · in lại miễn phí nếu lỗi do shop',
  },
  featured: {
    heading: 'Mới về',
    subheading: 'Vài món vừa ra lò từ xưởng in của chúng mình.',
    viewAll: 'Xem tất cả',
    empty: 'Chưa có sản phẩm nào ở đây — chúng mình đang lên mẫu mới.',
    emptyCta: 'Xem tất cả danh mục',
  },
  product: {
    add: 'Thêm vào giỏ',
    favLabel: 'Lưu {name} vào yêu thích',
    ratingLabel: '{value} trên 5 sao',
  },
  catalog: {
    // <title> for /danh-muc (kept out of the index — see the route's generateMetadata).
    metaTitle: 'Danh mục — Lumin Studio',
    heading: 'Danh mục',
    // Visually-hidden <h2> above the product grid so the heading order is h1 (page) → h2 → h3 (cards) —
    // the grid cards would otherwise jump h1 → h3 (axe heading-order).
    resultsHeading: 'Danh sách sản phẩm',
    // Result-count line. {count} is a PRE-FORMATTED number string (formatVnNumber, @lumin/core) — never a
    // raw price/number baked here (conventions §Tiền; messages.test forbids grouped digits in copy).
    resultCount: '{count} sản phẩm',
    // Category filter chips.
    categoriesLabel: 'Lọc theo danh mục',
    allCategories: 'Tất cả',
    // Search box (accent-insensitive FTS, ADR-016).
    searchLabel: 'Tìm sản phẩm',
    searchPlaceholder: 'Tìm mô hình, gadget, quà tặng…',
    searchSubmit: 'Tìm',
    searchClear: 'Xoá tìm kiếm',
    // Sort control. Only the four orders the endpoint supports (the design's "Bán chạy"/"Nổi bật" have
    // no Phase-1 backing column).
    sortLabel: 'Sắp xếp',
    sortNewest: 'Mới nhất',
    sortPriceAsc: 'Giá thấp → cao',
    sortPriceDesc: 'Giá cao → thấp',
    sortRating: 'Đánh giá cao',
    // Empty states — three distinct cases (plan §3 P1-g: search-miss vs filter-miss vs bare catalog).
    emptyFilterTitle: 'Chưa có món nào khớp',
    emptyFilterBody: 'Thử bỏ bớt bộ lọc để xem thêm nhé.',
    emptyFilterCta: 'Xoá bộ lọc',
    emptySearchTitle: 'Chưa tìm thấy mẫu nào',
    // {query} is the shopper's search term (not a baked value).
    emptySearchBody: 'Không có kết quả cho “{query}”. Thử từ khoá ngắn hơn nhé.',
    emptySearchCta: 'Xoá tìm kiếm',
    emptyCatalogTitle: 'Chưa có sản phẩm nào',
    emptyCatalogBody: 'Chúng mình đang lên mẫu mới — quay lại sau nhé.',
    // Pagination. {page}/{total} are pre-formatted number strings (formatVnNumber) at the call site.
    paginationLabel: 'Phân trang',
    paginationPrev: 'Trang trước',
    paginationNext: 'Trang sau',
    paginationGoTo: 'Tới trang {page}',
    paginationCurrent: 'Trang {page}, trang hiện tại',
    paginationStatus: 'Trang {page} / {total}',
  },
  productDetail: {
    // Breadcrumb landmark name — MUST differ from nav.primaryNav (which names BottomNav, mounted on
    // every page): two <nav> landmarks sharing a name breaks landmark navigation on mobile (WCAG 1.3.1).
    breadcrumbLabel: 'Đường dẫn',
    // Section headings + spec labels. Values (dimensions, material) come from product data, formatted
    // in the component — never baked into copy here.
    descriptionHeading: 'Mô tả',
    specsHeading: 'Thông số',
    specDimensions: 'Kích thước',
    specMaterial: 'Chất liệu',
    madeToOrder: 'In theo đơn · giao trong 3–5 ngày',
    // Colour picker.
    colorsLabel: 'Màu in',
    selectColorLabel: 'Chọn màu {name}',
    colorUnavailableLabel: '{name} — tạm hết',
    // Shown under the disabled CTA to explain the lock (spec §03: khoá tới khi chọn màu).
    pickColorHint: 'Chọn màu để thêm vào giỏ nhé.',
    // Colour/option surcharges are priced at checkout (server-authoritative), not summed on the card.
    priceNote: 'Màu và tuỳ chọn được tính khi đặt hàng.',
    // Rating fallback before the first review.
    noReviews: 'Chưa có đánh giá',
    // Gallery thumbnail button label; {index} is 1-based.
    galleryThumbLabel: 'Xem ảnh {index}',
    // On-demand 3D viewer (P1-i). The button only appears when the product has a .glb and the browser
    // supports WebGL; model-viewer loads on click, not before.
    view3dLabel: 'Xem mẫu 3D',
    view3dLoading: 'Đang tải mẫu 3D…',
    view3dError: 'Chưa tải được mẫu 3D — bạn xem ảnh phía trên nhé.',
    view3dAlt: 'Mẫu 3D của {name}',
    // <title> for the detail route.
    metaTitle: '{name} — Lumin Studio',
    // 404 (unknown slug or draft/archived — uniform, no leak).
    notFoundTitle: 'Không tìm thấy sản phẩm',
    notFoundBody: 'Sản phẩm này không còn nữa, hoặc đường dẫn chưa đúng.',
    notFoundCta: 'Xem sản phẩm khác',
    // Engrave / personalize (P1-j). The field's visible label is the option's own catalog `label`;
    // these are the surrounding copy. Counter + over-limit mirror the server's rune count ({max} args).
    engravePlaceholder: 'Gõ tên — xem trước ngay bên trên',
    engravePreviewDefault: 'Tên của bạn',
    engraveFree: 'miễn phí',
    engraveCounter: '{count}/{max}',
    engraveHint: 'Tối đa {max} ký tự.',
    engraveTooLong: 'Dài quá rồi — tối đa {max} ký tự thôi nhé.',
    // Choice add-on options (P1-j). Boolean add-ons; the live total lands with the cart (P1-k).
    optionsHeading: 'Tuỳ chọn',
    optionFree: 'miễn phí',
  },
  // Product reviews section on the detail page (P1-m). Reviews are read-only in Phase 1 — no write
  // path yet — so there is no "viết đánh giá" CTA here. The reviewer's identity is never shown (PDPL —
  // the contract omits it), so there is no author-name copy.
  productReviews: {
    // Section heading (<h2> under the product <h1>).
    heading: 'Đánh giá khách',
    // Summary line under the heading. {count} is a PRE-FORMATTED number string (formatVnNumber,
    // @lumin/core) — never a raw grouped number baked here (conventions §Tiền; messages.test forbids it).
    summaryCount: '{count} đánh giá',
    // Empty state — no reviews yet. No CTA: writing a review is out of Phase-1 scope (read-only).
    empty: 'Chưa có đánh giá nào cho sản phẩm này.',
    emptyHint: 'Đánh giá của khách sẽ xuất hiện ở đây sau những đơn đầu tiên.',
    // Accessible name for one review's star group; {value} is the review's rating (1–5).
    ratingLabel: '{value} trên 5 sao',
    // Alt text for a reviewer photo thumbnail; {index} is 1-based.
    photoAlt: 'Ảnh từ khách {index}',
    // Owner reply block (Review.reply). The shop replies publicly under a review.
    replyLabel: 'Lumin Studio đã phản hồi',
    // Pager (server-rendered ?reviewsPage links). Newest reviews are page 1, so "older" pages back.
    pagerLabel: 'Trang đánh giá',
    pagerNewer: 'Mới hơn',
    pagerOlder: 'Cũ hơn',
    // Current position, e.g. "Trang 2 / 5". Both args are small page numbers (no grouping).
    pagerPosition: 'Trang {page} / {total}',
  },
  cart: {
    // <title> for /gio-hang (kept out of the index — see the route's generateMetadata).
    metaTitle: 'Giỏ hàng — Lumin Studio',
    heading: 'Giỏ hàng',
    // Item-count line under the heading. Vietnamese has no plural inflection → one form.
    itemCount: '{count} món',
    // Summary line composer: colour · add-ons · engraving. {text} is the shopper's engraving.
    engraveSummary: 'khắc "{text}"',
    // QuantityStepper aria-labels (required at the call site, never hard-coded in the primitive). At
    // quantity 1 the − button removes the line, so its label becomes the remove copy.
    decrementLabel: 'Giảm số lượng',
    incrementLabel: 'Tăng số lượng',
    removeLabel: 'Xoá {name} khỏi giỏ',
    // Summary card.
    subtotalLabel: 'Tạm tính',
    shippingNote: 'Phí ship tính theo khu vực ở bước sau.',
    // States. `unavailableError` = a line's product/colour/option is no longer valid (server 422);
    // `pricingError` = a transient failure computing the subtotal. Both offer retry.
    unavailableError: 'Một món trong giỏ không còn khả dụng — thử xoá rồi thêm lại nhé.',
    pricingError: 'Chưa tính được tạm tính — thử lại giúp mình nhé.',
    retry: 'Thử lại',
  },
  // Checkout info step /thanh-toan (C1, P2-d). Guest-first: reads the cart, collects contact + shipping
  // address (province → ward → street, NO district per ADR-017), prices it server-side with the chosen
  // province (shipping + total, never client math), and discloses the đổi-trả policy + a PDPL privacy
  // notice BEFORE purchase (compliance §2/§3). Field errors mirror the server validate() codes
  // (lib/checkout-form.ts). noindex (private). No prices baked in — formatVnd renders every total. The
  // payment step (QR + biên lai + submit) is P2-f; this owns the info step + the C2 header it hands off.
  checkout: {
    metaTitle: 'Đặt hàng — Lumin Studio',
    heading: 'Đặt hàng',
    // Empty cart → nothing to check out; send them back to the catalog.
    emptyTitle: 'Chưa có gì để đặt',
    emptyBody: 'Thêm một món vào giỏ rồi quay lại đặt hàng nhé.',
    emptyCta: 'Khám phá bộ sưu tập',
    // Order summary (top of C1 + header of C2). Vietnamese has one plural form.
    summaryItemCount: '{count} món',
    subtotalLabel: 'Tạm tính',
    shippingLabel: 'Phí ship',
    totalLabel: 'Tổng cộng',
    // Before a province is chosen the fee is unknown — the server, not the client, computes it.
    shippingPending: 'Chọn tỉnh/thành để tính phí ship',
    contactHeading: 'Thông tin liên hệ',
    emailLabel: 'Email',
    optional: '(tuỳ chọn)',
    emailPlaceholder: 'email của bạn',
    nameLabel: 'Họ tên',
    namePlaceholder: 'tên của bạn',
    phoneLabel: 'Số điện thoại',
    phonePlaceholder: '0912 345 678',
    addressHeading: 'Địa chỉ giao hàng',
    provinceLabel: 'Tỉnh / thành',
    provincePlaceholder: 'Chọn tỉnh/thành',
    wardLabel: 'Phường / xã',
    wardPlaceholder: 'phường/xã của bạn',
    streetLabel: 'Địa chỉ',
    streetPlaceholder: 'số nhà, tên đường…',
    noteLabel: 'Ghi chú',
    notePlaceholder: 'VD: giao giờ hành chính…',
    // Đổi-trả disclosure — shown for EVERY cart before purchase (compliance §3, Luật BVNTD 19/2023). The
    // short blurb comes from settings.refund_policy (config); `refundFallback` covers a shop that left it
    // blank so the section is never empty. The link opens the full policy page.
    refundHeading: 'Đổi trả & huỷ đơn',
    refundFallback:
      'Hàng in theo đơn, có khắc tên hoặc làm riêng, không đổi trả vì đổi ý. Lỗi do shop thì chúng mình in lại hoặc hoàn tiền cho bạn.',
    refundLink: 'Xem chính sách đổi trả đầy đủ',
    // Engrave add-on (ADR-012) — shown only when the cart has engraving. Echoes the text for a last
    // check, states the prepay rule, and the two required acks (no-return + echo-correct) that gate
    // "continue". Mirrors the server's dual-ack at checkout.go:241.
    engraveHeading: 'Xác nhận nội dung khắc',
    engraveEchoIntro: 'Bạn đang khắc:',
    engraveEchoLine: '{name} · khắc "{text}"',
    prepayNote: 'Hàng khắc theo yêu cầu nên chúng mình cần bạn chuyển khoản đủ trước khi in nhé.',
    ackNoReturn:
      'Mình hiểu hàng khắc theo yêu cầu không đổi trả vì đổi ý (shop vẫn in lại nếu lỗi).',
    ackEcho: 'Mình đã kiểm tra, nội dung khắc ở trên là chính xác.',
    // Nudge next to the disabled "continue" button when an engraved cart hasn't ticked both acks.
    ackHint: 'Tích hai ô xác nhận hàng khắc phía trên để tiếp tục nhé.',
    // PDPL privacy notice — informational, unbundled, no marketing tick (compliance §2). Consent to
    // process the order is contract-basis (granted server-side at order creation), not a gate here.
    privacyNotice:
      'Chúng mình dùng tên, số điện thoại và địa chỉ của bạn chỉ để xử lý và giao đơn.',
    privacyLink: 'Thông báo quyền riêng tư',
    continueCta: 'Tiếp tục thanh toán',
    // Payment step (C2) header rendered by this PR; P2-f adds QR + biên lai + submit below. Composed
    // lines are ICU (not literal JSX separators) so no-literal-string stays clean and word order stays
    // translatable. Address order = street → ward → province (specific → general, ADR-017 no district).
    deliverToLabel: 'Giao cho',
    recipientLine: '{name} · {phone}',
    addressLine: '{street}, {ward}, {province}',
    noteSummaryLine: 'Ghi chú: {note}',
    editLabel: 'Sửa',
    backToInfo: 'Quay lại',
    paymentPending: 'Bước thanh toán (QR chuyển khoản + gửi biên lai) sắp có ở đây.',
    // Field errors — mirror lib/checkout-form.ts codes. Surfaced under each input on submit.
    errors: {
      nameInvalid: 'Họ tên cần từ 2 đến 60 ký tự.',
      phoneInvalid: 'Số điện thoại chưa đúng — dùng số di động Việt Nam nhé.',
      emailInvalid: 'Email chưa đúng — kiểm tra lại giúp mình nhé.',
      provinceRequired: 'Chọn tỉnh/thành giúp mình nhé.',
      wardRequired: 'Nhập phường/xã giúp mình nhé.',
      streetRequired: 'Nhập địa chỉ giao hàng giúp mình nhé.',
      // Form-level: shown when submit is blocked by one or more field errors.
      formError: 'Kiểm tra lại thông tin giúp mình nhé.',
    },
    // Shipping/total quote states once a province is chosen.
    noShippingRule: 'Chúng mình chưa giao tới tỉnh/thành này — chọn nơi khác giúp mình nhé.',
    unavailableError: 'Một món trong giỏ không còn khả dụng — thử xoá rồi thêm lại nhé.',
    pricingError: 'Chưa tính được phí ship — thử lại giúp mình nhé.',
    retry: 'Thử lại',
  },
  badge: {
    featured: 'Nổi bật',
    new: 'Mới',
    lowStock: 'Sắp hết',
  },
  trust: {
    heading: 'Vì sao chọn Lumin?',
    madeToOrderTitle: 'In theo đơn',
    madeToOrderBody: 'Mỗi món in riêng khi bạn đặt — chọn màu, khắc tên, không đại trà.',
    recycledTitle: 'Vật liệu tái chế',
    recycledBody: 'Nhựa sinh học rPLA tái chế, ấm tay và thân thiện môi trường.',
    reprintTitle: 'In lại miễn phí',
    reprintBody: 'Lỡ lỗi do shop? Chúng mình in lại cho bạn, miễn phí.',
  },
  footer: {
    tagline: 'Đèn & đồ in 3D theo đơn — ấm, tái chế, không đại trà.',
    shopHeading: 'Mua sắm',
    shopCategories: 'Danh mục',
    shopNew: 'Mới về',
    shopBestsellers: 'Bán chạy',
    supportHeading: 'Hỗ trợ',
    supportOrderLookup: 'Tra cứu đơn',
    supportReturns: 'Chính sách đổi trả',
    supportContact: 'Liên hệ',
    aboutHeading: 'Về Lumin',
    aboutStory: 'Câu chuyện',
    aboutReviews: 'Đánh giá',
    copyright: '© 2026 Lumin Studio · in 3D theo đơn tại Việt Nam',
  },
  states: {
    loading: 'Đang tải…',
    errorTitle: 'Có gì đó chưa ổn',
    errorBody: 'Mất kết nối một chút — thử lại giúp mình nhé.',
    retry: 'Thử lại',
  },
  // Guest order lookup /tra-cuu-don (P1-o). The tracker: a code + phone form → a status timeline with
  // auto-poll. Status LABELS come from @lumin/core (core.orderStatus.*, shared with the account P1-s);
  // this is the surrounding screen copy. noindex (private, per-order). Sentence case, warm voice.
  lookup: {
    // <title> — kept out of the index (see the route's generateMetadata robots).
    metaTitle: 'Tra cứu đơn — Lumin Studio',
    heading: 'Tra cứu đơn',
    intro: 'Nhập mã đơn và số điện thoại đặt hàng để xem tình trạng đơn nhé.',
    codeLabel: 'Mã đơn',
    // A code SAMPLE, not a real total — plain digits, no grouping (messages.test forbids grouped numbers).
    codePlaceholder: 'VD: #LMN-1000',
    phoneLabel: 'Số điện thoại',
    phonePlaceholder: '0912 345 678',
    submit: 'Tra cứu',
    // Both fields are required — client guard before the round-trip (and before the rate budget).
    formError: 'Nhập cả mã đơn và số điện thoại giúp mình nhé.',
    // Loading (first lookup in flight).
    searching: 'Đang tìm đơn…',
    // Result header. {code} is the order code the guest supplied (echoed back, e.g. "#LMN-1000").
    resultHeading: 'Đơn {code}',
    timelineHeading: 'Trạng thái',
    // Visually-hidden marker appended to the current step in the timeline.
    currentStep: 'bước hiện tại',
    // Auto-poll affordance: `live` while updating, `paused` after the 10-minute ceiling (with refresh).
    live: 'Đang tự cập nhật tình trạng…',
    paused: 'Đã tạm dừng tự cập nhật — bấm làm mới để xem tình trạng mới nhất.',
    refresh: 'Làm mới',
    // Carrier waybill — shown once the order is shipping (contract surfaces it from SHIPPING onward).
    trackingLabel: 'Mã vận đơn',
    // Close-state notes (the order left the happy path). The status pill carries the name.
    cancelledNote: 'Đơn này đã huỷ. Cần hỗ trợ thì liên hệ shop giúp mình nhé.',
    refundedNote: 'Đơn này đã được hoàn tiền. Cần hỗ trợ thì liên hệ shop giúp mình nhé.',
    // Not found — uniform for an unknown code OR a phone mismatch (no enumeration signal, ADR-032).
    notFoundTitle: 'Không tìm thấy đơn khớp',
    notFoundBody:
      'Kiểm tra lại mã đơn và số điện thoại giúp mình, hoặc liên hệ shop để được hỗ trợ nhé.',
    contactCta: 'Liên hệ shop',
    // Rate limited — too many lookups on one code in a short window (server 429).
    rateLimitedTitle: 'Thử lại sau một chút nhé',
    rateLimitedBody: 'Mình nhận hơi nhiều lượt tra cho mã này — chờ một lát rồi thử lại giúp mình.',
    // Generic transient error (network / 5xx). Offers retry.
    errorTitle: 'Có gì đó chưa ổn',
    errorBody: 'Mất kết nối một chút — thử lại giúp mình nhé.',
    retry: 'Thử lại',
  },
  // Analytics consent banner (P1-p, PDPL / ADR-015). Umami loads ONLY after "Đồng ý"; refusing is one
  // equal-weight click and never blocks shopping (compliance §Consent). Body names what we do NOT do
  // (no keystroke/session-replay tracking) so the notice is honest. Sentence case, warm voice.
  consent: {
    title: 'Về quyền riêng tư của bạn',
    body: 'Chúng mình dùng số liệu ẩn danh để hiểu cách mọi người dùng web và cải thiện trải nghiệm — không ghi lại thao tác gõ hay quay màn hình của bạn. Từ chối vẫn mua sắm bình thường nhé.',
    accept: 'Đồng ý',
    decline: 'Từ chối',
  },
  // Customer account + order history (/tai-khoan, P1-s). The auth realm is SEPARATE from admin (ADR-030):
  // register/login/logout set an httpOnly session cookie; the hub reads GET /customer/orders and reuses the
  // guest P1-o timeline (status LABELS from @lumin/core, shared). noindex (private, per-customer). Scope is
  // only what the P1-r backend ships — no OAuth / magic-link / forgot-password / addresses (no endpoint yet).
  account: {
    // <title> + hub heading. `greeting` shows the signed-in name (from the profile cookie); `heading` is
    // the fallback when that cookie is missing/corrupt (auth still valid — the greeting is display-only).
    metaTitle: 'Tài khoản — Lumin Studio',
    heading: 'Tài khoản của bạn',
    greeting: 'Chào {name} 🧡',
    logout: 'Đăng xuất',
    // Order-history section.
    ordersHeading: 'Đơn hàng của tôi',
    // Row: when the order was placed. {date} is formatted by @lumin/core (formatVnDate) — never baked.
    orderedOn: 'Đặt ngày {date}',
    // Empty history — CTA into the catalog.
    emptyTitle: 'Bạn chưa có đơn nào',
    emptyBody: 'Khi bạn đặt món đầu tiên, đơn sẽ hiện ở đây để bạn theo dõi.',
    emptyCta: 'Khám phá sản phẩm',
    // Error fetching history (network / 5xx) — offers a reload.
    errorTitle: 'Có gì đó chưa ổn',
    errorBody: 'Chưa tải được đơn của bạn — thử lại giúp mình nhé.',
    retry: 'Thử lại',
    // Loading (a11y status while the hub fetch is in flight).
    loading: 'Đang tải tài khoản…',
    // Logged-out / expired-session hub panel (no session cookie, or core-api rejected it).
    loggedOutTitle: 'Đăng nhập để xem đơn của bạn',
    loggedOutBody:
      'Đăng nhập để theo dõi đơn hàng, hoặc tra cứu nhanh bằng mã đơn và số điện thoại nhé.',
    loginCta: 'Đăng nhập',
    registerCta: 'Tạo tài khoản',
    // Login screen (/tai-khoan/dang-nhap).
    login: {
      metaTitle: 'Đăng nhập — Lumin Studio',
      heading: 'Chào mừng quay lại 🧡',
      intro: 'Đăng nhập để xem đơn hàng của bạn.',
      emailLabel: 'Email',
      emailPlaceholder: 'email của bạn',
      passwordLabel: 'Mật khẩu',
      passwordPlaceholder: '••••••••',
      submit: 'Đăng nhập',
      noAccount: 'Chưa có tài khoản?',
      registerLink: 'Tạo tài khoản',
      guestLookup: 'Tra cứu đơn không cần đăng nhập',
      errors: {
        // Both fields required — client guard before the round-trip.
        formError: 'Nhập email và mật khẩu giúp mình nhé.',
        // Uniform for unknown email OR wrong password (no enumeration — ADR-030).
        invalidCredentials: 'Email hoặc mật khẩu chưa đúng.',
        validation: 'Thông tin đăng nhập chưa hợp lệ.',
        networkError: 'Mất kết nối một chút — thử lại giúp mình nhé.',
      },
    },
    // Register screen (/tai-khoan/dang-ky).
    register: {
      metaTitle: 'Tạo tài khoản — Lumin Studio',
      heading: 'Tạo tài khoản',
      intro: 'Tạo tài khoản để lưu và theo dõi đơn hàng của bạn.',
      nameLabel: 'Họ tên',
      namePlaceholder: 'tên của bạn',
      emailLabel: 'Email',
      emailPlaceholder: 'email',
      phoneLabel: 'Số điện thoại',
      phonePlaceholder: '0912 345 678',
      passwordLabel: 'Mật khẩu',
      passwordPlaceholder: '••••••••',
      passwordHint: 'Ít nhất 8 ký tự.',
      submit: 'Tạo tài khoản',
      haveAccount: 'Đã có tài khoản?',
      loginLink: 'Đăng nhập',
      errors: {
        formError: 'Điền đủ các ô giúp mình nhé.',
        nameInvalid: 'Họ tên cần từ 2 đến 60 ký tự.',
        passwordTooShort: 'Mật khẩu cần ít nhất 8 ký tự.',
        // The one register field-error safe to surface (the login email is already registered).
        emailTaken: 'Email này đã có tài khoản. Bạn thử đăng nhập nhé.',
        validation: 'Thông tin chưa hợp lệ — kiểm tra lại giúp mình nhé.',
        networkError: 'Mất kết nối một chút — thử lại giúp mình nhé.',
      },
    },
  },
  // Legal / policy destination page (/chinh-sach, P2-h). One public, indexable page with two
  // deep-linkable sections: return/exchange policy (Luật BVNTD 19/2023, ADR-012) at #doi-tra, and the
  // PDPL privacy notice — thu gì / mục đích / lưu bao lâu / quyền (compliance §2) — at #quyen-rieng-tu.
  // The consent link + đổi-trả pre-purchase link in checkout (P2-d) point here. Static i18n prose (no
  // runtime fetch): a legal page must render even when the API is down; the shorter refundPolicy blurb
  // (settings.refund_policy) is rendered inline at checkout, this is the full policy. `version` MUST
  // stay in sync with core-api's consentPolicyVersion ("2026-01", checkout.go) — a drift means a
  // customer consents under a version whose notice text they can't read. Sentence case, warm voice.
  chinhSach: {
    metaTitle: 'Chính sách đổi trả & quyền riêng tư — Lumin Studio',
    metaDescription:
      'Chính sách đổi trả, huỷ đơn và cách Lumin Studio thu thập, dùng và bảo vệ dữ liệu cá nhân của bạn.',
    heading: 'Chính sách của chúng mình',
    intro:
      'Trang này gộp chính sách đổi trả và thông báo quyền riêng tư của Lumin Studio. Có gì chưa rõ, bạn cứ nhắn shop nhé.',
    // Machine version — asserted in test/messages.test.ts; keep in sync with consentPolicyVersion.
    version: '2026-01',
    updated: 'Phiên bản chính sách: tháng 1 năm 2026',
    returns: {
      heading: 'Đổi trả & huỷ đơn',
      madeToOrder:
        'Mỗi món ở Lumin đều được in theo đơn của bạn — chúng mình không giữ sẵn hàng. Vì vậy chính sách đổi trả có chút khác với hàng bán đại trà, và mình muốn nói rõ trước khi bạn đặt.',
      standardHeading: 'Hàng in theo mẫu có sẵn',
      standard:
        'Với món in theo mẫu tiêu chuẩn (không khắc tên, không tuỳ biến riêng), nếu hàng bị lỗi hoặc không đúng mô tả, bạn báo cho chúng mình trong vòng bảy ngày kể từ khi nhận để được đổi hoặc hoàn tiền.',
      personalizedHeading: 'Hàng cá nhân hoá / khắc tên',
      personalized:
        'Món có khắc tên hoặc làm riêng theo yêu cầu được sản xuất riêng cho bạn nên không đổi trả vì đổi ý — bạn xác nhận điều này trước khi thanh toán. Nhưng nếu lỗi do chúng mình (in sai nội dung đã xác nhận, hàng lỗi kỹ thuật), chúng mình in lại hoặc hoàn tiền cho bạn, miễn phí.',
      echo: 'Trước khi thanh toán, bạn sẽ thấy lại đúng nội dung khắc để kiểm tra một lần nữa — bước này để chắc chắn tên và chính tả đúng ý bạn.',
      prepayHeading: 'Thanh toán',
      prepay:
        'Đơn khắc tên trả đủ trước qua chuyển khoản VietQR, không thu tiền khi nhận hàng. Bạn đính ảnh biên lai để chúng mình xác nhận rồi mới vào xưởng in.',
      howToHeading: 'Cần đổi trả?',
      howTo:
        'Bạn nhắn shop kèm mã đơn và mô tả vấn đề, tốt nhất là có ảnh. Chúng mình sẽ phản hồi và hướng dẫn các bước tiếp theo.',
    },
    privacy: {
      heading: 'Quyền riêng tư của bạn',
      intro:
        'Chúng mình chỉ thu thập những thông tin cần để làm và giao đơn cho bạn, và giữ chúng cẩn thận. Dưới đây là chi tiết.',
      collectHeading: 'Chúng mình thu thập gì',
      // Keyed object (not an array) — next-intl's message type rejects arrays; rendered via Object.values.
      collectItems: {
        name: 'Tên của bạn — để ghi đơn và giao hàng.',
        phone: 'Số điện thoại — để liên hệ về đơn và giao hàng.',
        email: 'Email (nếu bạn cung cấp) — để gửi cập nhật về đơn.',
        address: 'Địa chỉ giao hàng (tỉnh, phường/xã, đường) — để tính phí ship và giao đến bạn.',
      },
      purposeHeading: 'Dùng để làm gì',
      purpose:
        'Chúng mình dùng thông tin này để xử lý đơn, giao hàng và liên hệ với bạn về đơn. Chúng mình không bán dữ liệu của bạn cho bên thứ ba.',
      marketingHeading: 'Marketing',
      marketing:
        'Chúng mình chỉ gửi tin khuyến mãi nếu bạn đồng ý riêng — việc này tách khỏi việc đặt hàng và không bao giờ tích sẵn. Bạn có thể rút đồng ý bất cứ lúc nào.',
      retentionHeading: 'Lưu bao lâu',
      retention:
        'Chúng mình giữ dữ liệu đơn trong thời gian cần cho việc bán hàng và nghĩa vụ sổ sách, sau đó xoá hoặc ẩn danh. Dữ liệu được lưu trên máy chủ đặt tại Việt Nam.',
      rightsHeading: 'Quyền của bạn',
      rightsItems: {
        access: 'Xem thông tin cá nhân chúng mình đang giữ về bạn.',
        rectify: 'Yêu cầu sửa thông tin chưa đúng.',
        erase: 'Yêu cầu xoá hoặc xuất dữ liệu của bạn.',
        withdraw: 'Rút lại đồng ý marketing bất cứ lúc nào.',
      },
      analyticsHeading: 'Số liệu khi bạn duyệt web',
      analytics:
        'Chúng mình dùng số liệu ẩn danh để hiểu cách mọi người dùng web và cải thiện trải nghiệm. Chúng mình không ghi lại thao tác gõ phím hay quay lại màn hình của bạn, và số liệu chỉ chạy khi bạn đồng ý.',
      contactHeading: 'Liên hệ & thực hiện quyền',
      contact:
        'Để xem, sửa, xoá, xuất dữ liệu hoặc hỏi về quyền riêng tư, bạn nhắn shop nhé — chúng mình sẽ hỗ trợ bạn.',
    },
  },
} as const;

export type StorefrontMessages = typeof vi;
