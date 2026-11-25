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
async function selectKey(lane, freeOnlyMode) {
  const pool = await refreshExpiredCooldowns();
  const activeKeyId = await window.StoryDB.getSetting(`sticky_${lane}`, null);

  const allowedProviders = freeOnlyMode ? ['gemini'] : ['gemini', 'claude'];

  for (const provider of allowedProviders) {
    const readyList = pool.filter((k) => k.provider === provider && k.status === 'ready');
    if (readyList.length === 0) continue;

    const sticky = readyList.find((k) => k.id === activeKeyId);
    const chosen = sticky || readyList[0];
    await window.StoryDB.setSetting(`sticky_${lane}`, chosen.id);
    return chosen;
  }

  return null;
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
  getEarliestReadyTime
};
