const COOLDOWN_24H_MS = 24 * 60 * 60 * 1000;

async function getPool() {
  return window.StoryDB.db.keyPool.toArray();
}

async function addKey({ provider, label, apiKey }) {
  return window.StoryDB.db.keyPool.add({
    provider,
    label: label.trim() || (provider === 'claude' ? 'Claude Sonnet' : 'Gemini Free'),
    apiKey: apiKey.trim(),
    status: 'ready',
    cooldownUntil: null,
    requestsToday: 0,
    lastUsedAt: 0
  });
}

async function removeKey(id) {
  await window.StoryDB.db.keyPool.delete(id);
}

async function refreshExpiredCooldowns() {
  const now = Date.now();
  const pool = await getPool();
  const updates = [];

  for (const item of pool) {
    if (item.status === 'cooldown' && item.cooldownUntil && now >= item.cooldownUntil) {
      updates.push(
        window.StoryDB.db.keyPool.update(item.id, {
          status: 'ready',
          cooldownUntil: null,
          requestsToday: 0
        })
      );
    }
  }
  if (updates.length > 0) await Promise.all(updates);
  return getPool();
}

async function markCooldown24h(keyId) {
  await window.StoryDB.db.keyPool.update(keyId, {
    status: 'cooldown',
    cooldownUntil: Date.now() + COOLDOWN_24H_MS
  });
}

async function recordKeySuccess(keyId) {
  const item = await window.StoryDB.db.keyPool.get(keyId);
  if (!item) return;
  await window.StoryDB.db.keyPool.update(keyId, {
    requestsToday: (item.requestsToday || 0) + 1,
    lastUsedAt: Date.now()
  });
}

// Thứ tự ưu tiên cho CẢ HAI LÀN ('writer' và 'utility'):
// - Free trước: thử pool Gemini miễn phí trước, chỉ dùng Claude khi tất cả key Gemini cạn/cooldown
// - Nếu bật freeOnlyMode: chỉ dùng ['gemini'], hết Gemini thì dừng đợi
// - Tự quay lại Gemini ngay khi có bất kỳ key Gemini nào hết cooldown 24h
// - Chuyển tay giữa chương: nguồn bị bỏ qua xếp cuối danh sách (deprioritized), không loại trừ
async function getEligibleKeys(lane, freeOnlyMode) {
  const freeOnly =
    typeof freeOnlyMode === 'boolean'
      ? freeOnlyMode
      : Boolean((await window.StoryDB.getSetting('apiConfig', {}))?.freeOnlyMode);
  const pool = await refreshExpiredCooldowns();
  const allowedProviders = freeOnly ? ['gemini'] : ['gemini', 'claude'];
  const rank = (k) => {
    const i = allowedProviders.indexOf(k.provider);
    return i === -1 ? allowedProviders.length : i;
  };
  return pool
    .filter((k) => allowedProviders.includes(k.provider) && k.status === 'ready')
    .sort((a, b) => rank(a) - rank(b));
}

// Đếm số nguồn khả dụng (để nút "Đổi API" chỉ hiện khi có ≥ 2 nguồn)
async function countAvailableSources(lane, freeOnlyMode) {
  const eligible = await getEligibleKeys(lane, freeOnlyMode);
  return new Set(eligible.map((k) => `${k.provider}:${k.id}`)).size;
}

async function selectKey(lane, freeOnlyMode, options = {}) {
  const eligible = await getEligibleKeys(lane, freeOnlyMode);
  if (eligible.length === 0) return null;

  const deprioritizedSet = new Set(
    (Array.isArray(options?.deprioritized) ? options.deprioritized : []).map((s) => String(s || '').trim())
  );
  // shortcut: không ghi sticky khi đã chuyển tay trong chương (chặn rò sang chương sau)
  const persistSticky = options?.persistSticky !== false;

  const ordered = [
    ...eligible.filter((k) => !deprioritizedSet.has(`${k.provider}:${k.id}`)),
    ...eligible.filter((k) => deprioritizedSet.has(`${k.provider}:${k.id}`))
  ];

  const stickyId = persistSticky ? await window.StoryDB.getSetting(`sticky_${lane}`, null) : null;
  let chosen = null;
  if (stickyId != null) {
    // Đọc cả 2 định dạng sticky: id trần (bản cũ) và "provider:id" (bản mới)
    chosen =
      ordered.find(
        (k) =>
          (String(k.id) === String(stickyId) || `${k.provider}:${k.id}` === String(stickyId)) &&
          !deprioritizedSet.has(`${k.provider}:${k.id}`)
      ) || null;
  }
  if (!chosen) chosen = ordered[0] || null;
  if (chosen && persistSticky) {
    await window.StoryDB.setSetting(`sticky_${lane}`, `${chosen.provider}:${chosen.id}`);
  }
  return chosen;
}

async function getEarliestReadyTime(lane, freeOnlyMode) {
  const pool = await getPool();
  const allowedProviders = freeOnlyMode ? ['gemini'] : ['gemini', 'claude'];
  const candidates = pool.filter(
    (k) => allowedProviders.includes(k.provider) && k.status === 'cooldown' && k.cooldownUntil
  );
  if (candidates.length === 0) return null;
  return Math.min(...candidates.map((k) => k.cooldownUntil));
}

window.KeyPoolManager = {
  getPool,
  addKey,
  removeKey,
  refreshExpiredCooldowns,
  markCooldown24h,
  recordKeySuccess,
  selectKey,
  countAvailableSources,
  getEarliestReadyTime
};
