const CODE_LINE_RE = /^([A-Z]{2,4})-([A-Z]{3})-(?:\d{4}-)?\d+$/;
const CODE_ANYWHERE_RE = /\b([A-Z]{2,4}-[A-Z]{3}-(?:\d{4}-)?\d+)\b/;

const FIELD_LABELS = [
  [/^(tên|tên đầy đủ|họ tên|name|nhân vật)$/i, 'name'],
  [/^(mã tra cứu|mã hồ sơ|mã|code)$/i, 'code'],
  [/^(danh hiệu|biệt danh|tên khác|bí danh|aliases|alias)$/i, 'aliases'],
  [/^(ngoại hình|diện mạo|giới tính|chủng hệ|tuổi|năm sinh|quê quán|nơi sinh|appearance)$/i, 'appearance'],
  [/^(tính cách|tâm lý|xuất thân|vai trò|phe phái|chức vụ|tổ chức|sở thích|mối quan tâm tình cảm|đặc điểm nổi bật|tình trạng năm \d{4}|personality)$/i, 'personality'],
  [/^(kỹ năng|năng lực|sức mạnh|chiêu thức|đặc quyền zeus|skills|abilities|skills_abilities)$/i, 'skills_abilities'],
  [/^(vật phẩm|túi đồ|trang bị|bảo vật|vũ khí chính|chiến giáp|khu dự trữ bia|inventory|inventory_default)$/i, 'inventory_default'],
  [/^(giọng điệu|cách nói|lời thoại|speech|speech_style)$/i, 'speech_style'],
  [/^(ràng buộc|cấm kỵ|giới hạn|điểm yếu|hard_constraints|constraints)$/i, 'hard_constraints'],
  [/^(điểm mù|điểm mù nội tâm|niềm tin sai lầm|misbelief)$/i, 'misbelief'],
  [/^(vết thương|vết thương lòng|chủ đề cấm kỵ|third ?rail)$/i, 'thirdRail']
];

const STRUCTURAL_HEADING_RE =
  /^(bách khoa|mục lục|cách sử dụng|thiết lập nền|hồ sơ địa phương|truyền khẩu|thế giới và nguồn gốc|quy luật|địa chí|phụ lục|tóm tắt|tổng quan)/i;

function emptyChar(name = '') {
  return {
    name: name.trim(),
    code: '',
    aliases: '',
    appearance: '',
    personality: '',
    skills_abilities: '',
    inventory_default: '',
    speech_style: '',
    hard_constraints: '',
    misbelief: '',
    thirdRail: '',
    isMain: null, // true = Chính, false = Phụ, null = tự động
    portrait: '',
    state: { level: '', injuries: '', inventory: '' }
  };
}

function capitalizeName(raw) {
  return String(raw || '')
    .trim()
    .split(/\s+/)
    .map((w) => {
      if (!w) return '';
      const head = w[0].toLocaleUpperCase('vi-VN');
      // Chỉ hạ thấp phần đuôi khi từ đang VIẾT HOA toàn bộ ('NGUYỄN' -> 'Nguyễn');
      // tên camelCase ('SeedOne') giữ nguyên đuôi.
      const tail = w === w.toLocaleUpperCase('vi-VN') ? w.slice(1).toLocaleLowerCase('vi-VN') : w.slice(1);
      return head + tail;
    })
    .join(' ');
}

function isMainCharacter(char) {
  if (!char) return false;
  if (char.isMain === true) return true;
  if (char.isMain === false) return false;
  return Boolean(
    char.portrait ||
      char.avatar ||
      /-CHR-/i.test(char.code || '') ||
      String(char.personality || char.description || '').length > 500
  );
}

// Parser 1 dòng: "Toàn - Nam - 37 tuổi - Tu tiên giả đến từ thế giới tu tiên" (hỗ trợ ' - ' hoặc ',')
function parseSingleLineCharacter(line, defaultIsMain = true) {
  const parts = String(line || '')
    .trim()
    .replace(/[.。]+$/, '')
    .split(/\s+[-–—]\s+|,\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const char = emptyChar(capitalizeName(parts[0]));
  char.isMain = defaultIsMain;

  const appParts = [];
  const bioParts = [];
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    if (/^(nam|nữ|phi giới tính|khác)$/i.test(seg) || /\b\d{1,4}\s*tuổi\b/i.test(seg)) {
      appParts.push(seg);
    } else {
      bioParts.push(seg);
    }
  }
  char.appearance = appParts.join(', ');
  char.personality = bioParts.join(', ');
  char.description = char.personality || char.appearance;
  return char;
}

