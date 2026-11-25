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

// Chọn key bám dính theo Làn:
// - lane = 'writer': ưu tiên Claude (nếu không bật freeOnlyMode), hết thì rớt xuống pool Gemini
// - lane = 'utility': luôn dùng pool Gemini
async function selectKey(lane, freeOnlyMode) {
  const pool = await refreshExpiredCooldowns();
  const activeKeyId = await window.StoryDB.getSetting(`sticky_${lane}`, null);

  const allowedProviders =
    lane === 'writer' && !freeOnlyMode ? ['claude', 'gemini'] : ['gemini'];

  for (const provider of allowedProviders) {
    const readyList = pool.filter((k) => k.provider === provider && k.status === 'ready');
    if (readyList.length === 0) continue;

    // Giữ nguyên key đang dùng (sticky) nếu còn sẵn sàng
    const sticky = readyList.find((k) => k.id === activeKeyId);
    const chosen = sticky || readyList[0];
    await window.StoryDB.setSetting(`sticky_${lane}`, chosen.id);
    return chosen;
  }

  return null;
}

async function getEarliestReadyTime(lane, freeOnlyMode) {
  const pool = await getPool();
  const allowedProviders =
    lane === 'writer' && !freeOnlyMode ? ['claude', 'gemini'] : ['gemini'];
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
  getEarliestReadyTime
};
