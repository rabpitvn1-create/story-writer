const VOICE_HANDBOOK = `SỔ TAY GIỌNG VĂN (BẮT BUỘC):
- Ngôi kể: Ngôi thứ ba giới hạn qua góc nhìn Kai Akechi (gọi là "Kai" hoặc "cậu", tuyệt đối không đổi sang "tôi" hay "hắn" ngoài lời thoại).
- Nhịp câu: Câu ngắn, gãy gọn khi căng thẳng hoặc quan sát; câu vừa phải khi độc thoại nội tâm. Tránh câu ghép dài kiểu văn dịch.
- Tả thực (Show, Don't Tell): Không viết "Kai thấy sợ", hãy tả phản xạ cơ thể (mồ hôi lạnh, nhịp thở khựng lại, ngón tay siết chặt).
- Định dạng thoại: Khi nhân vật nói, viết đúng dạng mỗi câu một dòng: Tên: lời thoại (không dùng ngoặc kép bao quanh Tên).`;

const VOICE_ANCHORS = `MẪU GIỌNG VĂN NEO:
1. [Không gian] Tiếng đèn huỳnh quang rít đều trên trần, nhức nhối như một con côn trùng mắc kẹt sau lớp thạch cao. Thảm dưới chân Kai ẩm nước, không lạnh buốt mà âm ấm một cách khó chịu.
2. [Nội tâm] Kai không chạy. Chạy trong một hành lang không có điểm kết chỉ đốt sạch oxy và làm mờ khả năng phán đoán. Cậu đếm chậm bốn nhịp thở, mắt bám chặt vào vết nứt nhỏ trên chân tường.
3. [Thoại] Kai Akechi: Đừng nhìn lại phía sau.
Alxece: Nó vẫn đang đi theo nhịp chân của chúng ta.`;

const BANNED_SLOP = [
  'cảm giác ớn lạnh chạy dọc sống lưng',
  'không khí đặc quánh',
  'ánh mắt kiên định',
  'một cách kỳ lạ',
  'khẽ nhếch môi',
  'thời gian như ngừng trôi',
  'tim đập thình thịch như muốn nhảy ra khỏi lồng ngực',
  'không thể diễn tả thành lời',
  'một luồng khí lạnh',
  'bầu không khí trở nên nặng nề',
  'đôi mắt lóe lên tia sáng',
  'sự im lặng đến đáng sợ',
  'trong tích tắc',
  'như có một bàn tay vô hình',
  'cảm xúc dâng trào',
  'hít một hơi thật sâu'
];

const VI_STOPWORDS = new Set([
  'của', 'và', 'là', 'trong', 'một', 'những', 'các', 'cho', 'với', 'không',
  'được', 'này', 'đó', 'khi', 'để', 'từ', 'trên', 'dưới', 'về', 'như',
  'nhưng', 'hay', 'hoặc', 'thì', 'mà', 'đã', 'đang', 'sẽ', 'có', 'bị',
  'bởi', 'tại', 'vào', 'ra', 'lại', 'rất', 'quá', 'cũng', 'nên', 'vì',
  'nếu', 'sau', 'trước', 'chưa', 'chỉ', 'còn', 'đều', 'hơn', 'nhất',
  'người', 'cái', 'việc', 'điều', 'cách', 'chương', 'cảnh', 'xác', 'định',
  'đi', 'làm', 'biết', 'đến'
]);
function countWords(text) {
  const clean = String(text || '').trim();
  return clean ? clean.split(/\s+/).length : 0;
}

function extractKeywords(query) {
  const clean = String(query || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const words = clean
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !VI_STOPWORDS.has(w));
  return [...new Set(words)];
}

// Dùng chung cho cả L1-Dynamic và searchL4Chapters
function scoreByKeywords(text, queryOrKeywords) {
  const keywords = Array.isArray(queryOrKeywords)
    ? queryOrKeywords
    : extractKeywords(queryOrKeywords);
  if (!text || keywords.length === 0) return 0;

  const lower = String(text).toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) {
      // Từ dài >= 4 ký tự (tên riêng, địa danh, thuật ngữ) có trọng số cao hơn
      score += kw.length >= 4 ? 2 : 1;
    }
  }
  return score;
}