// Pass 2 tối giản: CHỈ chạy khi Pass 1 tìm 0 nhân vật và tài liệu không phải file thế giới
function parseMinimalLines(lines) {
  const results = [];
  const isShortDoc = lines.length <= 15;
  const badStartRe = /^(khi|nếu|vì|nhưng|trong|sau|trước|một|những|các|để|từ|tại)\b/i;

  for (const raw of lines) {
    const line = raw.replace(/^[-*•]\s*/, '').trim();
    if (!line || line.length > 220) continue;
    if (/^[A-ZÀ-Ỹ][A-Za-zÀ-ỹ0-9\s]{0,24}:\s+/.test(line)) continue; // Bỏ qua dòng thoại
    if (CODE_ANYWHERE_RE.test(line) || STRUCTURAL_HEADING_RE.test(line)) continue;

    const parts = line.split(/,\s*/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2 || parts.length > 6) continue;

    const first = parts[0];
    const wordCount = first.split(/\s+/).length;
    if (wordCount < 1 || wordCount > 4 || first.length > 32 || /[.?!]/.test(first) || badStartRe.test(first)) {
      continue;
    }

    const rest = parts.slice(1).join(', ');
    const hasIdentitySignal =
      /\b\d{1,4}\s*tuổi\b/i.test(rest) ||
      /(đến từ|quê|thuộc|sinh ra|tu tiên|kiếm tu|pháp sư|thám tử|chiến binh|sát thủ|bác sĩ|học sinh)/i.test(rest);

    if (hasIdentitySignal || isShortDoc) {
      const char = parseSingleLineCharacter(line, null); // isMain = null (auto)
      if (char && char.name) results.push(char);
    }
  }
  return results;
}

function matchStandaloneLabel(line) {
  const clean = line.replace(/^[-*•]\s*/, '').replace(/:\s*$/, '').trim();
  // "NHÂN VẬT" đứng một mình là tiêu đề mục, không phải nhãn tên
  if (/^(nhân vật|character)$/i.test(clean)) return null;
  for (const [re, key] of FIELD_LABELS) {
    if (re.test(clean)) return { key, label: clean };
  }
  return null;
}

function matchInlineLabel(line) {
  const clean = line.replace(/^[-*•]\s*/, '').trim();
  const idx = clean.indexOf(':');
  if (idx <= 0 || idx > 32) return null;
  const rawLabel = clean.slice(0, idx).trim();
  const value = clean.slice(idx + 1).trim();
  if (!value) return null;

  for (const [re, key] of FIELD_LABELS) {
    if (re.test(rawLabel)) return { key, label: rawLabel, value };
  }
  return null;
}

function isIgnoredBanner(line) {
  if (CODE_LINE_RE.test(line)) return true;
  if (/[•|]/.test(line) && CODE_ANYWHERE_RE.test(line)) return true;
  if (STRUCTURAL_HEADING_RE.test(line)) return true;
  if (/^\(.+\)$/.test(line)) return true;
  if (/^(mã tra cứu|đối tượng|phân loại|thuộc tính|dữ liệu)$/i.test(line)) return true;
  if (line.length <= 45 && line === line.toUpperCase() && /[A-ZÀ-Ỹ]/.test(line)) return true;
  return false;
}

function appendField(char, key, value, labelPrefix = '') {
  if (!char || !value) return;
  const text = labelPrefix ? `${labelPrefix}: ${value}` : value;
  if (!char[key]) {
    char[key] = text;
  } else if (!char[key].includes(text)) {
    char[key] = `${char[key]}\n${text}`;
  }
}

