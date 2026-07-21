import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

// Bộ ký URL imgproxy (ADR-055). Đây là code LOAD-BEARING: ký sai một byte thì
// imgproxy trả 403 cho MỌI ảnh — mà đường fail-open lại chỉ bắt trường hợp
// "thiếu env", không bắt được "ký sai". Nên test ở đây khoá cả thuật toán lẫn
// hành vi fail-open.

const KEY = '736563726574'; // hex của "secret"
const SALT = '68656c6c6f'; // hex của "hello"
const BASE = 'https://img.example.test';
const SOURCE_BASE = 'https://wedding-assets.example.test';

const ENV_KEYS = [
  'IMGPROXY_BASE_URL',
  'IMGPROXY_S3_BUCKET',
  'IMGPROXY_SOURCE_BASE_URL',
  'IMGPROXY_KEY',
  'IMGPROXY_SALT',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.IMGPROXY_BASE_URL = BASE;
  process.env.IMGPROXY_S3_BUCKET = 'wedding-assets';
  process.env.IMGPROXY_SOURCE_BASE_URL = SOURCE_BASE;
  process.env.IMGPROXY_KEY = KEY;
  process.env.IMGPROXY_SALT = SALT;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// import động: img.ts đọc process.env mỗi lần gọi, nhưng cứ nạp sau khi set env
// cho chắc, và để việc set env ở beforeEach có tác dụng với mọi thứ tự chạy.
async function load() {
  return await import('../src/lib/img');
}

describe('chữ ký imgproxy', () => {
  // Vector chính thức trong docs imgproxy (usage/signing_url). Nếu test này đỏ thì
  // KHÔNG phải sửa vector cho khớp code — là thuật toán ký đã sai.
  it('khớp test vector của imgproxy', () => {
    const path =
      '/rs:fill:300:400:0/g:sm/aHR0cDovL2V4YW1w/bGUuY29tL2ltYWdl/cy9jdXJpb3NpdHku/anBn.png';
    const h = createHmac('sha256', Buffer.from(KEY, 'hex'));
    h.update(Buffer.from(SALT, 'hex'));
    h.update(path);
    expect(h.digest('base64url')).toBe('oKfUtW34Dvo2BGQehJFR4Nr0_rIjOtdtzJ3QFsUcXH8');
  });

  it('sinh URL mà chữ ký verify lại được đúng phần path đứng sau nó', async () => {
    const { optimize } = await load();
    const out = optimize(`${SOURCE_BASE}/gallery/2026/07/abc.jpg`, [320], { fit: true });
    expect(out).toBeDefined();

    const rest = out!.src.slice(`${BASE}/`.length);
    const slash = rest.indexOf('/');
    const sig = rest.slice(0, slash);
    const path = rest.slice(slash);

    const h = createHmac('sha256', Buffer.from(KEY, 'hex'));
    h.update(Buffer.from(SALT, 'hex'));
    h.update(path);
    expect(sig).toBe(h.digest('base64url'));
  });
});

describe('dựng URL', () => {
  it('ép webp và mã hoá nguồn s3:// dạng base64url', async () => {
    const { optimize } = await load();
    const out = optimize(`${SOURCE_BASE}/gallery/2026/07/abc.jpg`, [320], { fit: true })!;
    expect(out.src).toMatch(/\.webp$/);
    const b64 = out.src.slice(out.src.lastIndexOf('/') + 1, -'.webp'.length);
    expect(Buffer.from(b64, 'base64url').toString()).toBe(
      's3://wedding-assets/gallery/2026/07/abc.jpg',
    );
  });

  it('srcSet có đủ mọi khổ kèm mô tả w', async () => {
    const { optimize } = await load();
    const out = optimize(`${SOURCE_BASE}/gallery/a.jpg`, [160, 320, 640], { fit: true })!;
    const entries = out.srcSet.split(', ');
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.split(' ')[1])).toEqual(['160w', '320w', '640w']);
    // src lấy khổ giữa — trình duyệt không hiểu srcSet vẫn không phải tải bản to nhất.
    expect(out.src).toBe(entries[1].split(' ')[0]);
  });

  it('fill kèm điểm nhấn dịch thành g:fp theo thang 0–1', async () => {
    const { optimize } = await load();
    const out = optimize(`${SOURCE_BASE}/hero.jpg`, [400], {
      aspect: 390 / 852,
      focus: { x: 25, y: 80 },
    })!;
    expect(out.src).toContain('/rs:fill:400:874:0/');
    expect(out.src).toContain('/g:fp:0.250:0.800/');
  });

  it('fit không kèm gravity (không cắt thì điểm nhấn vô nghĩa)', async () => {
    const { optimize } = await load();
    const out = optimize(`${SOURCE_BASE}/a.jpg`, [320], { fit: true, focus: { x: 10, y: 90 } })!;
    expect(out.src).toContain('/rs:fit:320:0:0/');
    expect(out.src).not.toContain('g:fp');
  });
});

