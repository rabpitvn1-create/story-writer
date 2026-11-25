const SETTINGS_KEY = 'story_writer_settings_v1';
const CODEX_KEY = 'story_writer_mock_codex_v1';
const DOCX_CODEX_KEY = 'story_writer_docx_raw_v1';

// Ảnh chân dung mẫu (SVG data URI) cho Kael để thấy sẵn cách cắt avatar vuông;
// Alxece không có ảnh nên mặc định hiển thị dạng nhân vật phụ (không có ô avatar).
const SAMPLE_KAEL_PORTRAIT =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 140">
      <rect width="120" height="140" fill="#4a3d33"/>
      <circle cx="60" cy="48" r="24" fill="#d8c3ad"/>
      <path d="M22 140 C22 96, 98 96, 98 140 Z" fill="#2c241e"/>
    </svg>`
  );

const DEFAULT_CODEX = {
  Kael: {
    name: 'Kael',
    description:
      'Áo khoác vải sờn màu tro, vết sẹo nhỏ dưới xương gò má trái. Ít nói, quan sát kỹ và luôn mang theo một chiếc bật lửa đồng cạn xăng.',
    portrait: SAMPLE_KAEL_PORTRAIT
  },
  Alxece: {
    name: 'Alxece',
    description:
      'Tóc buộc gọn sau gáy, mang ba lô vải bạt cũ. Nhạy bén với âm thanh và ghi nhớ rất tốt các ký hiệu vẽ trên tường.',
    portrait: ''
  }
};

const MOCK_CHAPTER = {
  number: 1,
  blocks: [
    { type: 'narrative', text: 'Kael nói với Alxece.' },
    { type: 'dialogue', speaker: 'Kael', text: 'Tôi ở đây' },
    { type: 'dialogue', speaker: 'Alxece', text: 'Tôi biết' },
    {
      type: 'narrative',
      text: 'Ánh đèn huỳnh quang phía trên hành lang vẫn rít lên một âm thanh đều đặn. Kael khẽ gật đầu về phía khúc quanh tối mờ trước mặt, trong khi Alxece chỉnh lại quai ba lô và bước theo sát phía sau.'
    }
  ]
};

const DEFAULT_SETTINGS = {
  font: "'Lora', Georgia, serif",
  fontSize: 18
};

// Bảng Setup gu truyện (lưu vào IndexedDB, khóa 'storyPrefs')
const DEFAULT_STORY_PREFS = {
  genres: ['Kinh dị', 'Bí ẩn'],
  customGenre: '',
  drama: 'Trung bình',
  sideCharDeathRate: 'Trung bình',
  ending: 'Kết thúc mở',
  autoFullscreen: false
};

let currentStoryPrefs = { ...DEFAULT_STORY_PREFS };

function toggleFullscreen(forceOn = null) {
  const isFull = Boolean(document.fullscreenElement);
  const shouldEnter = forceOn !== null ? forceOn : !isFull;
  if (shouldEnter && !isFull && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else if (!shouldEnter && isFull && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
}

function populateSetupUI(prefs) {
  const selected = new Set(prefs.genres || []);
  document.querySelectorAll('#setup-genres input[type="checkbox"]').forEach((cb) => {
    cb.checked = selected.has(cb.value);
  });
  document.getElementById('setup-custom-genre').value = prefs.customGenre || '';
  document.getElementById('setup-fullscreen-toggle').checked = Boolean(prefs.autoFullscreen);

  const map = { drama: prefs.drama, deathRate: prefs.sideCharDeathRate, ending: prefs.ending };
  document.querySelectorAll('.seg-group').forEach((group) => {
    const val = map[group.dataset.seg];
    group.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.val === val);
    });
  });
}

function collectSetupUI() {
  const genres = Array.from(document.querySelectorAll('#setup-genres input:checked')).map((el) => el.value);
  const getSeg = (key, fallback) =>
    document.querySelector(`.seg-group[data-seg="${key}"] .seg-btn.active`)?.dataset.val || fallback;

  return {
    genres,
    customGenre: document.getElementById('setup-custom-genre').value.trim(),
    drama: getSeg('drama', 'Trung bình'),
    sideCharDeathRate: getSeg('deathRate', 'Trung bình'),
    ending: getSeg('ending', 'Kết thúc mở'),
    autoFullscreen: document.getElementById('setup-fullscreen-toggle').checked
  };
}

let codex = loadCodex();
let docxCodex = loadDocxCodex();

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  try {
    window.StoryDB.setSetting('reader', settings).catch(() => {});
  } catch {
    // Bỏ qua nếu IndexedDB chưa sẵn sàng
  }
}

function loadCodex() {
  try {
    const raw = localStorage.getItem(CODEX_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : structuredClone(DEFAULT_CODEX);
  } catch {
    return structuredClone(DEFAULT_CODEX);
  }
}

function loadDocxCodex() {
  try {
    const raw = localStorage.getItem(DOCX_CODEX_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function saveDocxCodex(doc) {
  try {
    window.StoryDB.db.worldRules.add({
      type: 'raw_docx',
      title: doc.fileName || 'codex.docx',
      content: doc.text || '',
      updatedAt: doc.updatedAt || Date.now()
    }).catch(() => {});
  } catch {
    // Bỏ qua nếu IndexedDB chưa sẵn sàng
  }
}

function renderDocxPreview(doc) {
  const statusEl = document.getElementById('docx-status');
  const wrapEl = document.getElementById('docx-preview-wrap');
  const nameEl = document.getElementById('docx-filename');
  const previewEl = document.getElementById('docx-preview');

  if (!doc) {
    statusEl.textContent = 'Chưa có file codex .docx nào được tải lên.';
    wrapEl.classList.add('hidden');
    return;
  }

  const wordCount = doc.text.trim() ? doc.text.trim().split(/\s+/).length : 0;
  statusEl.textContent = `Đã đọc xong và lưu vào codex (${wordCount} từ).`;
  nameEl.textContent = doc.fileName;
  previewEl.textContent = doc.text;
  wrapEl.classList.remove('hidden');
}

async function refreshSettingsUI() {
  const apiConfig = await window.StoryDB.getSetting('apiConfig', { freeOnlyMode: false, dailyCap: 100 });
  document.getElementById('free-only-toggle').checked = Boolean(apiConfig.freeOnlyMode);
  document.getElementById('daily-cap-input').value = apiConfig.dailyCap || 100;

  const budget = await window.RequestQueue.getBudgetState();
  document.getElementById('budget-display').textContent = `${budget.used}/${budget.cap} calls hôm nay`;

  const pool = await window.KeyPoolManager.refreshExpiredCooldowns();
  const listEl = document.getElementById('key-pool-list');
  listEl.innerHTML = '';

  pool.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'key-pool-item';

    const meta = document.createElement('div');
    meta.className = 'key-meta';
    const title = document.createElement('strong');
    title.textContent = `${item.label} (${item.provider.toUpperCase()})`;
    const status = document.createElement('span');

    if (item.status === 'cooldown' && item.cooldownUntil) {
      const remainMin = Math.max(1, Math.ceil((item.cooldownUntil - Date.now()) / 60000));
      const h = Math.floor(remainMin / 60);
      const m = remainMin % 60;
      status.className = 'key-status-cooldown';
      status.textContent = `Nghỉ 24h — còn ${h}g ${m}p`;
    } else {
      status.className = 'key-status-ready';
      status.textContent = `Sẵn sàng (${item.requestsToday || 0} calls)`;
    }

    meta.appendChild(title);
    meta.appendChild(status);

    li.appendChild(meta);

    // Proxy có sẵn không xóa được (xóa xong mở app lại nó tự mọc lại)
    if (!item.builtIn) {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'step-btn';
      delBtn.textContent = 'Xóa';
      delBtn.addEventListener('click', async () => {
        await window.KeyPoolManager.removeKey(item.id);
        await refreshSettingsUI();
      });
      li.appendChild(delBtn);
    }

    listEl.appendChild(li);
  });
}

let cooldownTimer = null;
function startCooldownBanner(resumeAt) {
  const banner = document.getElementById('cooldown-banner');
  if (cooldownTimer) clearInterval(cooldownTimer);
  if (!resumeAt) {
    banner.classList.add('hidden');
    return;
  }

  const tick = () => {
    const diff = resumeAt - Date.now();
    if (diff <= 0) {
      clearInterval(cooldownTimer);
      banner.classList.add('hidden');
      refreshSettingsUI();
      return;
    }
    const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
    const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
    const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
    banner.textContent = `Tất cả API key đang nghỉ 24h. Tự mở khóa sau ${h}:${m}:${s}`;
    banner.classList.remove('hidden');
  };
  tick();
  cooldownTimer = setInterval(tick, 1000);
}

function applySettings(settings) {
  const fontSelect = document.getElementById('font-select');
  const validFont = Array.from(fontSelect.options).some((opt) => opt.value === settings.font)
    ? settings.font
    : DEFAULT_SETTINGS.font;
  const validSize = Math.min(26, Math.max(14, Number(settings.fontSize) || DEFAULT_SETTINGS.fontSize));
  settings.font = validFont;
  settings.fontSize = validSize;
  document.documentElement.style.setProperty('--reader-font', validFont);
  document.documentElement.style.setProperty('--reader-size', `${validSize}px`);
  fontSelect.value = validFont;
  document.getElementById('size-range').value = validSize;
  document.getElementById('size-value').textContent = validSize;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function appendLinkedText(container, text) {
  const names = Object.keys(codex)
    .filter((n) => n.trim().length > 0)
    .sort((a, b) => b.length - a.length);

  if (names.length === 0) {
    container.appendChild(document.createTextNode(text));
    return;
  }

  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(${names.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}_])`, 'gu');
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const charName = match[1];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'char-link';
    btn.textContent = charName;
    btn.addEventListener('click', () => openCodex(charName));
    container.appendChild(btn);
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    container.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