function parseCodexText(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const characters = [];
  const hardRules = [];
  const softLore = [];

  let currentChar = null;
  let worldMode = null;
  let activeSubField = null;

  const flushChar = () => {
    if (currentChar && currentChar.name) characters.push(currentChar);
    currentChar = null;
    activeSubField = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^thiết lập nền\b/i.test(line)) {
      worldMode = 'hard';
      const afterColon = line.replace(/^thiết lập nền\s*[:\-–]?\s*/i, '').trim();
      if (afterColon.length > 10) hardRules.push(afterColon);
      continue;
    }
    if (/^(hồ sơ địa phương|truyền khẩu địa phương|truyền khẩu)\b/i.test(line)) {
      worldMode = 'soft';
      const afterColon = line.replace(/^(hồ sơ địa phương|truyền khẩu địa phương|truyền khẩu)\s*[:\-–]?\s*/i, '').trim();
      if (afterColon.length > 10) softLore.push(afterColon);
      continue;
    }
    if (/^(mục lục theo lĩnh vực|cách sử dụng bách khoa)/i.test(line)) {
      worldMode = null;
      continue;
    }
    // Dòng loại hồ sơ: "HỒ SƠ  •  THIẾT LẬP NỀN" (luật cứng) / "HỒ SƠ  •  HỒ SƠ ĐỊA PHƯƠNG" (lore)
    if (/hồ sơ\s*•/i.test(line)) {
      worldMode = /thiết lập nền/i.test(line) ? 'hard' : 'soft';
      activeSubField = null;
      continue;
    }
    // Tiêu đề mục đánh số ("1. Xuất thân", "4.8. ...") — mục mới, không nối tiếp luật/mục trước
    if (/^\d+(\.\d+)*\.\s+/.test(line)) {
      worldMode = null;
      activeSubField = null;
      continue;
    }

    const codeMatch = line.match(CODE_ANYWHERE_RE);
    if (codeMatch && (CODE_LINE_RE.test(line) || /[•|]/.test(line) || /^mã(\s|:|$)/i.test(line) || /^([A-Z]{2,4}-[A-Z]{3}-(?:\d{4}-)?\d+)\s{2,}/.test(line))) {
      const fullCode = codeMatch[1];
      const group = fullCode.split('-')[1];

      if (group === 'CHR') {
        if (!currentChar || (currentChar.code && currentChar.code !== fullCode)) {
          flushChar();
          currentChar = emptyChar('');
        }
        currentChar.code = fullCode;
        // "CODE  |  Tên" — lấy tên từ cùng dòng khi chỉ có đúng 2 phần
        if (!currentChar.name) {
          const parts = line.split(/\s{2,}|[•|]/).map((s) => s.trim()).filter(Boolean);
          if (parts.length === 2 && parts[1].length >= 1 && parts[1].length <= 45 && parts[1] !== parts[1].toUpperCase()) {
            currentChar.name = parts[1];
          }
        }
        worldMode = null;
        activeSubField = null;
      } else if (group === 'RUL') {
        worldMode = 'hard';
        activeSubField = currentChar ? 'hard_constraints' : null;
      } else if (['LOC', 'ENT', 'EVT', 'SEC'].includes(group)) {
        if (!currentChar) worldMode = 'soft';
        activeSubField = null;
      } else if (currentChar && ['ABL', 'PER', 'DLG', 'ART', 'REL'].includes(group)) {
        worldMode = null;
        if (group === 'ABL') activeSubField = 'skills_abilities';
        else if (group === 'PER') activeSubField = 'personality';
        else if (group === 'DLG') activeSubField = 'speech_style';
        else if (group === 'ART') activeSubField = 'inventory_default';
        else if (group === 'REL') activeSubField = 'personality';
      }
      continue;
    }

    const inline = matchInlineLabel(line);
    if (inline) {
      if (inline.key === 'name') {
        if (currentChar && currentChar.name && currentChar.name !== inline.value) flushChar();
        if (!currentChar) currentChar = emptyChar(inline.value);
        else currentChar.name = inline.value;
        worldMode = null;
      } else if (inline.key === 'code') {
        // Chỉ nhận giá trị giống mã (VD: "Mã tra cứu: KAE-CHR-001") — tránh ăn nhầm tiêu đề cột
        const codeInValue = inline.value.match(CODE_ANYWHERE_RE);
        // Chỉ mã nhân vật (-CHR-) mới là mã của nhân vật — mã sự kiện/vật phẩm/luật không ghi đè
        if (codeInValue && codeInValue[1].split('-')[1] === 'CHR') {
          if (!currentChar) currentChar = emptyChar('');
          currentChar.code = codeInValue[1];
        }
      } else if (currentChar) {
        const prefix = /^(giới tính|chủng hệ|tuổi|năm sinh|quê quán|nơi sinh|vai trò|phe phái|chức vụ)$/i.test(
          inline.label
        )
          ? inline.label
          : '';
        appendField(currentChar, inline.key, inline.value, prefix);
      }
      continue;
    }

    const standalone = matchStandaloneLabel(line);
    if (standalone && i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      // "Mã tra cứu" chỉ nhận giá trị là mã nhân vật (-CHR-) — tránh ăn nhầm tiêu đề cột ("Đối tượng") hay mã sự kiện/vật phẩm
      const nextCode = nextLine.match(CODE_LINE_RE);
      const nextIsValue = standalone.key === 'code'
        ? (nextCode && nextCode[2] === 'CHR')
        : (!matchStandaloneLabel(nextLine) && !matchInlineLabel(nextLine) && !CODE_LINE_RE.test(nextLine));
      if (nextIsValue) {
        i++;
        if (standalone.key === 'name') {
          if (currentChar && currentChar.name && currentChar.name !== nextLine) flushChar();
          if (!currentChar) currentChar = emptyChar(nextLine);
          else currentChar.name = nextLine;
          worldMode = null;
        } else if (standalone.key === 'code') {
          if (!currentChar) currentChar = emptyChar('');
          currentChar.code = nextLine;
        } else if (currentChar) {
          const prefix = /^(giới tính|chủng hệ|tuổi|năm sinh|quê quán|nơi sinh|vai trò|phe phái|chức vụ)$/i.test(
            standalone.label
          )
            ? standalone.label
            : '';
          appendField(currentChar, standalone.key, nextLine, prefix);
        }
        continue;
      }
    }

    // Dòng trỏ chéo "XEM THÊM PRN-… · PRN-…" không phải canon
    if (/^xem thêm/i.test(line)) continue;
    if (isIgnoredBanner(line)) continue;

    const cleanContent = line.replace(/^[-*•]\s*/, '');
    if (worldMode === 'hard') {
      if (cleanContent.length > 8) hardRules.push(cleanContent);
      if (currentChar && activeSubField === 'hard_constraints') {
        appendField(currentChar, 'hard_constraints', cleanContent);
      }
    } else if (worldMode === 'soft') {
      if (cleanContent.length > 8) softLore.push(cleanContent);
    } else if (currentChar && activeSubField) {
      appendField(currentChar, activeSubField, cleanContent);
    } else if (currentChar && (cleanContent.match(/\b[A-Z]{2,4}-[A-Z]{3}-(?:\d{4}-)?\d+\b/g) || []).length < 2) {
      // Văn xuôi tự do trong hồ sơ nhân vật (VD: các mục "1. Xuất thân") → tính cách
      appendField(currentChar, 'personality', cleanContent);
    }
  }

  flushChar();
  const isWorldDoc =
      hardRules.length > 0 ||
      softLore.length > 0 ||
      /(thiết lập nền|hồ sơ địa phương|bách khoa thế giới)/i.test(String(text || ''));
    if (characters.length === 0 && !isWorldDoc) {
      characters.push(...parseMinimalLines(lines));
    }
  // Gộp các bản ghi trùng mã (VD: hồ sơ nhân vật trong file + danh mục tra cứu cuối file)
  const byCode = new Map();
  for (const c of characters) {
    const key = c.code || `name:${c.name}`;
    if (!byCode.has(key)) {
      byCode.set(key, c);
      continue;
    }
    const prev = byCode.get(key);
    for (const k of ['aliases', 'appearance', 'personality', 'skills_abilities', 'inventory_default', 'speech_style', 'hard_constraints', 'portrait', 'misbelief', 'thirdRail', 'isMain']) {
      if (!prev[k] && c[k]) prev[k] = c[k];
    }
  }
  return {
    characters: [...byCode.values()],
    hardRules: [...new Set(hardRules)],
    softLore: [...new Set(softLore)],
    source: 'regex'
  };
}

