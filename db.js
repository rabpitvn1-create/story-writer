const db = new Dexie('StoryWriterDB');

db.version(1).stores({
  settings: 'key',
  characters: 'name',
  worldRules: '++id, type',
  chapters: 'number',
  summaries: 'chapterNumber',
  ledger: 'key',
  keyPool: '++id, provider, status'
});

const LEGACY_KEYS = {
  settings: 'story_writer_settings_v1',
  codex: 'story_writer_mock_codex_v1',
  docx: 'story_writer_docx_raw_v1'
};

async function getSetting(key, fallback = null) {
  const row = await db.settings.get(key);
  return row ? row.value : fallback;
}

async function setSetting(key, value) {
  await db.settings.put({ key, value });
}

async function upgradeDeprecatedGeminiModels() {
  const cfg = await getSetting('apiConfig', null);
  if (!cfg) return;
  let changed = false;
  if (cfg.geminiWriterModel === 'gemini-2.5-flash' || cfg.geminiWriterModel === 'gemini-3.8-flash') {
    cfg.geminiWriterModel = 'gemini-3.6-flash';
    changed = true;
  }
  if (cfg.geminiUtilityModel === 'gemini-2.5-flash-lite') {
    cfg.geminiUtilityModel = 'gemini-3.5-flash-lite';
    changed = true;
  }
  if (changed) await setSetting('apiConfig', cfg);
}

const BUILT_IN_PROXIES = [
  { provider: 'gemini', label: 'Gemini Proxy (miễn phí)', baseUrl: 'https://backrooms-gemini-proxy-v2.onrender.com' },
  { provider: 'claude', label: 'Premium Proxy (Claude)', baseUrl: 'https://backrooms-premium-proxy.onrender.com', model: 'occ/claude-haiku-5-5' }
];

// Proxy có sẵn trong app, không cần nhập key — thêm 1 lần, lần sau mở app thấy đã có thì thôi
async function seedBuiltInProxies() {
  const pool = await db.keyPool.toArray();
  for (const p of BUILT_IN_PROXIES) {
    if (!pool.some((k) => k.baseUrl === p.baseUrl)) {
      await db.keyPool.add({ ...p, apiKey: '', builtIn: true, status: 'ready', cooldownUntil: null, requestsToday: 0, lastUsedAt: 0 });
    }
  }
}

async function initDatabase(defaultCodex, defaultSettings) {
  await seedBuiltInProxies();
  const migrated = await getSetting('migrated_v1', false);
  if (migrated) {
    await upgradeDeprecatedGeminiModels();
    return;
  }

  // 1. Migrate settings đọc sách
  try {
    const rawSettings = localStorage.getItem(LEGACY_KEYS.settings);
    const parsed = rawSettings ? { ...defaultSettings, ...JSON.parse(rawSettings) } : defaultSettings;
    await setSetting('reader', parsed);
  } catch {
    await setSetting('reader', defaultSettings);
  }

  // 2. Migrate codex nhân vật mẫu / nhập tay
  try {
    const rawCodex = localStorage.getItem(LEGACY_KEYS.codex);
    const codexObj = rawCodex ? JSON.parse(rawCodex) : defaultCodex;
    const rows = Object.values(codexObj).map((c) => ({
      name: c.name,
      description: c.description || '',
      portrait: c.portrait || '',
      updatedAt: Date.now()
    }));
    if (rows.length > 0) await db.characters.bulkPut(rows);
  } catch {
    const rows = Object.values(defaultCodex);
    await db.characters.bulkPut(rows);
  }

  // 3. Migrate file .docx raw đã tải ở Phần 1
  try {
    const rawDocx = localStorage.getItem(LEGACY_KEYS.docx);
    if (rawDocx) {
      const doc = JSON.parse(rawDocx);
      await db.worldRules.add({
        type: 'raw_docx',
        title: doc.fileName || 'codex.docx',
        content: doc.text || '',
        updatedAt: doc.updatedAt || new Date().getTime()
      });
    }
  } catch {
    // Bỏ qua nếu không có dữ liệu cũ
  }

  // Khởi tạo cấu hình API & Budget mặc định với gemini-3.6-flash và gemini-3.5-flash-lite
  await setSetting('apiConfig', {
    freeOnlyMode: false,
    dailyCap: 100,
    claudeModel: 'claude-sonnet-5-5',
    geminiWriterModel: 'gemini-3.6-flash',
    geminiUtilityModel: 'gemini-3.5-flash-lite'
  });

  await setSetting('migrated_v1', true);
}

window.StoryDB = {
  db,
  getSetting,
  setSetting,
  initDatabase
};
