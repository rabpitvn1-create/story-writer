const SETTINGS_KEY = 'story_writer_settings_v1';
const CODEX_KEY = 'story_writer_mock_codex_v1';
const DOCX_CODEX_KEY = 'story_writer_docx_raw_v1';

// Ảnh chân dung mẫu (SVG data URI) cho nhân vật chính mẫu để thấy sẵn cách cắt avatar vuông;
// Lan không có ảnh nên mặc định hiển thị dạng nhân vật phụ (không có ô avatar).
const SAMPLE_PORTRAIT =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 140">
      <rect width="120" height="140" fill="#4a3d33"/>
      <circle cx="60" cy="48" r="24" fill="#d8c3ad"/>
      <path d="M22 140 C22 96, 98 96, 98 140 Z" fill="#2c241e"/>
    </svg>`
  );

const DEFAULT_CODEX = {
  Toàn: {
    name: 'Toàn',
    description:
      'Áo khoác vải sờn màu tro, vết sẹo nhỏ dưới xương gò má trái. Ít nói, quan sát kỹ và luôn mang theo một chiếc bật lửa đồng cạn xăng.',
    portrait: SAMPLE_PORTRAIT
  },
  Lan: {
    name: 'Lan',
    description:
      'Tóc buộc gọn sau gáy, mang ba lô vải bạt cũ. Nhạy bén với âm thanh và ghi nhớ rất tốt các ký hiệu vẽ trên tường.',
    portrait: ''
  }
};

const MOCK_CHAPTER = {
  number: 1,
  blocks: [
    { type: 'narrative', text: 'Toàn nói với Lan.' },
    { type: 'dialogue', speaker: 'Toàn', text: 'Tôi ở đây' },
    { type: 'dialogue', speaker: 'Lan', text: 'Tôi biết' },
    {
      type: 'narrative',
      text: 'Mưa gõ nhẹ lên mái hiên. Toàn khẽ gật đầu về phía con hẻm tối mờ trước mặt, trong khi Lan chỉnh lại quai ba lô và bước theo sát phía sau.'
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
  // fix: scope to the setup modal — the unscoped selector also matched the
  // start screen's [data-start-seg] groups (dataset.seg undefined) and
  // stripped their active pill on every load.
  document.querySelectorAll('#setup-modal .seg-group').forEach((group) => {
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
  const modelSelect = document.getElementById('model-mode-select');
  if (!modelSelect.disabled) modelSelect.value = window.KeyPoolManager.resolveModelMode(apiConfig);
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
      status.textContent = `Tạm nghỉ — còn ${h}g ${m}p`;
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
  cooldownTimer = null;
  if (!resumeAt) {
    banner.classList.add('hidden');
    return;
  }

  const tick = () => {
    const diff = resumeAt - Date.now();
    if (diff <= 0) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
      banner.classList.add('hidden');
      refreshSettingsUI();
      return;
    }
    const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
    const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
    const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
    banner.textContent = `Nguồn AI phù hợp đang tạm nghỉ. Thử lại sau ${h}:${m}:${s}`;
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
  const names = Object.values(codex)
    .filter((c) => c && c.name && c.role !== 'npc')
    .map((c) => c.name.trim())
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

const ROLE_LABELS = {
  protagonist: 'Nhân vật chính',
  ally: 'Đồng hành',
  antagonist: 'Kẻ thù',
  supporting: 'Nhân vật phụ',
  npc: 'Quần chúng'
};

// Single Source of Truth = IndexedDB: đồng bộ object codex trong RAM từ DB rồi vẽ lại drawer + thẻ màn bắt đầu
async function syncCodexFromDB() {
  const chars = await window.StoryDB.db.characters.toArray();
  codex = Object.fromEntries(chars.map((c) => [c.name, c]));
  renderCharDrawer();
  await renderStartScreenCardsFromDB();
}

async function renderStartScreenCardsFromDB() {
  const charList = document.getElementById('quick-char-list');
  const worldList = document.getElementById('quick-world-list');
  if (charList) {
    const chars = Object.values(codex).filter((c) => c.role !== 'npc');
    charList.innerHTML = '';
    chars.forEach((c) => {
      const span = document.createElement('span');
      span.className = 'quick-tag';
      span.textContent = `${c.name} (${ROLE_LABELS[c.role] || (window.CodexParser.isMainCharacter(c) ? 'Nhân vật chính' : 'Nhân vật phụ')})`;
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.addEventListener('click', async () => {
        await window.StoryDB.db.characters.delete(c.name);
        await syncCodexFromDB();
      });
      span.appendChild(x);
      charList.appendChild(span);
    });
  }
  if (worldList) {
    const rules = await window.StoryDB.db.worldRules.where('type').equals('hard_rule').toArray();
    worldList.innerHTML = '';
    rules.slice(0, 8).forEach((r) => {
      const span = document.createElement('span');
      span.className = 'quick-tag';
      span.textContent = r.content.slice(0, 90);
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.addEventListener('click', async () => {
        await window.StoryDB.db.worldRules.delete(r.id);
        await renderStartScreenCardsFromDB();
      });
      span.appendChild(x);
      worldList.appendChild(span);
    });
  }
}

let unifiedAddKind = 'char';

function openUnifiedAddModal(kind) {
  unifiedAddKind = kind;
  document.getElementById('unified-add-title').textContent = kind === 'world' ? 'Thêm bối cảnh' : 'Thêm nhân vật';
  // Chuyển luôn dòng đang gõ dở ở màn bắt đầu sang ô nhập của modal
  const srcInput = document.getElementById(kind === 'world' ? 'quick-world-input' : 'quick-char-input');
  const textarea = document.getElementById('unified-add-textarea');
  if (srcInput?.value.trim()) {
    textarea.value = srcInput.value;
    srcInput.value = '';
  }
  document.getElementById('unified-add-modal').classList.remove('hidden');
}

// Lưu 1 mục gõ tay thẳng vào IndexedDB (không qua mảng tạm), gán vai bằng heuristic
async function saveSingleTypedItem(kind, line) {
  const text = String(line || '').trim();
  if (!text) return false;
  if (kind === 'world') {
    await window.StoryDB.db.worldRules.add({ type: 'hard_rule', content: text, updatedAt: Date.now() });
    const pinned = await window.StoryDB.getSetting('pinned_facts', []);
    if (!pinned.includes(text)) {
      pinned.push(text);
      await window.StoryDB.setSetting('pinned_facts', pinned);
    }
  } else {
    const existing = await window.StoryDB.db.characters.toArray();
    const hasProtagonist = existing.some((c) => window.CodexParser.isMainCharacter(c));
    const parsed = window.CodexParser.parseSingleLineCharacter(text, true);
    if (!parsed || !parsed.name) return false;
    parsed.role = window.CodexParser.guessRoleHeuristic(parsed, 0, hasProtagonist);
    parsed.isMain = parsed.role === 'protagonist';
    await window.StoryDB.db.characters.put(parsed);
  }
  await syncCodexFromDB();
  return true;
}

let previewDraft = { characters: [], hardRules: [], softLore: [], allRules: [], fromDocx: false, source: 'typed' };

async function openPreviewPickModal(parsed, opts = {}) {
  const existing = await window.StoryDB.db.characters.toArray();
  const hasProtagonist = existing.some((c) => window.CodexParser.isMainCharacter(c));
  previewDraft = {
    characters: (parsed.characters || []).map((c, idx) => ({
      ...c,
      role: c.role || window.CodexParser.guessRoleHeuristic(c, idx, hasProtagonist),
      checked: true
    })),
    hardRules: parsed.hardRules || [],
    softLore: parsed.softLore || [],
    allRules: [
      ...(parsed.hardRules || []).map((content) => ({ type: 'hard_rule', content })),
      ...(parsed.softLore || []).map((content) => ({ type: 'soft_lore', content }))
    ],
    fromDocx: opts.fromDocx === true,
    source: parsed.source || 'typed'
  };

  // Nút "Nhờ AI gợi ý vai" chỉ hiện khi >= 4 nhân vật có mô tả > 30 ký tự
  const richCount = previewDraft.characters.filter((c) => String(c.personality || c.description || '').length > 30).length;
  document.getElementById('preview-ai-role-wrap').classList.toggle('hidden', richCount < 4);

  const charSec = document.getElementById('preview-chars-section');
  charSec.innerHTML = '';
  previewDraft.characters.forEach((c, idx) => {
    const row = document.createElement('div');
    row.className = 'preview-row';
    const pills = ['protagonist', 'ally', 'antagonist', 'supporting']
      .map((r) => `<button type="button" class="role-pill${c.role === r ? ' active' : ''}" data-cidx="${idx}" data-role="${r}">${ROLE_LABELS[r]}</button>`)
      .join('');
    row.innerHTML = `<label class="preview-row-head"><input type="checkbox" data-cchk="${idx}" checked /> <span></span></label><div class="role-pill-row">${pills}</div>`;
    row.querySelector('span').textContent = c.name;
    charSec.appendChild(row);
  });

  // Gom checkbox tổng khi > 10 luật thế giới (VD 228 luật của world.txt)
  const ruleSec = document.getElementById('preview-rules-section');
  const totalRules = previewDraft.allRules.length;
  ruleSec.innerHTML = '';
  if (totalRules > 10) {
    const label = document.createElement('label');
    label.className = 'preview-row preview-row-head';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = true;
    chk.id = 'preview-all-rules-chk';
    const span = document.createElement('span');
    span.textContent = `Lưu toàn bộ ${previewDraft.hardRules.length} luật cứng & ${previewDraft.softLore.length} lore`;
    label.append(chk, span);
    ruleSec.appendChild(label);
  } else {
    previewDraft.allRules.forEach((r, i) => {
      const label = document.createElement('label');
      label.className = 'preview-row preview-row-head';
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = true;
      chk.dataset.rchk = String(i);
      const span = document.createElement('span');
      span.textContent = r.content.slice(0, 80);
      label.append(chk, span);
      ruleSec.appendChild(label);
    });
  }

  document.getElementById('preview-pick-modal').classList.remove('hidden');
}

let currentChapterNumber = 1;

function showEmptyStartScreen(show) {
  const emptyEl = document.getElementById('empty-start-screen');
  const storyEl = document.getElementById('story-content');
  const nextBar = document.getElementById('chapter-next-bar');
  const writerBar = document.querySelector('.writer-bar');
  const chapterEnd = document.querySelector('.chapter-end');
  const endActions = document.getElementById('chapter-end-actions'); // nếu repo có wrapper nút cuối chương

  if (show) {
    document.getElementById('chapter-title').textContent = 'TRUYỆN MỚI';
    emptyEl?.classList.remove('hidden');
    storyEl?.classList.add('hidden');
    nextBar?.classList.add('hidden');
    writerBar?.classList.add('hidden');
    chapterEnd?.classList.add('hidden');
    endActions?.classList.add('hidden');
    // fix: đánh dấu seg đang chọn trên màn bắt đầu theo gu truyện hiện tại
    // (mặc định Trung bình / Trung bình / Kết thúc mở). Nếu không, khay
    // segment luôn trống vì chưa ai bấm, trái với mockup đã duyệt.
    const startSegMap = { drama: currentStoryPrefs.drama, deathRate: currentStoryPrefs.sideCharDeathRate, ending: currentStoryPrefs.ending };
    document.querySelectorAll('[data-start-seg]').forEach((group) => {
      const val = startSegMap[group.dataset.startSeg];
      group.querySelectorAll('.seg-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.val === val));
    });
  } else {
    emptyEl?.classList.add('hidden');
    storyEl?.classList.remove('hidden');
    nextBar?.classList.remove('hidden');
    writerBar?.classList.remove('hidden');
    chapterEnd?.classList.remove('hidden');
    endActions?.classList.remove('hidden');
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
  if (chapter.title && chapter.title !== `CHAPTER ${chapter.number}`) {
    const sub = document.createElement('h2');
    sub.className = 'chapter-subtitle';
    sub.textContent = chapter.title;
    container.appendChild(sub);
  }
  const gotoNextBtn = document.getElementById('goto-next-chapter-btn');
  if (gotoNextBtn) gotoNextBtn.textContent = `Đọc tiếp Chương ${chapter.number + 1} →`;

  chapter.blocks.forEach((block) => {
    const el = createBlockElement(block);
    if (el) container.appendChild(el);
  });
}

// Đọc dần khi đang viết (streaming/typewriter) — chữ hiện dần như tin nhắn đang gõ
// HẰNG SỐ TỐC ĐỘ NHẢ CHỮ DUY NHẤT (từ/phút) — chỉnh ở đây để nhanh/chậm hơn:
// 600 từ/phút ≈ 1 từ mỗi 100ms (tăng gấp đôi theo quyết định 26/11: 300 quá chậm trên điện thoại)
const TYPEWRITER_SPEED_WPM = 600;
const TYPEWRITER_WORDS_PER_TICK = 1;
const TYPEWRITER_TICK_MS = Math.max(40, Math.round((TYPEWRITER_WORDS_PER_TICK * 60000) / TYPEWRITER_SPEED_WPM));

// Tái dùng chung cho cả renderChapter và StreamRenderer -> hiển thị giống hệt 100%
function createBlockElement(block) {
  if (block.type === 'narrative') {
    const p = document.createElement('p');
    p.className = 'narrative-p';
    appendLinkedText(p, block.text);
    return p;
  }

  if (block.type === 'dialogue') {
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
    return row;
  }

  return null;
}

const StreamRenderer = {
  active: false,
  autoFollow: true,
  queueTokens: [],       // Mảng từ chờ nhả dần khi proxy trả 1 cục lớn
  pendingLine: '',       // Dòng đang gõ dở (chưa gặp \n)
  sceneReceivedText: false,
  currentDisplayScene: 0, // Cảnh typewriter đang hiển thị (Dừng khẩn chỉ xả tới đây)
  lastEnqueuedScene: 0,   // Cảnh mới nhất đã đẩy vào hàng đợi
  typeTimer: null,
  sseThrottleTimer: null,
  ssePendingChunk: '',
  tailEl: null,
  followBtn: null,
  skipBtn: null,
  switchBtn: null,
  switchTimer: null,
  switchCooldownUntil: 0,
  scrollHandlerBound: null,

  ensureFloatingControls() {
    if (!this.followBtn) {
      this.followBtn = document.createElement('button');
      this.followBtn.type = 'button';
      this.followBtn.className = 'stream-float-btn follow-btn hidden';
      this.followBtn.textContent = '↓ Đang viết tiếp';
      this.followBtn.addEventListener('click', () => {
        this.autoFollow = true;
        this.followBtn.classList.add('hidden');
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
      });
      document.body.appendChild(this.followBtn);
    }
    if (!this.skipBtn) {
      this.skipBtn = document.createElement('button');
      this.skipBtn.type = 'button';
      this.skipBtn.className = 'stream-float-btn skip-btn hidden';
      this.skipBtn.textContent = 'Hiện hết cảnh ⏭';
      this.skipBtn.addEventListener('click', () => this.flushAll());
      document.body.appendChild(this.skipBtn);
    }
    if (!this.switchBtn) {
      this.switchBtn = document.createElement('button');
      this.switchBtn.type = 'button';
      this.switchBtn.className = 'stream-float-btn switch-btn hidden';
      this.switchBtn.textContent = 'Đổi API';
      this.switchBtn.addEventListener('click', () => {
        if (Date.now() < this.switchCooldownUntil) return;
        const ok = window.RequestQueue?.requestSwitch?.();
        if (!ok) return;
        this.switchCooldownUntil = Date.now() + 3000;
        this.switchBtn.disabled = true;
        this.switchBtn.textContent = 'Đang chuyển...';
        setTimeout(() => {
          if (this.switchBtn) this.switchBtn.disabled = false;
          this.updateSwitchButton();
        }, 3000);
      });
      document.body.appendChild(this.switchBtn);
    }
  },

  startSwitchTimer() {
    // Dùng vòng đời chương (isWriting) chứ không phải StreamRenderer.active:
    // dàn ý chạy TRƯỚC khi StreamRenderer.start(), digest chạy SAU khi cleanupUI()
    if (!window.ChapterEngine?.isWriting?.()) return;
    this.ensureFloatingControls();
    this.stopSwitchTimer();
    this.updateSwitchButton();
    this.switchTimer = setInterval(() => this.updateSwitchButton(), 1000);
  },

  stopSwitchTimer() {
    if (this.switchTimer) {
      clearInterval(this.switchTimer);
      this.switchTimer = null;
    }
    if (this.switchBtn) {
      this.switchBtn.classList.add('hidden');
      this.switchBtn.disabled = false;
    }
  },

  updateSwitchButton() {
    if (!this.switchBtn || !window.ChapterEngine?.isWriting?.()) return;
    const st = window.RequestQueue?.getActiveCallState?.();
    if (!st || !st.active || st.hasFirstToken || !st.canSwitch || st.switchCount >= st.maxSwitches) {
      this.switchBtn.classList.add('hidden');
      return;
    }
    const elapsedSec = Math.max(0, Math.floor((Date.now() - st.startedAt) / 1000));
    const shouldShow = st.isWaiting || elapsedSec >= 25;
    if (!shouldShow) {
      this.switchBtn.classList.add('hidden');
      return;
    }
    this.switchBtn.classList.remove('hidden');
    if (Date.now() < this.switchCooldownUntil) {
      this.switchBtn.disabled = true;
      this.switchBtn.textContent = 'Đang chuyển...';
    } else {
      this.switchBtn.disabled = false;
      this.switchBtn.textContent = `Đổi API (${st.sourceLabel} · ${elapsedSec}s)`;
    }
  },

  bindScrollWatcher() {
    if (this.scrollHandlerBound) return;
    this.scrollHandlerBound = () => {
      if (!this.active) return;
      const dist = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
      if (dist < 120) {
        this.autoFollow = true;
        this.followBtn?.classList.add('hidden');
      } else {
        this.autoFollow = false;
        this.followBtn?.classList.remove('hidden');
      }
    };
    window.addEventListener('scroll', this.scrollHandlerBound, { passive: true });
  },

  start(chapterNumber, existingScenes = []) {
    this.stopTimers();
    this.ensureFloatingControls();
    this.bindScrollWatcher();

    this.active = true;
    this.autoFollow = true;
    this.queueTokens = [];
    this.pendingLine = '';
    this.ssePendingChunk = '';
    this.sceneReceivedText = false;
    this.currentDisplayScene = existingScenes.length;
    this.lastEnqueuedScene = existingScenes.length;

    if (typeof showEmptyStartScreen === 'function') showEmptyStartScreen(false);
    document.getElementById('chapter-title').textContent = `CHAPTER ${chapterNumber}`;
    const container = document.getElementById('story-content');
    container.innerHTML = '';

    // Nếu đang viết tiếp từ draft, render sẵn các cảnh đã lưu trước đó
    existingScenes.forEach((scText) => {
      const blocks = window.ChapterEngine.parseTextToBlocks(scText);
      blocks.forEach((b) => {
        const el = createBlockElement(b);
        if (el) container.appendChild(el);
      });
    });

    this.tailEl = document.createElement('p');
    this.tailEl.id = 'streaming-tail';
    this.tailEl.className = 'narrative-p stream-tail';
    container.appendChild(this.tailEl);

    this.followBtn.classList.add('hidden');
    this.skipBtn.classList.add('hidden');
  },

  // Nhận chunk từ onToken: tự phân biệt cục lớn (proxy) vs chunk nhỏ (SSE thật)
  pushChunk(chunk, sceneIndex = 0) {
    if (!this.active || !chunk) return;
    this.sceneReceivedText = true;

    // FIX-STOP: đánh dấu ranh giới cảnh trong hàng đợi (vòng lặp chương chạy trước typewriter,
    // cảnh sau có thể đã fetch xong trong khi cảnh hiện tại vẫn đang chạy chữ)
    const idx = Number.isInteger(sceneIndex) ? sceneIndex : this.lastEnqueuedScene;
    if (idx > this.lastEnqueuedScene) {
      this.queueTokens.push({ __sceneBreak: true, sceneIndex: idx });
      this.lastEnqueuedScene = idx;
    }

    if (chunk.length > 120) {
      // Proxy non-streaming trả về cả cục -> tách thành từng từ + khoảng trắng/xuống dòng để nhả dần
      const tokens = chunk.match(/\S+\s*|\s+/g) || [chunk];
      this.queueTokens.push(...tokens);
      this.skipBtn?.classList.remove('hidden');
      this.startTypewriter();
    } else {
      // SSE streaming thật từ key trực tiếp -> throttle 60ms để không giật DOM
      this.ssePendingChunk += chunk;
      if (!this.sseThrottleTimer) {
        this.sseThrottleTimer = setTimeout(() => {
          const batch = this.ssePendingChunk;
          this.ssePendingChunk = '';
          this.sseThrottleTimer = null;
          if (batch) this.feedText(batch);
        }, 60);
      }
    }
  },

  startTypewriter() {
    if (this.typeTimer) return;
    this.typeTimer = setInterval(() => {
      // Bỏ qua marker ranh giới cảnh ở đầu hàng đợi, cập nhật cảnh đang hiển thị
      while (this.queueTokens.length > 0 && typeof this.queueTokens[0] === 'object' && this.queueTokens[0].__sceneBreak) {
        this.currentDisplayScene = this.queueTokens.shift().sceneIndex;
      }
      if (this.queueTokens.length === 0) {
        clearInterval(this.typeTimer);
        this.typeTimer = null;
        this.skipBtn?.classList.add('hidden');
        return;
      }
      // Lấy tối đa N từ (bỏ qua marker nếu lọt vào giữa đợt lấy, tránh "[object Object]" lọt ra màn hình)
      const step = [];
      while (step.length < TYPEWRITER_WORDS_PER_TICK && this.queueTokens.length > 0) {
        const next = this.queueTokens[0];
        if (typeof next === 'object' && next.__sceneBreak) {
          this.currentDisplayScene = next.sceneIndex;
          this.queueTokens.shift();
          continue;
        }
        step.push(this.queueTokens.shift());
      }
      if (step.length > 0) this.feedText(step.join(''));
    }, TYPEWRITER_TICK_MS);
  },

  // Append-Only: dòng kết thúc bằng '\n' -> parse block sách chuẩn & chốt DOM;
  // phần cuối dở dang giữ ở #streaming-tail
  feedText(str) {
    const container = document.getElementById('story-content');
    if (!container || !this.tailEl) return;

    const combined = this.pendingLine + str;
    const parts = combined.split(/\r?\n/);
    this.pendingLine = parts.pop() || '';

    for (const rawLine of parts) {
      const line = rawLine.trim();
      if (!line) continue;
      const blocks = window.ChapterEngine.parseTextToBlocks(line);
      blocks.forEach((b) => {
        const el = createBlockElement(b);
        if (el) container.insertBefore(el, this.tailEl);
      });
    }

    this.tailEl.textContent = this.pendingLine;

    if (this.autoFollow) {
      window.scrollTo({ top: document.documentElement.scrollHeight });
    }
  },

  // Xả toàn bộ chữ đang chờ (khi bấm "Hiện hết cảnh", xong cảnh hoặc dừng khẩn)
  flushAll() {
    this.stopTimers();
    let remaining = '';
    if (this.ssePendingChunk) {
      remaining += this.ssePendingChunk;
      this.ssePendingChunk = '';
    }
    if (this.queueTokens.length > 0) {
      // Bỏ qua marker ranh giới cảnh (object) khi nối chuỗi, tránh "[object Object]" lọt ra màn hình
      remaining += this.queueTokens.filter((t) => typeof t === 'string').join('');
      this.queueTokens = [];
    }
    if (remaining) this.feedText(remaining);

    // Chốt nốt dòng cuối dở dang thành block chuẩn
    if (this.pendingLine.trim()) {
      this.feedText('\n');
    }
    if (this.tailEl) this.tailEl.textContent = '';
    this.skipBtn?.classList.add('hidden');
  },

  // Dừng khẩn: chỉ xả chữ còn đợi của cảnh ĐANG hiện, hủy chữ của các cảnh sau đã fetch trước
  flushCurrentSceneOnly() {
    this.stopTimers();
    this.stopSwitchTimer?.();
    // Hủy batch SSE đang chờ (có thể thuộc cảnh sau; cùng lắm mất vài từ của cảnh hiện tại, đã lưu trong bản nháp)
    this.ssePendingChunk = '';
    let remainingText = '';
    while (this.queueTokens.length > 0) {
      const item = this.queueTokens.shift();
      if (typeof item === 'object' && item.__sceneBreak && item.sceneIndex > this.currentDisplayScene) {
        break;
      }
      if (typeof item === 'string') remainingText += item;
    }
    this.queueTokens = [];
    if (remainingText) this.feedText(remainingText);

    // Chốt nốt dòng cuối dở dang thành block chuẩn
    if (this.pendingLine.trim()) {
      this.feedText('\n');
    }
    if (this.tailEl) this.tailEl.textContent = '';
    this.skipBtn?.classList.add('hidden');
    this.followBtn?.classList.add('hidden');
  },

  onSceneDone(sceneText, sceneIndex = 0) {
    // Dự phòng nếu non-streaming không bắn onToken nào
    if (!this.sceneReceivedText && sceneText) {
      this.pushChunk(sceneText, sceneIndex);
    }
    // Chốt sạch cảnh nếu đang SSE; nếu đang typewriter chậm rãi thì để người đọc đọc tiếp
    // (cảnh kế tiếp sẽ nối vào queueTokens ngay sau cảnh hiện tại, không bị mất chữ)
    if (this.queueTokens.length === 0) {
      this.flushAll();
    } else {
      this.queueTokens.push('\n\n');
    }
    this.sceneReceivedText = false;
  },

  showPauseNote(sceneNum, totalScenes) {
    this.flushAll();
    const container = document.getElementById('story-content');
    if (this.tailEl) {
      this.tailEl.remove();
      this.tailEl = null;
    }
    if (container) {
      const note = document.createElement('p');
      note.className = 'stream-pause-note';
      note.textContent = `— Đã tạm dừng ở Cảnh ${sceneNum}/${totalScenes} — bấm "Viết chương tiếp" để chạy tiếp —`;
      container.appendChild(note);
    }
    this.cleanupUI();
  },

setChapterSubtitle(title) {
  const container = document.getElementById('story-content');
  if (!container || !title) return;
  let sub = container.querySelector('.chapter-subtitle');
  if (!sub) {
    sub = document.createElement('h2');
    sub.className = 'chapter-subtitle';
    container.prepend(sub);
  }
  sub.textContent = title;
},

  finishChapter(chapterRecord) {
    this.flushAll();
    if (this.tailEl) {
      this.tailEl.remove();
      this.tailEl = null;
    }
    this.cleanupUI();
    // Đồng bộ lại chuẩn 1 lần duy nhất mà giữ nguyên vị trí cuộn của người đọc
    const savedY = window.scrollY;
    renderChapter(chapterRecord);
    window.scrollTo({ top: savedY });
  },

  stopTimers() {
    if (this.typeTimer) {
      clearInterval(this.typeTimer);
      this.typeTimer = null;
    }
    if (this.sseThrottleTimer) {
      clearTimeout(this.sseThrottleTimer);
      this.sseThrottleTimer = null;
    }
    this.stopSwitchTimer();
  },

  cleanupUI() {
    this.active = false;
    this.stopTimers();
    // Dọn cả dòng đang gõ dở (lỗi dàn ý thì trang trống không còn con trỏ nhấp nháy)
    if (this.tailEl) {
      this.tailEl.remove();
      this.tailEl = null;
    }
    this.followBtn?.classList.add('hidden');
    this.skipBtn?.classList.add('hidden');
  }
};

function renderCharDrawer() {
  const list = document.getElementById('char-drawer-list');
  list.innerHTML = '';
  const allChars = Object.values(codex);
  const roleOrder = { protagonist: 0, ally: 1, antagonist: 1, supporting: 2, npc: 3 };
  const rank = (c) => roleOrder[c.role] ?? (window.CodexParser?.isMainCharacter(c) ? 0 : 2);
  const mainChars = allChars.filter((c) => c.role !== 'npc').sort((a, b) => rank(a) - rank(b));
  const npcs = allChars.filter((c) => c.role === 'npc');

  if (allChars.length === 0) {
    list.innerHTML = '<p class="docx-status">Chưa có nhân vật nào.</p>';
    return;
  }

  const makeCharCard = (char, isNpc) => {
    const card = document.createElement('div');
    card.className = 'char-card';
    card.addEventListener('click', () => {
      document.getElementById('char-drawer-backdrop').classList.add('hidden');
      openCodex(char.name);
    });

    if (char.portrait) {
      const wrap = document.createElement('div');
      wrap.className = 'char-drawer-avatar';
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

    const isMain = window.CodexParser.isMainCharacter(char);
    const roleLabel = ROLE_LABELS[char.role] || (isMain
      ? (char.portrait ? 'Nhân vật chính' : 'Nhân vật chính • chưa có ảnh')
      : 'Nhân vật phụ');

    const badgeEl = document.createElement('span');
    badgeEl.className = isMain ? 'char-badge-main' : 'char-badge-sub';
    badgeEl.textContent = roleLabel;

    info.appendChild(nameEl);
    info.appendChild(badgeEl);
    if (isNpc) {
      const npcEl = document.createElement('div');
      npcEl.className = 'char-card-state';
      npcEl.textContent = `Gặp lần cuối: Chương ${char.lastSeenChapter || 1} • ${char.appearances || 1} lần`;
      info.appendChild(npcEl);
      if ((char.appearances || 1) >= 3) {
        const hintEl = document.createElement('div');
        hintEl.className = 'char-card-state';
        hintEl.textContent = 'Xuất hiện nhiều — giữ làm Nhân vật phụ? (bấm vào hồ sơ để đổi vai)';
        info.appendChild(hintEl);
      }
    } else if (stateParts.length > 0) {
      const stateEl = document.createElement('div');
      stateEl.className = 'char-card-state';
      stateEl.textContent = stateParts.join(' • ');
      info.appendChild(stateEl);
    }
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
    return card;
  };

  mainChars.forEach((char) => list.appendChild(makeCharCard(char, false)));
  if (npcs.length > 0) {
    const details = document.createElement('details');
    details.className = 'npc-drawer-details';
    const summary = document.createElement('summary');
    summary.textContent = `Quần chúng đã gặp (${npcs.length}) ▾`;
    details.appendChild(summary);
    npcs.forEach((char) => details.appendChild(makeCharCard(char, true)));
    list.appendChild(details);
  }
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
  statusEl.textContent = 'Đang tự động nhận diện codex...';
  let parsed;
  try {
    parsed = await window.CodexParser.autoSplitDocxCodex(text);
  } catch (err) {
    statusEl.textContent = `Lỗi tách codex: ${err.message}`;
    return;
  }
  // Không tự lưu nữa — mở màn Xem trước & Chọn để người dùng tick mục cần lưu
  openPreviewPickModal(parsed, { fromDocx: true });
  statusEl.textContent = 'Đã nhận diện xong, chọn mục cần lưu rồi bấm Lưu.';
}

// Lưu các mục đã tick ở màn Preview & Pick (dùng chung cho .docx và gõ tay nhiều mục)
async function saveParsedCodex(parsed) {
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

  // Gộp luật mới vào luật đã có (theo nội dung) — tải file nhân vật sau file thế giới không xóa luật thế giới
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
  renderCharDrawer();
  await loadAndRenderLatestChapter();
}
// Xóa toàn bộ codex (tất cả nhân vật + luật thế giới) — chỉ codex, không động tới truyện/chương đã viết
async function deleteAllCodex() {
  const statusEl = document.getElementById('docx-status');
  try {
    await window.StoryDB.db.characters.clear();
    await window.StoryDB.db.worldRules.clear();
  } catch (err) {
    statusEl.textContent = `Lỗi khi xóa codex: ${err.message}`;
    return;
  }
  for (const k of Object.keys(codex)) delete codex[k];
  document.getElementById('codex-review-list').innerHTML = '';
  document.getElementById('codex-review-info').textContent = '';
  // Dọn cả dấu vết file .docx đã tải (không thì mở lại bảng nhập nó hiện lại) và form sửa đang mở (không thì lưu lại là nhân vật sống lại)
  docxCodex = null;
  renderDocxPreview(null);
  localStorage.removeItem(DOCX_CODEX_KEY);
  document.getElementById('codex-review-wrap').classList.add('hidden');
  document.getElementById('codex-form').classList.add('hidden');
  renderCharDrawer();
  await loadAndRenderLatestChapter();
  statusEl.textContent = 'Đã xóa toàn bộ codex.';
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

  const isMain = window.CodexParser.isMainCharacter(char);
  const roleLabel = ROLE_LABELS[char.role] || (isMain
    ? (char.portrait ? 'Nhân vật chính' : 'Nhân vật chính • chưa có ảnh')
    : 'Nhân vật phụ');

  document.getElementById('codex-name').textContent = char.name;
  document.getElementById('codex-kind').textContent = roleLabel;

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
    <div class="setting-group"><label>Vai trò (bấm để đổi)</label><div class="role-pill-row" id="codex-role-pills">
      ${['protagonist', 'ally', 'antagonist', 'supporting'].map((r) => `<button type="button" class="role-pill${char.role === r ? ' active' : ''}" data-role="${r}">${ROLE_LABELS[r]}</button>`).join('')}
    </div></div>
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
    // D-01: đồng bộ trạng thái lên cả ledger (giữ pickedUpItems cũ của ledger — form chỉ sửa 3 trường)
    const l2Now = await window.StoryMemory.getL2Ledger();
    l2Now.characterStates = { ...(l2Now.characterStates || {}), [char.name]: { ...(l2Now.characterStates?.[char.name] || {}), ...char.state } };
    await window.StoryDB.db.ledger.put({ key: 'current', value: l2Now, updatedAt: Date.now() });
    renderCharDrawer();
    document.getElementById('codex-modal').classList.add('hidden');
  });

  body.querySelectorAll('#codex-role-pills .role-pill').forEach((pill) => {
    pill.addEventListener('click', async () => {
      const role = pill.dataset.role;
      char.role = role;
      char.isMain = role === 'protagonist';
      await window.StoryDB.db.characters.put(char);
      body.querySelectorAll('#codex-role-pills .role-pill').forEach((b) => b.classList.toggle('active', b.dataset.role === role));
      document.getElementById('codex-kind').textContent = ROLE_LABELS[role];
      await syncCodexFromDB();
    });
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

// WF-01: khôi phục truyện từ bản dự phòng gần nhất (chỉ giữ 1 bản, xem #new-story-btn)
async function restoreLastStoryBackup() {
  if (window.ChapterEngine?.isWriting() || window.EndlessManager?.isRunning()) {
    alert('Hãy dừng viết trước khi khôi phục bản dự phòng.');
    return;
  }
  const snap = await window.StoryDB.getSetting('last_story_backup', null);
  if (!snap || !Array.isArray(snap.chapters) || snap.chapters.length === 0) {
    alert('Chưa có bản dự phòng truyện nào.');
    return;
  }
  // Khôi phục sẽ xóa truyện hiện tại nên hỏi lại khi đang có truyện (tránh bấm nhầm)
  const current = await window.StoryDB.db.chapters.toArray();
  if (current.length > 0 && !confirm('Khôi phục sẽ xóa truyện hiện tại và thay bằng bản dự phòng gần nhất. Tiếp tục?')) return;
  await window.StoryDB.db.chapters.clear();
  await window.StoryDB.db.summaries.clear();
  await window.StoryDB.db.ledger.clear();
  await window.StoryDB.db.chapters.bulkPut(snap.chapters);
  if (snap.summaries?.length) await window.StoryDB.db.summaries.bulkPut(snap.summaries);
  if (snap.ledger?.length) await window.StoryDB.db.ledger.bulkPut(snap.ledger);
  // FIX-LEAK: bản backup mới có cả codex — chỉ chạm nhân vật/luật khi snapshot có chúng (backup cũ không có thì giữ nguyên codex hiện tại)
  if (snap.characters) {
    await window.StoryDB.db.characters.clear();
    if (snap.characters.length) await window.StoryDB.db.characters.bulkPut(snap.characters);
  }
  if (snap.worldRules) {
    await window.StoryDB.db.worldRules.clear();
    if (snap.worldRules.length) await window.StoryDB.db.worldRules.bulkPut(snap.worldRules);
  }
  if (snap.characters || snap.worldRules) await syncCodexFromDB();
  await loadAndRenderLatestChapter();
}

function setupEvents(settings) {
  const settingsModal = document.getElementById('settings-modal');
  const importModal = document.getElementById('import-codex-modal');
  const codexModal = document.getElementById('codex-modal');
  const setupModal = document.getElementById('setup-modal');
  const tocModal = document.getElementById('toc-modal');

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

  const unifiedAddModal = document.getElementById('unified-add-modal');
  const previewPickModal = document.getElementById('preview-pick-modal');
  [settingsModal, importModal, codexModal, setupModal, tocModal, unifiedAddModal, previewPickModal].forEach((backdrop) => {
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

  // Xóa toàn bộ codex — hỏi xác nhận vì không khôi phục được
  document.getElementById('delete-all-codex-btn').addEventListener('click', async () => {
    if (!confirm('Xóa toàn bộ codex (tất cả nhân vật + luật thế giới)? Không khôi phục được.')) return;
    await deleteAllCodex();
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

  // Phần 2: Pool Key, lựa chọn model, daily cap, status listener
  const modelSelect = document.getElementById('model-mode-select');
  modelSelect.addEventListener('change', async () => {
    const mode = modelSelect.value;
    modelSelect.disabled = true;
    const db = window.StoryDB.db;
    try {
      await db.transaction('rw', db.settings, async () => {
        const cfg = await window.StoryDB.getSetting('apiConfig', {});
        cfg.modelMode = mode;
        cfg.freeOnlyMode = mode === 'free';
        await window.StoryDB.setSetting('apiConfig', cfg);
      });
    } catch {
      modelSelect.disabled = false;
      await refreshSettingsUI();
      alert('Không lưu được lựa chọn model. Vui lòng thử lại.');
    } finally {
      modelSelect.disabled = false;
    }
  });

  document.getElementById('daily-cap-input').addEventListener('change', async (e) => {
    const cap = Math.max(10, Number(e.target.value) || 100);
    const db = window.StoryDB.db;
    await db.transaction('rw', db.settings, async () => {
      const cfg = await window.StoryDB.getSetting('apiConfig', {});
      cfg.dailyCap = cap;
      await window.StoryDB.setSetting('apiConfig', cfg);
    });
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
    if (state.type === 'call_started') {
      startCooldownBanner(null);
      StreamRenderer.startSwitchTimer();
      return;
    }
    if (state.type === 'first_token' || state.type === 'call_ended') {
      StreamRenderer.stopSwitchTimer();
      if (state.type === 'call_ended' && !cooldownTimer) startCooldownBanner(null);
      return;
    }
    if (state.type === 'waiting') {
      StreamRenderer.updateSwitchButton();
    }
    if (state.type === 'budget') {
      document.getElementById('budget-display').textContent = `${state.used}/${state.cap} calls hôm nay`;
      // FIX-COUNTER: vẽ lại danh sách pool (requestsToday từng proxy) khi modal Cài đặt đang mở
      const settingsModalEl = document.getElementById('settings-modal');
      if (settingsModalEl && !settingsModalEl.classList.contains('hidden')) refreshSettingsUI();
    } else if (state.type === 'all_cooldown') {
      startCooldownBanner(state.resumeAt);
      refreshSettingsUI();
    } else if (state.type === 'premium_fallback') {
      startCooldownBanner(null);
      const banner = document.getElementById('cooldown-banner');
      banner.textContent = 'Lượt này đang dùng Premium thay cho Free.';
      banner.classList.remove('hidden');
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
  const startWriteBtn = document.getElementById('start-write-ch1-btn');

  // Viết chương tiếp (dùng chung cho nút viết thường và viết theo gợi ý)
  async function startWriting(userDirection = '', onDone) {
    // Đang viết dở thì không mở thêm phiên viết nữa (tránh ẩn mất nút Dừng)
    if (window.ChapterEngine.isWriting()) return;
    document.getElementById('suggestion-panel').classList.add('hidden');
    writeBtn.disabled = true;
    document.getElementById('endless-start-btn').disabled = true;
    document.getElementById('goto-next-chapter-btn').disabled = true;
    document.getElementById('prev-chapter-btn').disabled = true;
    document.getElementById('next-chapter-btn').disabled = true;
    document.getElementById('suggest-next-btn').disabled = true;
    if (startWriteBtn) startWriteBtn.disabled = true;
    ch1Input.disabled = true;
    stopControls.classList.remove('hidden');
    statusEl.classList.remove('hidden');
    const newStoryBtn = document.getElementById('new-story-btn');
    if (newStoryBtn) newStoryBtn.disabled = true;

    try {
    await window.ChapterEngine.writeNextChapter({
      userDirection,
      onStatus: (msg) => {
        statusEl.textContent = msg;
      },
      onChapterStart: (chapterNumber, existingScenes) => {
        StreamRenderer.start(chapterNumber, existingScenes);
      },
      onOutlineReady: (_chNum, title) => {
        StreamRenderer.setChapterSubtitle(title);
      },
      onSceneStream: (chunk, _full, sceneIdx) => {
        StreamRenderer.pushChunk(chunk, sceneIdx);
      },
      onSceneDone: (_sceneIdx, sceneText) => {
        StreamRenderer.onSceneDone(sceneText, _sceneIdx);
      },
      onAborted: (sceneNum, totalScenes) => {
        StreamRenderer.showPauseNote(sceneNum, totalScenes);
      },
      onError: () => {
        StreamRenderer.cleanupUI();
      },
      onChapterReady: async (chapterRecord) => {
        const chars = await window.StoryDB.db.characters.toArray();
        codex = Object.fromEntries(chars.map((c) => [c.name, c]));
        renderCharDrawer();
        currentChapterNumber = chapterRecord.number;
        showEmptyStartScreen(false);
        StreamRenderer.finishChapter(chapterRecord);
        if (onDone) onDone(chapterRecord);
      }
    });

    } finally {
      writeBtn.disabled = false;
      document.getElementById('endless-start-btn').disabled = false;
      document.getElementById('goto-next-chapter-btn').disabled = false;
      document.getElementById('prev-chapter-btn').disabled = false;
      document.getElementById('next-chapter-btn').disabled = false;
      document.getElementById('suggest-next-btn').disabled = false;
      if (startWriteBtn) startWriteBtn.disabled = false;
      ch1Input.disabled = false;
      if (newStoryBtn) newStoryBtn.disabled = false;
      stopControls.classList.add('hidden');
    }
  }

  writeBtn.addEventListener('click', () => startWriting());

  document.getElementById('graceful-stop-btn').addEventListener('click', () => {
    if (window.EndlessManager) window.EndlessManager.stopEndlessGraceful();
    else window.ChapterEngine.requestGracefulStop();
    statusEl.textContent = 'Sẽ dừng sau khi viết xong chương hiện tại và cập nhật bộ nhớ...';
  });

  document.getElementById('hard-stop-btn').addEventListener('click', () => {
    StreamRenderer.flushCurrentSceneOnly(); // Dừng khẩn: chỉ xả cảnh đang hiện, hủy chữ các cảnh sau đã fetch trước
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
    document.getElementById('prev-chapter-btn').disabled = true;
    document.getElementById('next-chapter-btn').disabled = true;
    document.getElementById('suggest-next-btn').disabled = true;
    if (startWriteBtn) startWriteBtn.disabled = true;
    ch1Input.disabled = true;
    stopControls.classList.remove('hidden');
    statusEl.classList.remove('hidden');
    const newStoryBtn = document.getElementById('new-story-btn');
    if (newStoryBtn) newStoryBtn.disabled = true;

    try {
    await window.EndlessManager.startEndlessMode({
      onStatus: (msg) => {
        statusEl.textContent = msg;
      },
      onChapterStart: (chapterNumber, existingScenes) => {
        StreamRenderer.start(chapterNumber, existingScenes);
      },
      onOutlineReady: (_chNum, title) => {
        StreamRenderer.setChapterSubtitle(title);
      },
      onSceneStream: (chunk, _full, sceneIdx) => {
        StreamRenderer.pushChunk(chunk, sceneIdx);
      },
      onSceneDone: (_sceneIdx, sceneText) => {
        StreamRenderer.onSceneDone(sceneText, _sceneIdx);
      },
      onAborted: (sceneNum, totalScenes) => {
        StreamRenderer.showPauseNote(sceneNum, totalScenes);
      },
      onError: () => {
        StreamRenderer.cleanupUI();
      },
      onChapterReady: async (chapterRecord) => {
        const chars = await window.StoryDB.db.characters.toArray();
        codex = Object.fromEntries(chars.map((c) => [c.name, c]));
        renderCharDrawer();
        currentChapterNumber = chapterRecord.number;
        showEmptyStartScreen(false);
        StreamRenderer.finishChapter(chapterRecord);
      },
      onFinished: () => {
        writeBtn.disabled = false;
        endlessBtn.disabled = false;
        document.getElementById('goto-next-chapter-btn').disabled = false;
        document.getElementById('prev-chapter-btn').disabled = false;
        document.getElementById('next-chapter-btn').disabled = false;
        document.getElementById('suggest-next-btn').disabled = false;
        if (startWriteBtn) startWriteBtn.disabled = false;
        ch1Input.disabled = false;
        stopControls.classList.add('hidden');
      }
    });
    } finally {
      if (newStoryBtn) newStoryBtn.disabled = false;
    }
  });

  document.getElementById('export-all-btn').addEventListener('click', () => {
    window.EndlessManager.exportAllStory();
  });
  document.getElementById('export-current-btn').addEventListener('click', () => {
    window.EndlessManager.exportCurrentChapterMd(currentChapterNumber);
  });

  // Nút "Bắt đầu truyện mới" (WF-01: chặn xóa khi đang viết + snapshot 1 bản mới nhất trước khi xóa)
  document.getElementById('new-story-btn')?.addEventListener('click', async () => {
    if (window.ChapterEngine?.isWriting() || window.EndlessManager?.isRunning()) {
      alert('Đang viết chương — hãy bấm Dừng trước khi bắt đầu truyện mới.');
      return;
    }

    const ok = confirm(
      'Bạn đã sao lưu/xuất truyện hiện tại chưa?\nApp sẽ tự lưu 1 bản dự phòng gần nhất trước khi xóa các chương cũ để bắt đầu truyện mới.'
    );
    if (!ok) return;

    // Snapshot 1 bản mới nhất vào settings trước khi xóa (chỉ giữ 1 bản; dữ liệu đã mất trước đó không khôi phục được)
    // FIX-LEAK: backup cả characters + worldRules (không chỉ chương/sổ cái) để Khôi phục trả lại đủ truyện
    const [chapters, summaries, ledger, characters, worldRules] = await Promise.all([
      window.StoryDB.db.chapters.toArray(),
      window.StoryDB.db.summaries.toArray(),
      window.StoryDB.db.ledger.toArray(),
      window.StoryDB.db.characters.toArray(),
      window.StoryDB.db.worldRules.toArray()
    ]);
    if (chapters.length > 0) {
      await window.StoryDB.setSetting('last_story_backup', {
        chapters,
        summaries,
        ledger,
        characters,
        worldRules,
        savedAt: Date.now()
      });
    }

    // FIX-LEAK: xóa cả nhân vật + luật thế giới (trước đây chỉ xóa chương/sổ cái nên truyện cũ vẫn chui vào dàn ý mới qua L1)
    await Promise.all([
      window.StoryDB.db.chapters.clear(),
      window.StoryDB.db.summaries.clear(),
      window.StoryDB.db.ledger.clear(),
      window.StoryDB.db.characters.clear(),
      window.StoryDB.db.worldRules.clear(),
      window.StoryDB.setSetting('chapter_draft', null),
      window.StoryDB.setSetting('recent_motifs', []),
      window.StoryDB.setSetting('checkpoint', null),
      window.StoryDB.setSetting('pruned_npcs_backup', [])
    ]);
    // Xóa luôn seed codex cũ trong localStorage (chỉ đọc 1 lần lúc khởi động, đã migrate sang DB)
    try { localStorage.removeItem(CODEX_KEY); } catch { /* bỏ qua */ }
    // Đồng bộ lại codex RAM + Drawer + thẻ màn bắt đầu từ DB (đã trống)
    await syncCodexFromDB();
    settingsModal.classList.add('hidden');
    await loadAndRenderLatestChapter();
  });

  // Khôi phục truyện từ bản dự phòng gần nhất (WF-01)
  document.getElementById('restore-story-btn')?.addEventListener('click', () => restoreLastStoryBackup());

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

  // Chạm CHAPTER X -> mở Mục lục nhảy chương
  document.getElementById('chapter-title')?.addEventListener('click', async () => {
    const chapters = await window.StoryDB.db.chapters.orderBy('number').toArray();
    const listEl = document.getElementById('toc-list');
    listEl.innerHTML = '';
    if (chapters.length === 0) {
      listEl.innerHTML = '<p class="docx-status">Chưa có chương nào được lưu.</p>';
    } else {
      chapters.forEach((ch) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `toc-item${ch.number === currentChapterNumber ? ' active' : ''}`;
        const tok = ch.usage?.totalTokens ? ` • ${ch.usage.totalTokens.toLocaleString('vi-VN')} tok` : '';
        btn.innerHTML = `<span>CHAPTER ${ch.number}${ch.title ? ` — ${ch.title}` : ''}</span><span class="toc-meta">${ch.wordCount || 0} từ${tok}</span>`;
        btn.addEventListener('click', async () => {
          tocModal.classList.add('hidden');
          await openChapterByNumber(ch.number);
        });
        listEl.appendChild(btn);
      });
    }
    tocModal.classList.remove('hidden');
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

  // Màn hình "Bắt đầu truyện mới" (khi chưa có chương nào): nhập nhanh nhân vật/
  // bối cảnh 1 dòng + gu truyện, rồi viết chương 1 (Seed Mode nếu codex trống).
  // Màn hình tự ẩn khi chương 1 viết xong nhờ showEmptyStartScreen(false) trong onChapterReady
  document.getElementById('quick-char-add')?.addEventListener('click', () => openUnifiedAddModal('char'));
  document.getElementById('quick-world-add')?.addEventListener('click', () => openUnifiedAddModal('world'));
  document.getElementById('unified-upload-docx-btn')?.addEventListener('click', () => docxInput.click());
  document.getElementById('unified-add-next-btn')?.addEventListener('click', async () => {
    const text = document.getElementById('unified-add-textarea').value.trim();
    if (!text) return;
    const items = window.CodexParser.splitMultiInput(text);
    if (items.length === 0) return;
    document.getElementById('unified-add-modal').classList.add('hidden');
    document.getElementById('unified-add-textarea').value = '';
    if (items.length === 1) {
      await saveSingleTypedItem(unifiedAddKind, items[0]);
      return;
    }
    const parsed = unifiedAddKind === 'char'
      ? { characters: items.map((line) => window.CodexParser.parseSingleLineCharacter(line, true)).filter(Boolean), hardRules: [], softLore: [], source: 'typed' }
      : { characters: [], hardRules: items, softLore: [], source: 'typed' };
    openPreviewPickModal(parsed, { fromDocx: false });
  });
  document.getElementById('preview-chars-section')?.addEventListener('click', (e) => {
    const pill = e.target.closest('.role-pill');
    if (!pill) return;
    const c = previewDraft.characters[Number(pill.dataset.cidx)];
    if (!c) return;
    c.role = pill.dataset.role;
    pill.parentElement.querySelectorAll('.role-pill').forEach((b) => b.classList.toggle('active', b === pill));
  });
  document.getElementById('preview-ai-role-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const roles = await window.CodexParser.suggestRolesWithAI(previewDraft.characters);
      let protagonistTaken = false;
      previewDraft.characters.forEach((c, idx) => {
        const r = roles[String(idx)];
        if (!['protagonist', 'ally', 'antagonist', 'supporting'].includes(r)) return;
        if (r === 'protagonist') {
          if (protagonistTaken) { c.role = 'supporting'; return; } // Chỉ đúng 1 protagonist
          protagonistTaken = true;
        }
        c.role = r;
      });
      document.querySelectorAll('#preview-chars-section .role-pill').forEach((pill) => {
        pill.classList.toggle('active', previewDraft.characters[Number(pill.dataset.cidx)]?.role === pill.dataset.role);
      });
    } catch (err) {
      alert(`Không gợi ý được vai trò: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  });
  document.getElementById('preview-confirm-save-btn')?.addEventListener('click', async () => {
    const checkedChars = [...document.querySelectorAll('#preview-chars-section [data-cchk]:checked')]
      .map((el) => previewDraft.characters[Number(el.dataset.cchk)])
      .filter(Boolean)
      .map((c) => ({ ...c, isMain: c.role === 'protagonist' }));
    const allRulesEl = document.getElementById('preview-all-rules-chk');
    let hardRules = [];
    let softLore = [];
    if (!allRulesEl) {
      const picked = [...document.querySelectorAll('#preview-rules-section [data-rchk]:checked')]
        .map((el) => previewDraft.allRules[Number(el.dataset.rchk)])
        .filter(Boolean);
      hardRules = picked.filter((r) => r.type === 'hard_rule').map((r) => r.content);
      softLore = picked.filter((r) => r.type === 'soft_lore').map((r) => r.content);
    } else if (allRulesEl.checked) {
      hardRules = previewDraft.hardRules;
      softLore = previewDraft.softLore;
    }
    const filtered = { characters: checkedChars, hardRules, softLore, source: previewDraft.source || 'typed' };
    document.getElementById('preview-pick-modal').classList.add('hidden');
    try {
      await saveParsedCodex(filtered);
      await syncCodexFromDB();
      if (previewDraft.fromDocx) {
        renderSavedResults(filtered);
        document.getElementById('docx-status').textContent = 'Đã nhận diện và lưu xong.';
      }
    } catch (err) {
      document.getElementById('docx-status').textContent = `Lỗi khi lưu codex: ${err.message}`;
    }
  });

  document.getElementById('start-open-font-btn')?.addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
  });

  document.getElementById('start-import-docx-link')?.addEventListener('click', () => {
    renderDocxPreview(docxCodex);
    importModal.classList.remove('hidden');
  });

  document.getElementById('start-write-ch1-btn')?.addEventListener('click', async () => {
    // Lấy luôn dòng đang gõ dở trong ô input nếu người dùng quên bấm "+" (không còn mảng tạm)
    const pendingChar = document.getElementById('quick-char-input')?.value.trim();
    const pendingWorld = document.getElementById('quick-world-input')?.value.trim();
    if (pendingChar) {
      for (const item of window.CodexParser.splitMultiInput(pendingChar)) await saveSingleTypedItem('char', item);
      document.getElementById('quick-char-input').value = '';
    }
    if (pendingWorld) {
      for (const item of window.CodexParser.splitMultiInput(pendingWorld)) await saveSingleTypedItem('world', item);
      document.getElementById('quick-world-input').value = '';
    }

    // Lưu gu truyện từ màn khởi đầu
    const getStartSeg = (key, fb) =>
      document.querySelector(`[data-start-seg="${key}"] .seg-btn.active`)?.dataset.val || fb;
    currentStoryPrefs = {
      genres: Array.from(document.querySelectorAll('#start-genres input:checked')).map((el) => el.value),
      customGenre: '',
      drama: getStartSeg('drama', 'Trung bình'),
      sideCharDeathRate: getStartSeg('deathRate', 'Trung bình'),
      ending: getStartSeg('ending', 'Kết thúc mở'),
      autoFullscreen: Boolean(document.getElementById('start-fullscreen-toggle')?.checked)
    };
    await window.StoryDB.setSetting('storyPrefs', currentStoryPrefs);
    if (currentStoryPrefs.autoFullscreen) toggleFullscreen(true);

    renderCharDrawer();
    const dir = (document.getElementById('ch1-direction-input')?.value || '').trim();
    await startWriting(dir);
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
    // Nạp gu truyện đã lưu để điền sẵn bảng Setup (chỉ mở khi người dùng bấm)
    currentStoryPrefs = { ...DEFAULT_STORY_PREFS, ...((await window.StoryDB.getSetting('storyPrefs', {})) || {}) };
    populateSetupUI(currentStoryPrefs);
  }
});