let currentChapterNumber = 1;

function showEmptyStartScreen(show) {
  const emptyEl = document.getElementById('empty-start-screen');
  const storyEl = document.getElementById('story-content');
  if (show) {
    document.getElementById('chapter-title').textContent = 'CHAPTER 1';
    emptyEl.classList.remove('hidden');
    storyEl.classList.add('hidden');
  } else {
    emptyEl.classList.add('hidden');
    storyEl.classList.remove('hidden');
  }
}

async function loadAndRenderLatestChapter() {
  try {
    const latest = await window.StoryDB.db.chapters.orderBy('number').last();
    if (latest) {
      showEmptyStartScreen(false);
      currentChapterNumber = latest.number;
      renderChapter(latest);
    } else {
      showEmptyStartScreen(true);
    }
  } catch {
    // Chỉ dùng MOCK_CHAPTER làm dự phòng khi IndexedDB lỗi không tải được
    showEmptyStartScreen(false);
    currentChapterNumber = MOCK_CHAPTER.number;
    renderChapter(MOCK_CHAPTER);
  }
}

async function openChapterByNumber(num) {
  const ch = await window.StoryDB.db.chapters.get(num);
  if (ch) {
    showEmptyStartScreen(false);
    currentChapterNumber = ch.number;
    renderChapter(ch);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function renderChapter(chapter) {
  document.getElementById('chapter-title').textContent = `CHAPTER ${chapter.number}`;
  const container = document.getElementById('story-content');
  container.innerHTML = '';

  chapter.blocks.forEach((block) => {
    if (block.type === 'narrative') {
      const p = document.createElement('p');
      p.className = 'narrative-p';
      appendLinkedText(p, block.text);
      container.appendChild(p);
    } else if (block.type === 'dialogue') {
      const char = codex[block.speaker];
      const hasPortrait = Boolean(char && char.portrait);
      const row = document.createElement('div');
      row.className = 'dialogue-row';

      if (hasPortrait) {
        const avatarBtn = document.createElement('button');
        avatarBtn.type = 'button';
        avatarBtn.className = 'dialogue-avatar-btn';
        avatarBtn.title = `Xem hồ sơ ${char.name}`;
        avatarBtn.addEventListener('click', () => openCodex(char.name));

        const img = document.createElement('img');
        img.className = 'dialogue-avatar-img';
        img.src = char.portrait;
        img.alt = char.name;

        avatarBtn.appendChild(img);
        row.appendChild(avatarBtn);
      }

      const p = document.createElement('p');
      p.className = 'dialogue-text';

      const speakerWrap = document.createElement('span');
      speakerWrap.className = 'speaker-label';
      appendLinkedText(speakerWrap, block.speaker);
      p.appendChild(speakerWrap);
      p.appendChild(document.createTextNode(': '));
      appendLinkedText(p, block.text);

      row.appendChild(p);
      container.appendChild(row);
    }
  });
}

function renderCharDrawer() {
  const list = document.getElementById('char-drawer-list');
  list.innerHTML = '';
  const chars = Object.values(codex);

  if (chars.length === 0) {
    list.innerHTML = '<p class="docx-status">Chưa có nhân vật nào.</p>';
    return;
  }

  chars.forEach((char) => {
    const card = document.createElement('div');
    card.className = 'char-card';
    card.addEventListener('click', () => {
      document.getElementById('char-drawer-backdrop').classList.add('hidden');
      openCodex(char.name);
    });

    if (char.portrait) {
      const wrap = document.createElement('div');
      wrap.className = 'dialogue-avatar-btn';
      wrap.style.marginTop = '2px';
      const img = document.createElement('img');
      img.className = 'dialogue-avatar-img';
      img.src = char.portrait;
      img.alt = char.name;
      wrap.appendChild(img);
      card.appendChild(wrap);
    }

    const info = document.createElement('div');
    info.className = 'char-card-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'char-card-name';
    nameEl.textContent = char.name;

    const st = char.state || {};
    const stateParts = [
      st.level ? `Level: ${st.level}` : '',
      st.injuries ? `Thương tích: ${st.injuries}` : '',
      st.inventory ? `Túi đồ: ${st.inventory}` : ''
    ].filter(Boolean);

    const stateEl = document.createElement('div');
    stateEl.className = 'char-card-state';
    stateEl.textContent =
      stateParts.join(' • ') || (char.portrait ? 'Nhân vật chính' : 'Nhân vật phụ (chưa có ảnh)');

    info.appendChild(nameEl);
    info.appendChild(stateEl);
    card.appendChild(info);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'char-del-btn';
    delBtn.textContent = '×';
    delBtn.title = 'Xóa nhân vật';
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      delete codex[char.name];
      await window.StoryDB.db.characters.delete(char.name);
      renderCharDrawer();
      await loadAndRenderLatestChapter();
    });
    card.appendChild(delBtn);

    list.appendChild(card);
  });
}

