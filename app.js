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
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Bỏ qua nếu không ghi được cài đặt (ví dụ chế độ riêng tư)
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

function saveCodex(nextCodex) {
  try {
    localStorage.setItem(CODEX_KEY, JSON.stringify(nextCodex));
  } catch (err) {
    if (err && err.name === 'QuotaExceededError') {
      alert('Ảnh chân dung quá lớn nên không lưu được nhân vật. Hãy dùng ảnh nhỏ hơn hoặc dán URL ảnh.');
    }
    // Các lỗi khác: bỏ qua như trước
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
    localStorage.setItem(DOCX_CODEX_KEY, JSON.stringify(doc));
  } catch (err) {
    if (err && err.name === 'QuotaExceededError') {
      alert('File DOCX quá lớn nên không lưu được. Hãy dùng file nhỏ hơn.');
    }
    // Các lỗi khác: bỏ qua như trước
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

function openCodex(charName) {
  const char = codex[charName];
  if (!char) return;

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
  document.getElementById('codex-body').textContent = char.description;

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

  document.getElementById('settings-btn').addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
  });

  document.getElementById('open-import-codex-btn').addEventListener('click', () => {
    settingsModal.classList.add('hidden');
    renderDocxPreview(docxCodex);
    importModal.classList.remove('hidden');
  });

  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById(btn.dataset.close).classList.add('hidden');
    });
  });

  [settingsModal, importModal, codexModal].forEach((backdrop) => {
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
    } catch {
      statusEl.textContent = 'Lỗi khi đọc file .docx. Vui lòng kiểm tra lại định dạng file.';
    } finally {
      docxInput.value = '';
    }
  });

  // Lưu nhân vật nhập tay
  document.getElementById('codex-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('input-char-name').value.trim();
    const description = document.getElementById('input-char-desc').value.trim();
    const fileInput = document.getElementById('input-char-image-file');
    const urlInput = document.getElementById('input-char-image-url').value.trim();

    if (!name) return;

    let portrait = urlInput;
    if (fileInput.files && fileInput.files[0]) {
      try {
        portrait = await readFileAsDataURL(fileInput.files[0]);
      } catch {
        alert('Không đọc được ảnh chân dung. Đã dùng URL ảnh (nếu có).');
      }
    }

    codex[name] = { name, description, portrait };
    saveCodex(codex);
    renderChapter(MOCK_CHAPTER);

    e.target.reset();
    importModal.classList.add('hidden');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const settings = loadSettings();
  applySettings(settings);
  renderChapter(MOCK_CHAPTER);
  setupEvents(settings);
});
