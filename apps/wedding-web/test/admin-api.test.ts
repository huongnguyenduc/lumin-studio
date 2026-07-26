import { describe, expect, it } from 'vitest';
import { ApiError, errDetail } from '../src/lib/admin-api';

// errDetail là chuỗi người dùng chụp màn hình gửi dev — phải luôn có mã + nguyên
// văn server, và không được ném với input lạ.
describe('errDetail', () => {
  it('gộp status, code và message server', () => {
    const err = new ApiError(400, 'BAD_UPLOAD', 'size 11730944 out of range (1..10485760)');
    expect(errDetail(err)).toBe('400 BAD_UPLOAD — size 11730944 out of range (1..10485760)');
  });

  it('bỏ phần message khi server không trả', () => {
    expect(errDetail(new ApiError(503, 'UPLOADS_DISABLED'))).toBe('503 UPLOADS_DISABLED');
  });

  it('lỗi mạng / giá trị lạ vẫn ra chuỗi đọc được', () => {
    expect(errDetail(new TypeError('Failed to fetch'))).toBe('Failed to fetch');
    expect(errDetail('boom')).toBe('boom');
  });
});
