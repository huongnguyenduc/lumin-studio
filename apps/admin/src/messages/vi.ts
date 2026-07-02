// Admin chrome microcopy (default locale `vi`). Sentence case, warm voice ("chúng mình / bạn")
// per CLAUDE.md §6 + conventions §Giọng. Domain microcopy (order-state/validation) lives in
// @lumin/core and is merged under the `core` namespace (see ./index.ts). ICU args: {name}, {value}.
// NO prices are baked into copy — money is always formatted by @lumin/core's formatVnd at render
// time (enforced by test/messages.test.ts). Decorative glyphs (🧡) are folded into a string value,
// never a bare JSX text node (conventions §A11y / eslint i18next).
export const vi = {
  meta: {
    title: 'Lumin Studio — bảng quản trị',
    description: 'Quản lý đơn hàng, hàng đợi in, sản phẩm và đánh giá của Lumin Studio.',
  },
  nav: {
    brand: 'Lumin',
    adminLabel: 'admin',
    sidebar: 'Điều hướng quản trị',
    skipToContent: 'Tới nội dung chính',
    overview: 'Tổng quan',
    orders: 'Đơn hàng',
    printQueue: 'Hàng đợi in',
    products: 'Sản phẩm',
    categories: 'Danh mục',
    reviews: 'Đánh giá',
    materials: 'Vật tư',
    customers: 'Khách hàng',
    settings: 'Cài đặt',
  },
  topbar: {
    greeting: 'Chào buổi sáng, Lumin 🧡',
    profileLabel: 'Hồ sơ của bạn',
  },
  dashboard: {
    newOrdersToday: 'Đơn mới hôm nay',
    revenueToday: 'Doanh thu hôm nay',
    printing: 'Đang in',
    reviewsWaiting: 'Đánh giá chờ trả lời',
    needsAttention: 'Cần chú ý',
    recentOrders: 'Đơn hàng gần đây',
    viewAll: 'Xem tất cả',
    colCode: 'Mã',
    colCustomer: 'Khách',
    colTotal: 'Tổng',
    colStatus: 'Trạng thái',
    ordersEmpty: 'Chưa có đơn nào hôm nay — chúng mình cùng chờ đơn đầu tiên nhé.',
    ordersEmptyCta: 'Xem tất cả đơn',
    todo: 'Cần xử lý',
    todoPendingConfirm: 'đơn chờ xác nhận',
    todoReviews: 'đánh giá chờ trả lời',
    todoPaidWaitingPrint: 'đơn đã thanh toán, chờ in',
  },
  status: {
    PENDING_CONFIRM: 'Chờ xác nhận',
    PAID: 'Đã thanh toán',
    PRINTING: 'Đang in',
    SHIPPING: 'Đang giao',
    COMPLETED: 'Hoàn tất',
    CANCELLED: 'Đã huỷ',
    REFUNDED: 'Đã hoàn tiền',
  },
  states: {
    loading: 'Đang tải…',
    errorTitle: 'Có gì đó chưa ổn',
    errorBody: 'Mất kết nối một chút — thử lại giúp mình nhé.',
    retry: 'Thử lại',
  },
} as const;

export type AdminMessages = typeof vi;
