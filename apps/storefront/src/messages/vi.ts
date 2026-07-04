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
} as const;

export type StorefrontMessages = typeof vi;
