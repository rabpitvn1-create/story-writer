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

async function initDatabase(defaultCodex, defaultSettings) {
  const migrated = await getSetting('migrated_v1', false);
  if (migrated) return;

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
        updatedAt: doc.updatedAt || Date.now()
      });
    }
  } catch {
    // Bỏ qua nếu không có dữ liệu cũ
  }

  // Khởi tạo cấu hình API & Budget mặc định
  await setSetting('apiConfig', {
    freeOnlyMode: false,
    dailyCap: 100,
    claudeModel: 'claude-sonnet-5-5',
    geminiWriterModel: 'gemini-2.5-flash',
    geminiUtilityModel: 'gemini-2.5-flash-lite'
  });

  await setSetting('migrated_v1', true);
}

window.StoryDB = {
  db,
  getSetting,
  setSetting,
  initDatabase
};
