// Extension UI strings (vi = default locale). No next-intl runtime here (not a Next app) — a flat
// catalog read by a tiny t() (./index.ts). Sentence case, warm voice ("chúng mình / bạn"), no
// ALL-CAPS sentences (conventions §i18n). Adding EN later = a sibling catalog + a locale switch,
// no refactor. Keys are dot-namespaced by screen.
export const vi = {
  'app.name': 'Lumin Studio',
  'app.tagline': 'Bảng trợ lý bán hàng',
  'app.loading': 'Đang tải…',

  'login.title': 'Kết nối với cửa hàng',
  'login.subtitle': 'Đăng nhập để tạo đơn và tra cứu ngay bên khung chat nhé.',
  'login.email.label': 'Email cửa hàng',
  'login.email.placeholder': 'shop@luminstudio.vn',
  'login.password.label': 'Mật khẩu',
  'login.submit': 'Đăng nhập',
  'login.submitting': 'Đang đăng nhập…',
  'login.error.invalid': 'Email hoặc mật khẩu chưa đúng. Bạn thử lại nhé.',
  'login.error.network': 'Chưa kết nối được máy chủ. Kiểm tra mạng rồi thử lại giúp nhé.',
  'login.error.notoken': 'Máy chủ chưa cấp mã cho tiện ích. Nhờ quản trị viên kiểm tra giúp nhé.',

  'shell.connected': 'Đã kết nối',
  'shell.greeting': 'Chào {name} 👋',
  'shell.hint':
    'Mở trang Fanpage hoặc Instagram của cửa hàng, rồi dùng các thẻ dưới đây để trợ giúp bên khung chat.',
  'shell.logout': 'Đăng xuất',
  'shell.comingSoon': 'Phần này sắp có ở bước tiếp theo.',

  'nav.create': 'Tạo đơn',
  'nav.lookup': 'Tra cứu',
  'nav.templates': 'Mẫu',
} as const;

export type MessageKey = keyof typeof vi;
