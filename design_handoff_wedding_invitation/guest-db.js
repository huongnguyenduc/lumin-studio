/* Shared guest database for the Giang & Hiếu wedding invitation.
   Prototype persistence: localStorage (same browser only). Swap `load/save`
   for real API calls when deploying with a backend. */
(function () {
  const KEY = 'hg_wedding_db_v1';
  const now = Date.now();
  const H = 3600e3, D = 24 * H;
  const DEFAULT_GROUPS = ['Nhà gái', 'Nhà trai', 'Bạn cô dâu', 'Bạn chú rể', 'Đồng nghiệp', 'Bạn bè'];
  const SEED = {
    groups: DEFAULT_GROUPS.slice(),
    guests: [
      { id: 'colan',  label: 'Cô Lan & Chú Minh',    group: 'Nhà gái',      openedAt: now - 6 * D,  rsvp: 'yes', rsvpAt: now - 6 * D + H },
      { id: 'minhanh', label: 'Bạn Minh Anh',        group: 'Bạn cô dâu',   openedAt: now - 5 * D,  rsvp: 'yes', rsvpAt: now - 5 * D + 2 * H },
      { id: 'anhtuan', label: 'Anh Tuấn',            group: 'Đồng nghiệp',  openedAt: now - 4 * D,  rsvp: 'no',  rsvpAt: now - 4 * D + 5 * H },
      { id: 'chihuong', label: 'Chị Hương & Anh Dũng', group: 'Nhà trai',   openedAt: null,         rsvp: null,  rsvpAt: null },
      { id: 'bacba',  label: 'Gia đình Bác Ba',      group: 'Nhà gái',      openedAt: now - 2 * D,  rsvp: null,  rsvpAt: null },
      { id: 'quocbao', label: 'Bạn Quốc Bảo',        group: 'Bạn chú rể',   openedAt: null,         rsvp: null,  rsvpAt: null },
      { id: 'thaovy', label: 'Em Thảo Vy',           group: 'Bạn cô dâu',   openedAt: now - 26 * H, rsvp: 'yes', rsvpAt: now - 25 * H },
      { id: 'phucngan', label: 'Anh Chị Phúc – Ngân', group: 'Nhà trai',    openedAt: now - 8 * H,  rsvp: 'yes', rsvpAt: now - 7 * H }
    ],
    wishes: [
      { id: 'w1', guestId: 'phucngan', name: 'Anh Chị Phúc – Ngân', text: 'Chúc hai em trăm năm hạnh phúc, sớm có tin vui. Cả nhà mình sẽ có mặt thật sớm!', at: now - 7 * H },
      { id: 'w2', guestId: 'thaovy', name: 'Thảo Vy', text: 'Chị Giang xinh nhất hôm nay luôn! Chúc anh chị mãi ngọt ngào như ngày đầu.', at: now - 25 * H },
      { id: 'w3', guestId: 'minhanh', name: 'Minh Anh', text: 'Chúc mừng Giang & Hiếu! Mong hai bạn luôn nắm chặt tay nhau đi qua mọi mùa yêu thương.', at: now - 5 * D + 3 * H },
      { id: 'w4', guestId: 'anhtuan', name: 'Anh Tuấn', text: 'Tiếc quá anh bận công tác không về kịp. Chúc hai em hạnh phúc viên mãn, hẹn gặp dịp gần nhất!', at: now - 4 * D + 6 * H },
      { id: 'w5', guestId: 'colan', name: 'Cô Lan', text: 'Cô chúc hai con yêu thương, nhường nhịn nhau, xây tổ ấm thật bình yên nhé.', at: now - 6 * D + 2 * H }
    ]
  };
  function load() {
    try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && Array.isArray(d.guests)) { if (!Array.isArray(d.groups)) d.groups = DEFAULT_GROUPS.slice(); return d; } } catch (e) {}
    const s = JSON.parse(JSON.stringify(SEED));
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
    return s;
  }
  let subs = [];
  function notify() { subs.forEach(function (f) { try { f(); } catch (e) {} }); }
  function save(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} notify(); }
  window.addEventListener('storage', function (e) { if (e.key === KEY) notify(); });
  function uid(p) { return p + Math.random().toString(36).slice(2, 8); }
  window.WeddingDB = {
    all: load,
    subscribe: function (f) { subs.push(f); return function () { subs = subs.filter(function (x) { return x !== f; }); }; },
    getGuest: function (id) { return load().guests.find(function (g) { return g.id === id; }) || null; },
    markOpened: function (id) { const db = load(); const g = db.guests.find(function (g) { return g.id === id; }); if (g && !g.openedAt) { g.openedAt = Date.now(); save(db); } },
    setRsvp: function (id, v) { const db = load(); const g = db.guests.find(function (g) { return g.id === id; }); if (g) { g.rsvp = v; g.rsvpAt = Date.now(); save(db); } },
    addWish: function (w) { const db = load(); db.wishes.unshift({ id: uid('w'), at: Date.now(), guestId: w.guestId || null, name: w.name || 'Khách mời', text: w.text, color: w.color || null }); save(db); },
    addGuest: function (data) { const db = load(); const g = { id: uid('g'), label: 'Khách mời', group: 'Bạn bè', openedAt: null, rsvp: null, rsvpAt: null }; Object.assign(g, data); db.guests.push(g); save(db); return g.id; },
    updateGuest: function (id, patch) { const db = load(); const g = db.guests.find(function (g) { return g.id === id; }); if (g) { Object.assign(g, patch); save(db); } },
    removeGuest: function (id) { const db = load(); db.guests = db.guests.filter(function (g) { return g.id !== id; }); save(db); },
    removeWish: function (id) { const db = load(); db.wishes = db.wishes.filter(function (w) { return w.id !== id; }); save(db); },
    addGroup: function (name) { const db = load(); name = (name || '').trim(); if (!name || db.groups.indexOf(name) >= 0) return; db.groups.push(name); save(db); },
    renameGroup: function (oldName, newName) { const db = load(); newName = (newName || '').trim(); const i = db.groups.indexOf(oldName); if (i < 0 || !newName || db.groups.indexOf(newName) >= 0) return; db.groups[i] = newName; db.guests.forEach(function (g) { if (g.group === oldName) g.group = newName; }); save(db); },
    removeGroup: function (name) { const db = load(); db.groups = db.groups.filter(function (n) { return n !== name; }); db.guests.forEach(function (g) { if (g.group === name) g.group = 'Khác'; }); save(db); },
    getSettings: function () { const db = load(); return Object.assign({ mapsUrl: 'https://maps.google.com/?q=The+Mira+Central+Park+Bien+Hoa', siteTitle: 'Giang & Hiếu — Save the date', siteDesc: 'Trân trọng kính mời bạn đến chung vui cùng Giang & Hiếu · 12.09.2026', heroName: '', mapName: '', musicName: '', ogName: '', iconName: '', gallery: null }, db.settings || {}); },
    updateSettings: function (patch) { const db = load(); db.settings = Object.assign({}, db.settings || {}, patch); save(db); },
    reset: function () { try { localStorage.removeItem(KEY); } catch (e) {} load(); notify(); }
  };
})();
