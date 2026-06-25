// Vietnamese message catalog (default locale `vi`). Source: spec.md §05 microcopy + validation.
// Sentence case everywhere, warm voice ("chúng mình / bạn"). No hard-coded UI strings elsewhere —
// surfaces consume keys from here (next-intl ICU wiring comes with the apps). `{code}` is an ICU arg.
export const vi = {
  cart: {
    empty: 'Giỏ còn trống — mình đi ngắm bộ sưu tập nhé.',
    exploreCta: 'Khám phá bộ sưu tập',
  },
  checkout: {
    reassurance: 'Giao trong 3–5 ngày · in lại miễn phí nếu lỗi do shop',
    qrGuide:
      'Quét mã để chuyển khoản, rồi gửi ảnh biên lai và bấm xác nhận để chúng mình tạo đơn nhé. Đơn được xác nhận ngay khi chúng mình đối soát xong.',
  },
  errors: {
    network: 'Mất kết nối một chút — thử lại giúp mình nhé.',
    colorOutOfStock: 'Màu này tạm hết nhựa — chọn màu khác nha.',
  },
  validation: {
    nameRequired: 'Bạn cho mình xin tên nhé.',
    phoneInvalid: 'Số điện thoại chưa đúng định dạng.',
    emailInvalid: 'Email này nhìn chưa hợp lệ.',
    addressIncomplete: 'Vui lòng chọn đủ tỉnh, phường và đường.',
    engravingTooLong: 'Tên hơi dài so với vị trí khắc này.',
    discountExpired: 'Mã này đã hết hạn rồi.',
    orderLookupNotFound: 'Không tìm thấy đơn khớp mã và số này.',
  },
  order: {
    extensionToast: 'Đã tạo đơn {code} 🎉',
  },
} as const;

export type Messages = typeof vi;
export const messages = { vi } as const;
export const defaultLocale = 'vi' as const;
