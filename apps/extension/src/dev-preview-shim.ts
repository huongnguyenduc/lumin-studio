// Dev-preview shim — cho phép mở panel trong MỘT TAB THƯỜNG (`pnpm dev` → http://localhost:5178)
// để soi UI theo conventions §Visual-fidelity, không cần load-unpacked. Trong tab thường
// `chrome.storage` không tồn tại → stub in-memory 3 hàm token.ts/tabs.ts dùng + onChanged no-op
// (shell.tsx chỉ nghe deep-link của popup — tab preview không có popup). Guard kép:
// `import.meta.env.DEV` (vite build production loại hẳn khối này) + chỉ đắp khi storage VẮNG
// (side panel thật có chrome.storage → no-op). KHÔNG chạm DOM trang nào (ADR-011 nguyên vẹn).
if (import.meta.env.DEV && !globalThis.chrome?.storage) {
  const mem: Record<string, unknown> = {};
  const pick = (keys: string | string[]) => {
    const list = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(list.filter((k) => k in mem).map((k) => [k, mem[k]]));
  };
  const stub = {
    ...globalThis.chrome,
    storage: {
      local: {
        get: async (keys: string | string[]) => pick(keys),
        set: async (items: Record<string, unknown>) => {
          Object.assign(mem, items);
        },
        remove: async (keys: string | string[]) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete mem[k];
        },
      },
      onChanged: {
        addListener: () => {},
        removeListener: () => {},
      },
    },
  };
  // Stub tối thiểu cho dev-preview — cast qua unknown vì không (và không cần) đủ bề mặt @types/chrome.
  globalThis.chrome = stub as unknown as typeof chrome;
}

export {};
