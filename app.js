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
// 300 từ/phút ≈ 1 từ mỗi 200ms (chờ thử thực tế 250 / 320 / 420 trên điện thoại thật)
const TYPEWRITER_SPEED_WPM = 300; // Chờ thử thực tế 250 / 320 / 420 trên điện thoại thật
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
  typeTimer: null,
  sseThrottleTimer: null,
  ssePendingChunk: '',
  tailEl: null,
  followBtn: null,
  skipBtn: null,
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
  pushChunk(chunk) {
    if (!this.active || !chunk) return;
    this.sceneReceivedText = true;

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
      if (this.queueTokens.length === 0) {
        clearInterval(this.typeTimer);
        this.typeTimer = null;
        this.skipBtn?.classList.add('hidden');
        return;
      }
      const step = this.queueTokens.splice(0, TYPEWRITER_WORDS_PER_TICK).join('');
      this.feedText(step);
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
      remaining += this.queueTokens.join('');
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

  onSceneDone(sceneText) {
    // Dự phòng nếu non-streaming không bắn onToken nào
    if (!this.sceneReceivedText && sceneText) {
      this.pushChunk(sceneText);
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
  const chars = Object.values(codex).sort((a, b) => {
    const aMain = window.CodexParser?.isMainCharacter(a) ? 1 : 0;
    const bMain = window.CodexParser?.isMainCharacter(b) ? 1 : 0;
    return bMain - aMain;
  });

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
    const roleLabel = isMain
      ? (char.portrait ? 'Nhân vật chính' : 'Nhân vật chính • chưa có ảnh')
      : 'Nhân vật phụ';

    const badgeEl = document.createElement('span');
    badgeEl.className = isMain ? 'char-badge-main' : 'char-badge-sub';
    badgeEl.textContent = roleLabel;

    info.appendChild(nameEl);
    info.appendChild(badgeEl);
    if (stateParts.length > 0) {
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
  } catch (err) {
    statusEl.textContent = `Lỗi khi lưu codex: ${err.message}`;
    return;
  }

  renderCharDrawer();
  await loadAndRenderLatestChapter();
  renderSavedResults(parsed);
  statusEl.textContent = 'Đã nhận diện và lưu xong.';
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
  const roleLabel = isMain
    ? (char.portrait ? 'Nhân vật chính' : 'Nhân vật chính • chưa có ảnh')
    : 'Nhân vật phụ';

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

  [settingsModal, importModal, codexModal, setupModal, tocModal].forEach((backdrop) => {
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
  const startWriteBtn = document.getElementById('start-write-ch1-btn');

  // Viết chương tiếp (dùng chung cho nút viết thường và viết theo gợi ý)
  async function startWriting(userDirection = '', onDone) {
    // Đang viết dở thì không mở thêm phiên viết nữa (tránh ẩn mất nút Dừng)
    if (window.ChapterEngine.isWriting()) return;
    document.getElementById('suggestion-panel').classList.add('hidden');
    writeBtn.disabled = true;
    document.getElementById('endless-start-btn').disabled = true;
    document.getElementById('goto-next-chapter-btn').disabled = true;
    document.getElementById('suggest-next-btn').disabled = true;
    if (startWriteBtn) startWriteBtn.disabled = true;
    ch1Input.disabled = true;
    stopControls.classList.remove('hidden');
    statusEl.classList.remove('hidden');

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
      onSceneStream: (chunk) => {
        StreamRenderer.pushChunk(chunk);
      },
      onSceneDone: (_sceneIdx, sceneText) => {
        StreamRenderer.onSceneDone(sceneText);
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

    writeBtn.disabled = false;
    document.getElementById('endless-start-btn').disabled = false;
    document.getElementById('goto-next-chapter-btn').disabled = false;
    document.getElementById('suggest-next-btn').disabled = false;
    if (startWriteBtn) startWriteBtn.disabled = false;
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
    StreamRenderer.flushAll(); // Xả nốt chữ cảnh đang chạy typewriter trước khi ngắt mạng
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
    if (startWriteBtn) startWriteBtn.disabled = true;
    ch1Input.disabled = true;
    stopControls.classList.remove('hidden');
    statusEl.classList.remove('hidden');

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
      onSceneStream: (chunk) => {
        StreamRenderer.pushChunk(chunk);
      },
      onSceneDone: (_sceneIdx, sceneText) => {
        StreamRenderer.onSceneDone(sceneText);
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
        document.getElementById('suggest-next-btn').disabled = false;
        if (startWriteBtn) startWriteBtn.disabled = false;
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

  // Nút "Bắt đầu truyện mới" (nhắc sao lưu trước khi xóa truyện cũ — single-story)
  document.getElementById('new-story-btn')?.addEventListener('click', async () => {
    const ok = confirm(
      'Bạn đã sao lưu/xuất truyện hiện tại chưa?\nBấm OK để xóa các chương và trạng thái truyện cũ để bắt đầu truyện mới (giữ nguyên cài đặt và API key).'
    );
    if (!ok) return;

    await Promise.all([
      window.StoryDB.db.chapters.clear(),
      window.StoryDB.db.summaries.clear(),
      window.StoryDB.db.ledger.clear(),
      window.StoryDB.setSetting('chapter_draft', null),
      window.StoryDB.setSetting('recent_motifs', []),
      window.StoryDB.setSetting('checkpoint', null)
    ]);
    settingsModal.classList.add('hidden');
    await loadAndRenderLatestChapter();
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
const quickChars = [];
  const quickWorlds = [];

  function renderQuickTags(containerId, items) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    items.forEach((txt, idx) => {
      const span = document.createElement('span');
      span.className = 'quick-tag';
      span.textContent = txt;
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.addEventListener('click', () => {
        items.splice(idx, 1);
        renderQuickTags(containerId, items);
      });
      span.appendChild(x);
      el.appendChild(span);
    });
  }

  const pushQuickItem = (inputId, list, containerId) => {
    const inp = document.getElementById(inputId);
    const val = inp.value.trim();
    if (!val) return;
    list.push(val);
    inp.value = '';
    renderQuickTags(containerId, list);
  };

  document.getElementById('quick-char-add')?.addEventListener('click', () =>
    pushQuickItem('quick-char-input', quickChars, 'quick-char-list')
  );
  document.getElementById('quick-world-add')?.addEventListener('click', () =>
    pushQuickItem('quick-world-input', quickWorlds, 'quick-world-list')
  );

  document.getElementById('start-open-font-btn')?.addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
  });

  document.getElementById('start-import-docx-link')?.addEventListener('click', () => {
    renderDocxPreview(docxCodex);
    importModal.classList.remove('hidden');
  });

  document.getElementById('start-write-ch1-btn')?.addEventListener('click', async () => {
    // Tự động lấy luôn dòng đang gõ dở trong ô input nếu người dùng quên bấm "+"
    pushQuickItem('quick-char-input', quickChars, 'quick-char-list');
    pushQuickItem('quick-world-input', quickWorlds, 'quick-world-list');

    // 1. Lưu các nhân vật 1 dòng (isMain: true)
    for (const line of quickChars) {
      const parsed = window.CodexParser.parseSingleLineCharacter(line, true);
      if (parsed && parsed.name) {
        codex[parsed.name] = parsed;
        await window.StoryDB.db.characters.put(parsed);
      }
    }

    // 2. Lưu bối cảnh 1 dòng -> hard_rule + ghim vào pinned_facts (L1-Core)
    if (quickWorlds.length > 0) {
      const pinned = await window.StoryDB.getSetting('pinned_facts', []);
      for (const w of quickWorlds) {
        await window.StoryDB.db.worldRules.add({ type: 'hard_rule', content: w, updatedAt: Date.now() });
        if (!pinned.includes(w)) pinned.push(w);
      }
      await window.StoryDB.setSetting('pinned_facts', pinned);
    }

    // 3. Lưu gu truyện từ màn khởi đầu
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
