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
} as const;

export type StorefrontMessages = typeof vi;