// Form sửa/bổ sung nhân vật (chỉ là đường dự phòng — luồng chính là tải .docx tự nhận diện + tự lưu)
function openCharEditForm(charObj = null) {
  const form = document.getElementById('codex-form');
  document.getElementById('codex-form-title').textContent = charObj
    ? `Sửa hồ sơ: ${charObj.name}`
    : 'Bổ sung nhân vật (dự phòng)';
  document.getElementById('input-char-name').value = charObj?.name || '';
  document.getElementById('input-char-code').value = charObj?.code || '';
  document.getElementById('input-char-desc').value = charObj?.description || '';
  document.getElementById('input-char-image-url').value =
    charObj?.portrait && !charObj.portrait.startsWith('data:') ? charObj.portrait : '';
  document.getElementById('input-char-image-file').value = '';
  form.classList.remove('hidden');
}

function renderSavedResults(parsed) {
  const wrap = document.getElementById('codex-review-wrap');
  const info = document.getElementById('codex-review-info');
  const list = document.getElementById('codex-review-list');
  const srcLabel = parsed.source === 'regex' ? 'Regex 0 API call' : 'LLM';

  info.textContent = `Đã tự động lưu (${srcLabel}): ${parsed.characters.length} nhân vật, ${parsed.hardRules.length} Hard Rules, ${parsed.softLore.length} Soft Lore.`;
  list.innerHTML = '';

  parsed.characters.forEach((c) => {
    const box = document.createElement('div');
    box.className = 'review-char-box';

    const filledFields = [
      c.aliases ? 'Danh hiệu' : '',
      c.appearance ? 'Ngoại hình' : '',
      c.personality ? 'Tính cách' : '',
      c.skills_abilities ? 'Kỹ năng' : '',
      c.inventory_default ? 'Vật phẩm' : '',
      c.speech_style ? 'Giọng điệu' : '',
      c.hard_constraints ? 'Ràng buộc' : ''
    ].filter(Boolean);

    const title = document.createElement('div');
    title.style.fontWeight = '600';
    title.textContent = c.code ? `${c.name} [${c.code}]` : c.name;

    const meta = document.createElement('div');
    meta.style.fontSize = '12px';
    meta.style.color = 'var(--ink-muted)';
    meta.textContent = `Các trường nhận diện được: ${filledFields.join(', ') || 'Cơ bản'}`;

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;margin-top:6px;';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'step-btn';
    editBtn.textContent = 'Sửa';
    editBtn.addEventListener('click', () => openCharEditForm(codex[c.name] || c));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'step-btn';
    delBtn.textContent = 'Xóa';
    delBtn.addEventListener('click', async () => {
      delete codex[c.name];
      await window.StoryDB.db.characters.delete(c.name);
      box.remove();
      renderCharDrawer();
      await loadAndRenderLatestChapter();
    });

    actions.append(editBtn, delBtn);
    box.append(title, meta, actions);
    list.appendChild(box);
  });

  // Chỉ mở form nhập tay dự phòng nếu không tìm thấy nhân vật nào trong file
  if (parsed.characters.length === 0) {
    openCharEditForm(null);
  } else {
    document.getElementById('codex-form').classList.add('hidden');
  }

  wrap.classList.remove('hidden');
}