describe('fail-open và giới hạn nguồn', () => {
  it('trả undefined khi chưa cấu hình (ảnh rơi về URL gốc, trang không vỡ)', async () => {
    delete process.env.IMGPROXY_KEY;
    const { optimize } = await load();
    expect(optimize(`${SOURCE_BASE}/a.jpg`, [320], { fit: true })).toBeUndefined();
  });

  it('bỏ qua ảnh mẫu static cùng origin', async () => {
    const { optimize } = await load();
    expect(optimize('/invite/g01.jpg', [320], { fit: true })).toBeUndefined();
  });

  it('bỏ qua host lạ — không biến imgproxy thành proxy cho web ngoài', async () => {
    const { optimize } = await load();
    expect(optimize('https://evil.example/x.jpg', [320], { fit: true })).toBeUndefined();
  });

  it('chặn key có traversal', async () => {
    const { optimize } = await load();
    expect(optimize(`${SOURCE_BASE}/../lumin-payment-proofs/x.jpg`, [320], {})).toBeUndefined();
  });
});

// Route `/img` là BỀ MẶT PUBLIC duy nhất của tầng ảnh — không auth, ai gọi cũng được.
// Nhánh fail-open của nó từng redirect tới bất kỳ URL nào người gọi đưa vào (open
// redirect đội lốt tên miền thiệp, lại cache 1 năm). Những test dưới đây khoá cái đó lại.
describe('route /img', () => {
  async function call(qs: string) {
    const { GET } = await import('../src/app/img/route');
    return GET(new Request(`https://giangvahieu.example/img${qs}`) as never);
  }

  it('từ chối host lạ — KHÔNG redirect (chặn open redirect)', async () => {
    const res = await call(`?u=${encodeURIComponent('https://evil.example/login')}&w=320`);
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
  });

  it('từ chối URL tương đối (không phải nguồn của mình)', async () => {
    const res = await call(`?u=${encodeURIComponent('/invite/g01.jpg')}&w=320`);
    expect(res.status).toBe(400);
  });

  it('từ chối khổ ngoài whitelist (chặn bơm biến thể phá cache)', async () => {
    const res = await call(`?u=${encodeURIComponent(`${SOURCE_BASE}/a.jpg`)}&w=321`);
    expect(res.status).toBe(400);
  });

  it('từ chối khi thiếu tham số', async () => {
    expect((await call('')).status).toBe(400);
    expect((await call(`?u=${encodeURIComponent(`${SOURCE_BASE}/a.jpg`)}`)).status).toBe(400);
  });

  it('nguồn hợp lệ → 302 sang imgproxy, cache dài', async () => {
    const res = await call(`?u=${encodeURIComponent(`${SOURCE_BASE}/a.jpg`)}&w=320`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain(BASE);
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it('chưa bootstrap → lùi về ảnh gốc nhưng cache NGẮN (không đóng băng 1 năm)', async () => {
    delete process.env.IMGPROXY_KEY;
    const res = await call(`?u=${encodeURIComponent(`${SOURCE_BASE}/a.jpg`)}&w=320`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${SOURCE_BASE}/a.jpg`);
    expect(res.headers.get('cache-control')).not.toContain('immutable');
  });
});

describe('optimizeSettings', () => {
  it('điền hero + thumb/full cho từng ảnh lưới, giữ nguyên x/y', async () => {
    const { optimizeSettings } = await load();
    const out = optimizeSettings({
      heroUrl: `${SOURCE_BASE}/hero.jpg`,
      heroX: 40,
      heroY: 10,
      gallery: [{ url: `${SOURCE_BASE}/g1.jpg`, x: 30, y: 70 }],
    });
    expect(out.hero?.srcSet).toBeTruthy();
    expect(out.gallery?.[0].thumb?.srcSet).toBeTruthy();
    expect(out.gallery?.[0].full?.srcSet).toBeTruthy();
    expect(out.gallery?.[0]).toMatchObject({ x: 30, y: 70 });
    // thumb phải nhỏ hơn full — nếu đảo thì ô lưới lại tải bản lightbox.
    expect(out.gallery?.[0].thumb?.srcSet).toContain('160w');
    expect(out.gallery?.[0].full?.srcSet).toContain('1600w');
  });

  it('không đụng gì khi chưa cấu hình', async () => {
    delete process.env.IMGPROXY_BASE_URL;
    const { optimizeSettings } = await load();
    const out = optimizeSettings({ heroUrl: `${SOURCE_BASE}/hero.jpg` });
    expect(out.hero).toBeUndefined();
    expect(out.heroUrl).toBe(`${SOURCE_BASE}/hero.jpg`);
  });
});