async function extractCodexWithLLM(text) {
  const prompt = `Trích xuất thông tin từ tài liệu codex sau thành JSON hợp lệ (không giải thích thêm).
Cấu trúc bắt buộc:
{
  "characters": [
    {
      "name": "",
      "code": "",
      "aliases": "",
      "appearance": "",
      "personality": "",
      "skills_abilities": "",
      "inventory_default": "",
      "speech_style": "",
      "hard_constraints": ""
    }
  ],
  "hardRules": ["luật thế giới bất biến / thiết lập nền"],
  "softLore": ["hồ sơ địa phương, truyền khẩu, bối cảnh mở"]
}

Tài liệu:
${text.slice(0, 14000)}`;

  const raw = await window.RequestQueue.enqueue({
    lane: 'utility',
    systemPrompt: 'Bạn là bộ trích xuất dữ liệu JSON chính xác. Chỉ trả về JSON thuần.',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 3000,
    temperature: 0.2,
    stream: false
  });

  const cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  const parsed = JSON.parse(cleaned);

  return {
    characters: (parsed.characters || [])
      .filter((c) => c && c.name)
      .map((c) => ({ ...emptyChar(c.name), ...c })),
    hardRules: Array.isArray(parsed.hardRules) ? parsed.hardRules : [],
    softLore: Array.isArray(parsed.softLore) ? parsed.softLore : [],
    source: 'llm'
  };
}

async function autoSplitDocxCodex(text) {
  const regexResult = parseCodexText(text);
  // File chỉ có codex thế giới (không có nhân vật) vẫn dùng kết quả regex, khỏi gọi LLM
  if (regexResult.characters.length >= 1 || regexResult.hardRules.length >= 1 || regexResult.softLore.length >= 1) return regexResult;
  return extractCodexWithLLM(text);
}

window.CodexParser = {
  emptyChar,
  capitalizeName,
  isMainCharacter,
  parseSingleLineCharacter,
  parseCodexText,
  extractCodexWithLLM,
  autoSplitDocxCodex
};