function chunkText(text, targetSize = 450) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const paras = raw.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let buf = '';

  for (const p of paras) {
    if (p.length > targetSize * 1.4) {
      if (buf) {
        chunks.push(buf);
        buf = '';
      }
      for (let i = 0; i < p.length; i += targetSize) {
        chunks.push(p.slice(i, i + targetSize));
      }
      continue;
    }
    if (buf && buf.length + p.length + 1 > targetSize) {
      chunks.push(buf);
      buf = p;
    } else {
      buf = buf ? `${buf}\n${p}` : p;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

function truncateText(text, maxChars) {
  const s = String(text || '').trim();
  if (s.length <= maxChars) return s;
  return `${s.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

// Tạo thẻ lõi nhân vật gọn (~500-600 ký tự), ưu tiên trường cấu trúc trước
function buildCharCoreCard(char, maxChars = 600) {
  const header = char.code ? `- ${char.name} [${char.code}]` : `- ${char.name}`;
  const priorityParts = [
    char.aliases ? `Danh hiệu: ${truncateText(char.aliases, 100)}` : '',
    char.hard_constraints ? `Ràng buộc: ${truncateText(char.hard_constraints, 160)}` : '',
    char.speech_style ? `Giọng điệu: ${truncateText(char.speech_style, 140)}` : ''
  ].filter(Boolean);

  let card = priorityParts.length ? `${header} | ${priorityParts.join(' | ')}` : header;
  const remaining = maxChars - card.length - 3;

  if (remaining > 60) {
    const bio = [char.appearance, char.personality || char.description]
      .filter(Boolean)
      .join(' — ')
      .replace(/\s+/g, ' ')
      .trim();
    if (bio) {
      card += ` | ${truncateText(bio, remaining)}`;
    }
  }
  return truncateText(card, maxChars);
}

// Truy xuất cục bộ L1-Dynamic trên hard_rule, soft_lore và hồ sơ dài (~27k ký tự)
async function retrieveDynamicCanon(query, { maxRules = 8, maxCharChunks = 2, maxLore = 2 } = {}) {
  const keywords = extractKeywords(query);
  if (keywords.length === 0) {
    return { rules: [], charChunks: [], lore: [] };
  }

  const [hardRules, softLore, chars] = await Promise.all([
    window.StoryDB.db.worldRules.where('type').equals('hard_rule').toArray(),
    window.StoryDB.db.worldRules.where('type').equals('soft_lore').toArray(),
    window.StoryDB.db.characters.toArray()
  ]);

  const rules = hardRules
    .map((r) => ({ text: r.content, score: scoreByKeywords(r.content, keywords) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxRules)
    .map((x) => truncateText(x.text, 320));

  const lore = softLore
    .map((r) => ({ text: r.content, score: scoreByKeywords(r.content, keywords) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxLore)
    .map((x) => truncateText(x.text, 320));

  const scoredChunks = [];
  for (const c of chars) {
    const fullBio = [c.personality, c.skills_abilities, c.inventory_default]
      .filter(Boolean)
      .join('\n');
    if (fullBio.length <= 500) continue;
    for (const chunk of chunkText(fullBio, 450)) {
      const score = scoreByKeywords(chunk, keywords);
      if (score > 0) {
        scoredChunks.push({ text: `[${c.name}] ${truncateText(chunk, 450)}`, score });
      }
    }
  }

  const charChunks = scoredChunks
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCharChunks)
    .map((x) => x.text);

  return { rules, charChunks, lore };
}

// JS Style Linter chạy cục bộ (0 API call)
function lintScene(text) {
  const warnings = [];
  const lower = text.toLowerCase();

  const foundSlop = BANNED_SLOP.filter((phrase) => lower.includes(phrase));
  if (foundSlop.length > 0) {
    warnings.push(`Tránh lặp các cụm sáo rỗng: "${foundSlop.join('", "')}".`);
  }

  // Kiểm tra nhảy ngôi kể (chữ "tôi" xuất hiện ngoài dòng thoại "Tên: ...")
  const nonDialogueLines = text
    .split('\n')
    .filter((l) => !/^[A-ZÀ-Ỹ][\wÀ-ỹ\s]{0,24}:\s+/.test(l.trim()))
    .join(' ');
  const strippedQuotes = nonDialogueLines.replace(/["“”][^"“”]*["“”]/g, '');
  if (/\b(tôi|mình)\b/i.test(strippedQuotes)) {
    warnings.push('Phát hiện đại từ ngôi thứ nhất ("tôi/mình") trong đoạn trần thuật; giữ chặt ngôi thứ ba ("Kai/cậu").');
  }

  // Kiểm tra độ dài câu trung bình
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  if (sentences.length > 0) {
    const avgWords = countWords(text) / sentences.length;
    if (avgWords > 30) {
      warnings.push(`Câu văn đang hơi dài (trung bình ${Math.round(avgWords)} từ/câu), hãy tách câu gọn và sắc hơn.`);
    }
  }

  return warnings;
}

// L1 Phân tầng: L1-Core (pinned facts + thẻ lõi tối đa 4 nhân vật) + L1-Dynamic (theo queryContext)
// Tương thích ngược: gọi getL1HardCanon() không tham số chỉ trả về L1-Core.
async function getL1HardCanon(queryContext = '', includeDynamic = true) {
  const [pinned, chars] = await Promise.all([
    window.StoryDB.getSetting('pinned_facts', []),
    window.StoryDB.db.characters.toArray()
  ]);

  // Ưu tiên nhân vật được nhắc tới trong queryContext, giới hạn tối đa 4 nhân vật cho L1-Core
  const qLower = String(queryContext || '').toLowerCase();
  const orderedChars = [...chars].sort((a, b) => {
    const aHit = qLower && a.name && qLower.includes(a.name.toLowerCase()) ? 1 : 0;
    const bHit = qLower && b.name && qLower.includes(b.name.toLowerCase()) ? 1 : 0;
    return bHit - aHit;
  });

  const coreCharText = orderedChars
    .slice(0, 4)
    .map((c) => buildCharCoreCard(c, 600))
    .join('\n');

  const sections = [];
  if (pinned.length) {
    sections.push(`SỰ THẬT ĐÃ GHIM (L1-CORE):\n${pinned.map((p) => `- ${p}`).join('\n')}`);
  }
  if (coreCharText) {
    sections.push(`NHÂN VẬT CỐT LÕI (L1-CORE):\n${coreCharText}`);
  }

  if (includeDynamic && queryContext && String(queryContext).trim()) {
    const dyn = await retrieveDynamicCanon(queryContext, {
      maxRules: 8,
      maxCharChunks: 2,
      maxLore: 2
    });
    if (dyn.rules.length) {
      sections.push(`LUẬT THẾ GIỚI LIÊN QUAN (L1-DYNAMIC):\n${dyn.rules.map((r) => `- ${r}`).join('\n')}`);
    }
    if (dyn.charChunks.length) {
      sections.push(`HỒ SƠ SÂU NHÂN VẬT LIÊN QUAN:\n${dyn.charChunks.map((c) => `- ${c}`).join('\n')}`);
    }
    if (dyn.lore.length) {
      sections.push(`LORE ĐỊA PHƯƠNG LIÊN QUAN:\n${dyn.lore.map((l) => `- ${l}`).join('\n')}`);
    }
  }

  if (sections.length === 0) {
    return 'LUẬT THẾ GIỚI BẤT BIẾN (L1):\n- Tuân thủ logic sinh tồn thực tế.';
  }
  return sections.join('\n\n');
}

// L2: State Ledger (bảng ledger)
async function getL2Ledger() {
  const row = await window.StoryDB.db.ledger.get('current');
  return (
    row?.value || {
      location: 'Chưa xác định',
      deadCharacters: [],
      lostItems: [],
      openHooks: [],
      relationships: {},
      characterStates: {}
    }
  );
}

async function saveL2Ledger(nextLedger) {
  await window.StoryDB.db.ledger.put({ key: 'current', value: nextLedger, updatedAt: Date.now() });
  const states = nextLedger.characterStates || {};
  for (const [name, st] of Object.entries(states)) {
    const existing = await window.StoryDB.db.characters.get(name);
    if (existing) {
      existing.state = {
        level: st.level ?? existing.state?.level ?? '',
        injuries: st.injuries ?? existing.state?.injuries ?? '',
        inventory: st.inventory ?? existing.state?.inventory ?? ''
      };
      await window.StoryDB.db.characters.put(existing);
    }
  }
}

// L3: Tóm tắt phân tầng (3-5 chương gần nhất + Arc summary mỗi 5 chương)
async function getL3Summaries() {
  const all = await window.StoryDB.db.summaries.orderBy('chapterNumber').toArray();
  const arcs = all.filter((s) => s.isArc);
  const recent = all.filter((s) => !s.isArc).slice(-4);
  return {
    arcsText: arcs.map((a) => `[Arc ${a.arcRange}]: ${a.summary}`).join('\n'),
    recentText: recent.map((r) => `Chương ${r.chapterNumber}: ${r.summary}`).join('\n')
  };
}

// L4: Tìm kiếm từ khóa trên toàn văn chương cũ dùng chung scoreByKeywords
async function searchL4Chapters(query, limit = 2) {
  const keywords = extractKeywords(query);
  if (keywords.length === 0) return [];

  const chapters = await window.StoryDB.db.chapters.toArray();
  const hits = [];

  for (const ch of chapters) {
    if (!ch.text) continue;
    const paras = ch.text.split(/\n{2,}/);
    for (const p of paras) {
      const score = scoreByKeywords(p, keywords);
      if (score > 0) {
        hits.push({ chapterNumber: ch.number, score, snippet: truncateText(p, 450) });
      }
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

window.StoryMemory = {
  VOICE_HANDBOOK,
  VOICE_ANCHORS,
  countWords,
  scoreByKeywords,
  buildCharCoreCard,
  retrieveDynamicCanon,
  lintScene,
  getL1HardCanon,
  getL2Ledger,
  saveL2Ledger,
  getL3Summaries,
  searchL4Chapters
};
