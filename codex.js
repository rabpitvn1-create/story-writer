function emptyChar(name = '') {
  return {
    name: name.trim(),
    aliases: '',
    appearance: '',
    personality: '',
    skills_abilities: '',
    inventory_default: '',
    speech_style: '',
    hard_constraints: '',
    portrait: '',
    state: { level: '', injuries: '', inventory: '' }
  };
}

function matchFieldKey(line) {
  const clean = line.replace(/^[-*•]\s*/, '').trim();
  const idx = clean.indexOf(':');
  if (idx <= 0 || idx > 35) return null;
  const label = clean.slice(0, idx).toLowerCase().trim();
  const value = clean.slice(idx + 1).trim();

  if (/^(tên|name|nhân vật)$/.test(label)) return ['name', value];
  if (/^(biệt danh|tên khác|aliases|alias)$/.test(label)) return ['aliases', value];
  if (/^(ngoại hình|appearance|diện mạo)$/.test(label)) return ['appearance', value];
  if (/^(tính cách|personality)$/.test(label)) return ['personality', value];
  if (/^(kỹ năng|năng lực|skills|abilities|skills_abilities)$/.test(label)) return ['skills_abilities', value];
  if (/^(vật phẩm|túi đồ|trang bị|inventory|inventory_default)$/.test(label)) return ['inventory_default', value];
  if (/^(giọng điệu|cách nói|speech|speech_style)$/.test(label)) return ['speech_style', value];
  if (/^(ràng buộc|cấm kỵ|giới hạn|hard_constraints|constraints)$/.test(label)) return ['hard_constraints', value];
  return null;
}

function isHeadingLine(line) {
  if (/^#{1,3}\s+/.test(line)) return line.replace(/^#{1,3}\s+/, '').trim();
  if (/^(nhân vật|character)\s*[:\-]\s*/i.test(line)) return line.trim();
  // Dòng VIẾT HOA chỉ là tên nhân vật khi ngắn, không có dấu câu kết câu
  if (
    line.length >= 2 && line.length <= 45 && line === line.toUpperCase() &&
    /[A-ZÀ-Ỹ]/.test(line) && !/[.!?]$/.test(line) && line.trim().split(/\s+/).length <= 4
  ) {
    return line.trim();
  }
  return null;
}

// 1. Regex parser 0 API call
function parseCodexText(text) {
  const lines = String(text || '').split(/\r?\n/);
  const characters = [];
  const hardRules = [];
  const softLore = [];

  let mode = null; // 'char' | 'hard' | 'soft'
  let currentChar = null;

  const flushChar = () => {
    if (currentChar && currentChar.name) characters.push(currentChar);
    currentChar = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const heading = isHeadingLine(line);
    if (heading) {
      const lower = heading.toLowerCase();
      if (/(hard\s*rule|luật cứng|quy tắc cứng|bất biến)/.test(lower)) {
        flushChar();
        mode = 'hard';
        continue;
      }
      if (/(soft\s*lore|tin đồn|truyền thuyết|thế giới|world|lore|bối cảnh)/.test(lower)) {
        flushChar();
        mode = 'soft';
        continue;
      }
      if (/^(nhân vật|character)\s*[:\-]\s*(.+)$/i.test(heading)) {
        flushChar();
        mode = 'char';
        currentChar = emptyChar(heading.replace(/^(nhân vật|character)\s*[:\-]\s*/i, ''));
        continue;
      }
      // Heading viết hoa hoặc # Tên nhân vật (nếu không phải mục lục chung)
      if (!/^(codex|hồ sơ|mục lục|danh sách nhân vật)$/i.test(lower)) {
        flushChar();
        mode = 'char';
        currentChar = emptyChar(heading);
      } else {
        // Tiêu đề chung (Mục lục, Codex...) kết thúc mục nhân vật đang mở; nội dung sau không rò vào nhân vật
        flushChar();
        mode = null;
      }
      continue;
    }

    const field = matchFieldKey(line);
    if (field) {
      const [key, val] = field;
      if (key === 'name') {
        // Heading "NHÂN VẬT: Kael" rồi dòng "Tên: Kael" là cùng một nhân vật — không tách đôi
        if (currentChar && currentChar.name.toLowerCase() === val.toLowerCase()) {
          mode = 'char';
        } else {
          flushChar();
          mode = 'char';
          currentChar = emptyChar(val);
        }
      } else if (mode === 'char' && currentChar) {
        currentChar[key] = currentChar[key] ? `${currentChar[key]}; ${val}` : val;
      }
      continue;
    }

    if (mode === 'hard') {
      hardRules.push(line.replace(/^[-*•]\s*/, ''));
    } else if (mode === 'soft') {
      softLore.push(line.replace(/^[-*•]\s*/, ''));
    } else if (mode === 'char' && currentChar) {
      currentChar.personality = currentChar.personality
        ? `${currentChar.personality}\n${line}`
        : line;
    }
  }

  flushChar();
  return { characters, hardRules, softLore, source: 'regex' };
}

// 2. LLM extraction dự phòng (1 call lane 'utility')
async function extractCodexWithLLM(text) {
  const prompt = `Trích xuất thông tin từ tài liệu codex sau thành JSON hợp lệ (không giải thích thêm).
Cấu trúc bắt buộc:
{
  "characters": [
    {
      "name": "",
      "aliases": "",
      "appearance": "",
      "personality": "",
      "skills_abilities": "",
      "inventory_default": "",
      "speech_style": "",
      "hard_constraints": ""
    }
  ],
  "hardRules": ["luật thế giới bất biến"],
  "softLore": ["tin đồn, bối cảnh mở"]
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
  if (regexResult.characters.length >= 1) return regexResult;
  return extractCodexWithLLM(text);
}

window.CodexParser = {
  emptyChar,
  parseCodexText,
  extractCodexWithLLM,
  autoSplitDocxCodex
};