async function processAndSaveDocx(text) {
  const statusEl = document.getElementById('docx-status');
  statusEl.textContent = 'Đang tự động nhận diện và lưu codex...';
  let parsed;
  try {
    parsed = await window.CodexParser.autoSplitDocxCodex(text);
  } catch (err) {
    statusEl.textContent = `Lỗi tách codex: ${err.message}`;
    return;
  }

  try {
    for (const c of parsed.characters) {
      if (!c.name) continue;
      const existing = codex[c.name];
      const merged = {
        ...c,
        portrait: existing?.portrait || c.portrait || '',
        state: existing?.state || c.state
      };
      codex[merged.name] = merged;
      await window.StoryDB.db.characters.put(merged);
    }

    // Gộp luật mới vào luật đã có (theo nội dung) — tải file Kael sau file thế giới không xóa luật thế giới
    // shortcut: luật cũ của file đã sửa vẫn còn khi tải lại, nâng cấp khi cần thay luật theo từng file
    if (parsed.hardRules.length) {
      const existing = await window.StoryDB.db.worldRules.where('type').equals('hard_rule').toArray();
      const seen = new Set(existing.map((r) => r.content));
      const fresh = parsed.hardRules.filter((r) => !seen.has(r));
      if (fresh.length) await window.StoryDB.db.worldRules.bulkAdd(fresh.map((content) => ({ type: 'hard_rule', content })));
    }
    if (parsed.softLore.length) {
      const existing = await window.StoryDB.db.worldRules.where('type').equals('soft_lore').toArray();
      const seen = new Set(existing.map((r) => r.content));
      const fresh = parsed.softLore.filter((r) => !seen.has(r));
      if (fresh.length) await window.StoryDB.db.worldRules.bulkAdd(fresh.map((content) => ({ type: 'soft_lore', content })));
    }
  } catch (err) {
    statusEl.textContent = `Lỗi khi lưu codex: ${err.message}`;
    return;
  }

  renderCharDrawer();
  await loadAndRenderLatestChapter();
  renderSavedResults(parsed);
  statusEl.textContent = 'Đã nhận diện và lưu xong.';
}

