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
          ...(item.resetRequestsAfterCooldown !== false ? { requestsToday: 0 } : {}),
          resetRequestsAfterCooldown: undefined
        })
      );
    }
  }
  if (updates.length > 0) await Promise.all(updates);
  return getPool();
}

async function markCooldown(keyId, durationMs = COOLDOWN_24H_MS) {
  await window.StoryDB.db.keyPool.update(keyId, {
    status: 'cooldown',
    cooldownUntil: Date.now() + durationMs,
    resetRequestsAfterCooldown: durationMs >= COOLDOWN_24H_MS
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

function resolveModelMode(apiConfig) {
  const mode = apiConfig?.modelMode;
  return ['auto', 'free', 'premium'].includes(mode)
    ? mode
    : apiConfig?.freeOnlyMode ? 'free' : 'auto';
}

function isAllowedSource(key, lane, modelMode) {
  if (modelMode !== 'auto' && !key.baseUrl) return false;
  if (modelMode === 'premium' && lane === 'writer') return key.provider === 'claude';
  // Free và utility ưu tiên Gemini, dùng Claude khi Gemini không khả dụng.
  return key.provider === 'gemini' || key.provider === 'claude';
}

async function getEligibleKeys(lane, modelMode) {
  const mode = modelMode ?? resolveModelMode(await window.StoryDB.getSetting('apiConfig', {}));
  const pool = await refreshExpiredCooldowns();
  return pool
    .filter((k) => isAllowedSource(k, lane, mode) && k.status === 'ready')
    .sort((a, b) => Number(a.provider === 'claude') - Number(b.provider === 'claude'));
}

// Đếm số nguồn khả dụng cho cơ chế Đổi API trong chế độ Tự động.
async function countAvailableSources(lane, modelMode) {
  const eligible = await getEligibleKeys(lane, modelMode);
  return new Set(eligible.map((k) => `${k.provider}:${k.id}`)).size;
}

async function selectKey(lane, modelMode, options = {}) {
  const mode = modelMode ?? resolveModelMode(await window.StoryDB.getSetting('apiConfig', {}));
  const eligible = await getEligibleKeys(lane, mode);
  if (eligible.length === 0) return null;
  if (mode !== 'auto') return eligible[0];

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
          k.provider === ordered[0].provider &&
          !deprioritizedSet.has(`${k.provider}:${k.id}`)
      ) || null;
  }
  if (!chosen) chosen = ordered[0] || null;
  if (chosen && persistSticky) {
    await window.StoryDB.setSetting(`sticky_${lane}`, `${chosen.provider}:${chosen.id}`);
  }
  return chosen;
}

async function getEarliestReadyTime(lane, modelMode) {
  const mode = modelMode ?? resolveModelMode(await window.StoryDB.getSetting('apiConfig', {}));
  const pool = await getPool();
  const candidates = pool.filter(
    (k) => isAllowedSource(k, lane, mode) && k.status === 'cooldown' && k.cooldownUntil
  );
  if (candidates.length === 0) return null;
  return Math.min(...candidates.map((k) => k.cooldownUntil));
}

window.KeyPoolManager = {
  getPool,
  addKey,
  removeKey,
  refreshExpiredCooldowns,
  markCooldown,
  recordKeySuccess,
  resolveModelMode,
  selectKey,
  countAvailableSources,
  getEarliestReadyTime
};