function openCodex(charName) {
  const char = codex[charName];
  if (!char) return;
  const st = char.state || { level: '', injuries: '', inventory: '' };

  const portraitEl = document.getElementById('codex-portrait');
  if (char.portrait) {
    portraitEl.src = char.portrait;
    portraitEl.alt = char.name;
    portraitEl.classList.remove('hidden');
  } else {
    portraitEl.removeAttribute('src');
    portraitEl.classList.add('hidden');
  }

  document.getElementById('codex-name').textContent = char.name;
  document.getElementById('codex-kind').textContent = char.portrait
    ? 'Nhân vật có ảnh chân dung'
    : 'Nhân vật phụ (chưa có ảnh)';

  const summary = [
    char.code ? `Mã tra cứu: ${char.code}` : '',
    char.aliases ? `Biệt danh: ${char.aliases}` : '',
    char.appearance ? `Ngoại hình: ${char.appearance}` : '',
    char.personality || char.description || '',
    char.skills_abilities ? `Kỹ năng: ${char.skills_abilities}` : '',
    char.speech_style ? `Giọng điệu: ${char.speech_style}` : '',
    char.hard_constraints ? `Ràng buộc: ${char.hard_constraints}` : ''
  ]
    .filter(Boolean)
    .join('\n\n');

  const body = document.getElementById('codex-body');
  body.innerHTML = `
    <p style="margin-top:0;white-space:pre-line;"></p>
    <div class="setting-divider codex-form">
      <p class="form-section-title">Trạng thái động (sửa trực tiếp)</p>
      <div class="setting-group"><label>Level / Vị trí</label><input id="state-level" type="text" /></div>
      <div class="setting-group"><label>Thương tích / Tinh thần</label><input id="state-injuries" type="text" /></div>
      <div class="setting-group"><label>Túi đồ hiện tại</label><input id="state-inventory" type="text" /></div>
      <button id="save-char-state-btn" type="button" class="primary-btn">Lưu trạng thái</button>
    </div>
  `;
  body.querySelector('p').textContent = summary || 'Chưa có mô tả.';
  body.querySelector('#state-level').value = st.level || '';
  body.querySelector('#state-injuries').value = st.injuries || '';
  body.querySelector('#state-inventory').value = st.inventory || '';

  body.querySelector('#save-char-state-btn').addEventListener('click', async () => {
    char.state = {
      level: body.querySelector('#state-level').value.trim(),
      injuries: body.querySelector('#state-injuries').value.trim(),
      inventory: body.querySelector('#state-inventory').value.trim()
    };
    await window.StoryDB.db.characters.put(char);
    renderCharDrawer();
    document.getElementById('codex-modal').classList.add('hidden');
  });

  document.getElementById('codex-modal').classList.remove('hidden');
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function setupEvents(settings) {
  const settingsModal = document.getElementById('settings-modal');
  const importModal = document.getElementById('import-codex-modal');
  const codexModal = document.getElementById('codex-modal');
  const setupModal = document.getElementById('setup-modal');

  document.getElementById('settings-btn').addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
  });

  document.getElementById('open-import-codex-btn').addEventListener('click', () => {
    settingsModal.classList.add('hidden');
    renderDocxPreview(docxCodex);
    importModal.classList.remove('hidden');
  });

  // Bảng Setup gu truyện
  document.querySelectorAll('.seg-group').forEach((group) => {
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      group.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.getElementById('fullscreen-btn').addEventListener('click', () => toggleFullscreen());

  document.getElementById('open-setup-btn').addEventListener('click', () => {
    settingsModal.classList.add('hidden');
    populateSetupUI(currentStoryPrefs);
    setupModal.classList.remove('hidden');
  });

  document.getElementById('setup-continue-btn').addEventListener('click', async () => {
    currentStoryPrefs = collectSetupUI();
    // Bật fullscreen ngay trong cú chạm (giữ đúng gesture) trước khi lưu async
    if (currentStoryPrefs.autoFullscreen) toggleFullscreen(true);
    try {
      await window.StoryDB.setSetting('storyPrefs', currentStoryPrefs);
    } catch {
      // IndexedDB chưa sẵn sàng: giữ lựa chọn trong bộ nhớ, không chặn đọc truyện
    }
    setupModal.classList.add('hidden');
  });

  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById(btn.dataset.close).classList.add('hidden');
    });
  });

  [settingsModal, importModal, codexModal, setupModal].forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.classList.add('hidden');
    });
  });

  document.getElementById('font-select').addEventListener('change', (e) => {
    settings.font = e.target.value;
    applySettings(settings);
    saveSettings(settings);
  });

  const updateSize = (nextSize) => {
    settings.fontSize = Math.min(26, Math.max(14, nextSize));
    applySettings(settings);
    saveSettings(settings);
  };

  document.getElementById('size-range').addEventListener('input', (e) => {
    updateSize(Number(e.target.value));
  });
  document.getElementById('size-dec').addEventListener('click', () => updateSize(settings.fontSize - 1));
  document.getElementById('size-inc').addEventListener('click', () => updateSize(settings.fontSize + 1));

  // Xử lý nút "Tải file DOCX lên" bằng mammoth.js CDN
  const docxInput = document.getElementById('docx-file-input');
  document.getElementById('upload-docx-btn').addEventListener('click', () => {
    docxInput.click();
  });

  docxInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const statusEl = document.getElementById('docx-status');
    if (!window.mammoth) {
      statusEl.textContent = 'Không tải được thư viện mammoth.js. Vui lòng kiểm tra kết nối mạng.';
      return;
    }

    statusEl.textContent = `Đang đọc "${file.name}"...`;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await window.mammoth.extractRawText({ arrayBuffer });
      docxCodex = {
        fileName: file.name,
        text: result.value || '',
        updatedAt: Date.now()
      };
      saveDocxCodex(docxCodex);
      renderDocxPreview(docxCodex);
      await processAndSaveDocx(docxCodex.text);
    } catch {
      statusEl.textContent = 'Lỗi khi đọc file .docx. Vui lòng kiểm tra lại định dạng file.';
    } finally {
      docxInput.value = '';
    }
  });

  // Lưu nhân vật nhập tay (đường dự phòng — chỉ tên là bắt buộc, mô tả tùy ý)
  document.getElementById('codex-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('input-char-name').value.trim();
    const code = document.getElementById('input-char-code').value.trim();
    const description = document.getElementById('input-char-desc').value.trim();
    const fileInput = document.getElementById('input-char-image-file');
    const urlInput = document.getElementById('input-char-image-url').value.trim();

    if (!name) return;

    const existing = codex[name] || window.CodexParser.emptyChar(name);
    let portrait = urlInput || existing.portrait || '';
    if (fileInput.files && fileInput.files[0]) {
      try {
        portrait = await readFileAsDataURL(fileInput.files[0]);
      } catch {
        alert('Không đọc được ảnh chân dung. Đã dùng URL ảnh (nếu có).');
      }
    }

    // Giữ nguyên các trường đã nhận diện (aliases, appearance, personality...) — chỉ cập nhật tên, mã, mô tả, ảnh
    codex[name] = { ...existing, name, code, description, portrait };
    await window.StoryDB.db.characters.put(codex[name]);
    renderCharDrawer();
    await loadAndRenderLatestChapter();

    e.target.reset();
    document.getElementById('codex-form').classList.add('hidden');
  });

  // Phần 2: Pool Key, công tắc free-only, daily cap, status listener
  document.getElementById('free-only-toggle').addEventListener('change', async (e) => {
    const cfg = await window.StoryDB.getSetting('apiConfig', {});
    cfg.freeOnlyMode = e.target.checked;
    await window.StoryDB.setSetting('apiConfig', cfg);
  });

  document.getElementById('daily-cap-input').addEventListener('change', async (e) => {
    const cfg = await window.StoryDB.getSetting('apiConfig', {});
    cfg.dailyCap = Math.max(10, Number(e.target.value) || 100);
    await window.StoryDB.setSetting('apiConfig', cfg);
    await refreshSettingsUI();
  });

  document.getElementById('add-key-btn').addEventListener('click', async () => {
    const provider = document.getElementById('key-provider-select').value;
    const label = document.getElementById('key-label-input').value;
    const apiKey = document.getElementById('key-value-input').value.trim();
    if (!apiKey) return;
    await window.KeyPoolManager.addKey({ provider, label, apiKey });
    document.getElementById('key-label-input').value = '';
    document.getElementById('key-value-input').value = '';
    await refreshSettingsUI();
  });

  window.RequestQueue.setStatusListener((state) => {
    if (state.type === 'budget') {
      document.getElementById('budget-display').textContent = `${state.used}/${state.cap} calls hôm nay`;
    } else if (state.type === 'all_cooldown') {
      startCooldownBanner(state.resumeAt);
      refreshSettingsUI();
    } else if (state.type === 'waiting') {
      const banner = document.getElementById('cooldown-banner');
      banner.textContent = `${state.reason} — tự thử lại sau ${state.waitSec}s...`;
      banner.classList.remove('hidden');
    }
  });

  // Phần 3: Drawer nhân vật
  const drawerBackdrop = document.getElementById('char-drawer-backdrop');
  document.getElementById('chars-btn').addEventListener('click', () => {
    renderCharDrawer();
    drawerBackdrop.classList.remove('hidden');
  });
  document.getElementById('close-drawer-btn').addEventListener('click', () => {
    drawerBackdrop.classList.add('hidden');
  });
  drawerBackdrop.addEventListener('click', (e) => {
    if (e.target === drawerBackdrop) drawerBackdrop.classList.add('hidden');
  });
  document.getElementById('drawer-add-char-btn').addEventListener('click', () => {
    drawerBackdrop.classList.add('hidden');
    renderDocxPreview(docxCodex);
    importModal.classList.remove('hidden');
    openCharEditForm(null);
  });

  // Phần 4: Thanh điều khiển viết chương
  const statusEl = document.getElementById('writer-status');
  const stopControls = document.getElementById('stop-controls');
  const writeBtn = document.getElementById('write-next-btn');
  const ch1Input = document.getElementById('ch1-direction-input');
  const ch1GuidedBtn = document.getElementById('ch1-guided-btn');
  const ch1FreeBtn = document.getElementById('ch1-free-btn');

  // Viết chương tiếp (dùng chung cho nút viết thường và viết theo gợi ý)
  async function startWriting(userDirection = '', onDone) {
    // Đang viết dở thì không mở thêm phiên viết nữa (tránh ẩn mất nút Dừng)
    if (window.ChapterEngine.isWriting()) return;
    document.getElementById('suggestion-panel').classList.add('hidden');
    writeBtn.disabled = true;
    document.getElementById('endless-start-btn').disabled = true;
    document.getElementById('goto-next-chapter-btn').disabled = true;
    document.getElementById('suggest-next-btn').disabled = true;
    ch1GuidedBtn.disabled = true;
    ch1FreeBtn.disabled = true;
    ch1Input.disabled = true;
    stopControls.classList.remove('hidden');
    statusEl.classList.remove('hidden');

    await window.ChapterEngine.writeNextChapter({
      userDirection,
      onStatus: (msg) => {
        statusEl.textContent = msg;
      },
      onChapterReady: async (chapterRecord) => {
        const chars = await window.StoryDB.db.characters.toArray();
        codex = Object.fromEntries(chars.map((c) => [c.name, c]));
        renderCharDrawer();
        currentChapterNumber = chapterRecord.number;
        showEmptyStartScreen(false);
        renderChapter(chapterRecord);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        if (onDone) onDone(chapterRecord);
      }
    });

    writeBtn.disabled = false;
    document.getElementById('endless-start-btn').disabled = false;
    document.getElementById('goto-next-chapter-btn').disabled = false;
    document.getElementById('suggest-next-btn').disabled = false;
    ch1GuidedBtn.disabled = false;
    ch1FreeBtn.disabled = false;
    ch1Input.disabled = false;
    stopControls.classList.add('hidden');
  }

  writeBtn.addEventListener('click', () => startWriting());

  document.getElementById('graceful-stop-btn').addEventListener('click', () => {
    if (window.EndlessManager) window.EndlessManager.stopEndlessGraceful();
    else window.ChapterEngine.requestGracefulStop();
    statusEl.textContent = 'Sẽ dừng sau khi viết xong chương hiện tại và cập nhật bộ nhớ...';
  });

  document.getElementById('hard-stop-btn').addEventListener('click', () => {
    if (window.EndlessManager) window.EndlessManager.stopEndlessHard();
    else window.ChapterEngine.hardStop();
  });

  document.getElementById('prev-chapter-btn').addEventListener('click', () => {
    if (currentChapterNumber > 1) openChapterByNumber(currentChapterNumber - 1);
  });

  document.getElementById('next-chapter-btn').addEventListener('click', () => {
    openChapterByNumber(currentChapterNumber + 1);
  });

  // Phần 5: Chế độ Vô tận + Xuất file
  const endlessBtn = document.getElementById('endless-start-btn');

  endlessBtn.addEventListener('click', async () => {
    writeBtn.disabled = true;
    endlessBtn.disabled = true;
    document.getElementById('goto-next-chapter-btn').disabled = true;
    document.getElementById('suggest-next-btn').disabled = true;
    ch1GuidedBtn.disabled = true;
    ch1FreeBtn.disabled = true;
    ch1Input.disabled = true;
    stopControls.classList.remove('hidden');
    statusEl.classList.remove('hidden');

    await window.EndlessManager.startEndlessMode({
      onStatus: (msg) => {
        statusEl.textContent = msg;
      },
      onChapterReady: async (chapterRecord) => {
        const chars = await window.StoryDB.db.characters.toArray();
        codex = Object.fromEntries(chars.map((c) => [c.name, c]));
        renderCharDrawer();
        currentChapterNumber = chapterRecord.number;
        showEmptyStartScreen(false);
        renderChapter(chapterRecord);
      },
      onFinished: () => {
        writeBtn.disabled = false;
        endlessBtn.disabled = false;
        document.getElementById('goto-next-chapter-btn').disabled = false;
        document.getElementById('suggest-next-btn').disabled = false;
        ch1GuidedBtn.disabled = false;
        ch1FreeBtn.disabled = false;
        ch1Input.disabled = false;
        stopControls.classList.add('hidden');
      }
    });
  });

  document.getElementById('export-all-btn').addEventListener('click', () => {
    window.EndlessManager.exportAllStory();
  });
  document.getElementById('export-current-btn').addEventListener('click', () => {
    window.EndlessManager.exportCurrentChapterMd(currentChapterNumber);
  });

  // Cuối chương: chuyển chương + gợi ý chương mới
  document.getElementById('goto-next-chapter-btn').addEventListener('click', async () => {
    let next = null;
    try {
      next = await window.StoryDB.db.chapters.get(currentChapterNumber + 1);
    } catch {
      // DB chưa sẵn sàng -> viết chương mới
    }
    if (next) openChapterByNumber(currentChapterNumber + 1);
    else await startWriting();
  });

  document.getElementById('suggest-next-btn').addEventListener('click', () => {
    const panel = document.getElementById('suggestion-panel');
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) document.getElementById('next-chapter-suggestion').focus();
  });

  document.getElementById('cancel-suggestion-btn').addEventListener('click', () => {
    document.getElementById('suggestion-panel').classList.add('hidden');
  });

  document.getElementById('write-suggested-btn').addEventListener('click', async () => {
    const suggestionEl = document.getElementById('next-chapter-suggestion');
    const direction = suggestionEl.value.trim();
    if (!direction) {
      statusEl.textContent = 'Nhập gợi ý cho chương mới trước đã nhé.';
      statusEl.classList.remove('hidden');
      suggestionEl.focus();
      return;
    }
    document.getElementById('suggestion-panel').classList.add('hidden');
    // Có bản nháp thì gợi ý bị bỏ qua — giữ lại chữ để anh dùng cho chương sau
    let draft = null;
    try {
      draft = await window.StoryDB.getSetting('chapter_draft', null);
    } catch {
      draft = null;
    }
    await startWriting(direction, draft?.outline ? undefined : () => { suggestionEl.value = ''; });
  });

  // Màn hình khởi đầu chương 1 (khi chưa có chương nào): dùng chung startWriting,
  // màn hình tự ẩn khi chương 1 viết xong nhờ showEmptyStartScreen(false) trong onChapterReady
  const ch1Error = document.getElementById('ch1-direction-error');

  document.getElementById('ch1-guided-btn').addEventListener('click', () => {
    const dir = ch1Input.value.trim();
    if (!dir) {
      ch1Error.textContent = 'Vui lòng nhập gợi ý cho chương 1 hoặc bấm "Tự do sáng tác".';
      ch1Error.classList.remove('hidden');
      ch1Input.focus();
      return;
    }
    ch1Error.classList.add('hidden');
    startWriting(dir);
  });

  document.getElementById('ch1-free-btn').addEventListener('click', () => {
    ch1Error.classList.add('hidden');
    startWriting('');
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  let settings = loadSettings();
  let dbReady = false;

  try {
    await window.StoryDB.initDatabase(DEFAULT_CODEX, DEFAULT_SETTINGS);
    settings = await window.StoryDB.getSetting('reader', DEFAULT_SETTINGS);
    const chars = await window.StoryDB.db.characters.toArray();
    codex = Object.fromEntries(chars.map((c) => [c.name, c]));
    const latestDocx = await window.StoryDB.db.worldRules.where('type').equals('raw_docx').last();
    if (latestDocx) docxCodex = { fileName: latestDocx.title, text: latestDocx.content };
    dbReady = true;
  } catch {
    // Dexie/CDN lỗi: dùng dữ liệu localStorage như Phần 1, trang vẫn đọc được
    settings = loadSettings();
  }

  applySettings(settings);
  try {
    if (dbReady) await loadAndRenderLatestChapter();
    else renderChapter(MOCK_CHAPTER);
  } catch {
    renderChapter(MOCK_CHAPTER);
  }
  setupEvents(settings);
  if (dbReady) await refreshSettingsUI();
  if (dbReady) {
    // Hiện bảng Setup ngay khi mở app, điền sẵn lựa chọn đã lưu (nếu có)
    currentStoryPrefs = { ...DEFAULT_STORY_PREFS, ...((await window.StoryDB.getSetting('storyPrefs', {})) || {}) };
    populateSetupUI(currentStoryPrefs);
    document.getElementById('setup-modal').classList.remove('hidden');
  }
});
