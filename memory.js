function buildVoiceHandbook(mainChar = null) {
  const name = mainChar?.name ? mainChar.name : 'nhân vật chính';
  const povPronoun = mainChar?.narratorPronoun ? String(mainChar.narratorPronoun).trim() : '';
  const povLine = povPronoun
    ? `- Ngôi kể: Ngôi thứ ba giới hạn qua góc nhìn ${name}: trong trần thuật CHỈ gọi ${name} bằng tên hoặc đại từ "${povPronoun}", tuyệt đối không đổi sang "tôi/mình" hay nhảy đại từ ngôi ba khác ngoài lời thoại.`
    : `- Ngôi kể: Ngôi thứ ba giới hạn qua góc nhìn ${name}: dùng đúng đại từ ngôi ba mà hồ sơ dùng cho ${name} (nếu không rõ thì chọn một đại từ nhất quán), tuyệt đối không đổi sang "tôi/mình" hay nhảy đại từ ngoài lời thoại.`;
  const speechLine = mainChar?.speech_style
    ? `- Khẩu khí ${name}: ${mainChar.speech_style}`
    : '- Giọng thoại phân biệt rõ từng nhân vật theo cá tính riêng.';
  const misbeliefLine = mainChar?.misbelief
    ? `- Điểm mù nội tâm (${name}): ${mainChar.misbelief}`
    : '';

  return [
    'SỔ TAY GIỌNG VĂN (BẮT BUỘC):',
    povLine,
    '- Nhịp câu: Câu ngắn, gãy gọn khi căng thẳng hoặc quan sát; câu vừa phải khi độc thoại nội tâm. Tránh câu ghép dài kiểu văn dịch.',
    '- Tả thực (Show, Don\'t Tell): Không gọi tên cảm xúc trực tiếp, hãy tả phản xạ cơ thể và chi tiết vật lý.',
    speechLine,
    misbeliefLine,
    '- Nhân vật có sẵn Ngoại hình/Trang bị trong hồ sơ thì BẮT BUỘC dùng đúng tên đồ đó, cấm tự bịa vũ khí/trang phục mới; chỗ nào hồ sơ để trống mới được tự bịa.',
    '- NPC quần chúng cấm trùng tên nhân vật có sẵn, không chiếm tâm điểm.',
    '- Xưng hô đúng quan hệ/vai vế (anh/em/chú/cô/bác/ông/bà/cậu/tôi); cấm mặc định tôi-bạn/cậu-mình.',
    '- Dùng tiếng Việt chuẩn, rõ nghĩa; không tự ghép từ lạ, không chèn chữ Hán hay tiếng Anh vào văn xuôi.',
    '- Định dạng thoại: Khi nhân vật nói, viết đúng dạng mỗi câu một dòng: Tên: lời thoại (không dùng ngoặc kép bao quanh Tên).'
  ]
    .filter(Boolean)
    .join('\n');
}

function buildVoiceAnchors(mainChar = null) {
  const name = mainChar?.name ? mainChar.name : 'Cậu';
  return `MẪU GIỌNG VĂN NEO:
1. [Không gian] Mưa gõ nhẹ lên mái tôn, mùi đất ẩm len qua khe cửa. ${name} đứng yên một lúc, nghe tiếng mưa rồi mới bước tiếp.
2. [Nội tâm] ${name} không vội vàng. Vội vàng chỉ đốt sạch hơi thở và làm mờ phán đoán. Nhịp tim dội chậm bên thái dương, mắt bám chặt vào vệt nước loang trên nền gạch.`;
}

const VOICE_HANDBOOK = buildVoiceHandbook(null);
const VOICE_ANCHORS = buildVoiceAnchors(null);

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
  const invText = window.CodexParser
    ? window.CodexParser.extractInventorySummary(char.inventory_default, 220)
    : truncateText(char.inventory_default, 220);
  const roleTag = char.role ? `(${char.role})` : '';
  const header = char.code ? `- ${char.name} [${char.code}] ${roleTag}`.trim() : `- ${char.name} ${roleTag}`.trim();
  const priorityParts = [
    char.aliases ? `Danh hiệu: ${truncateText(char.aliases, 80)}` : '',
    char.appearance ? `Ngoại hình: ${truncateText(char.appearance, 140)}` : '',
    invText ? `Trang bị gốc: ${invText}` : '',
    char.hard_constraints ? `Ràng buộc: ${truncateText(char.hard_constraints, 120)}` : '',
    char.speech_style ? `Giọng điệu: ${truncateText(char.speech_style, 110)}` : '',
    char.misbelief ? `Điểm mù: ${truncateText(char.misbelief, 90)}` : '',
    char.thirdRail ? `Vết thương/cấm kỵ: ${truncateText(char.thirdRail, 100)}` : ''
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

// FIX-B3: bảng characters chỉ index theo 'name' nên không dùng where('role') (ném lỗi Dexie);
// quét toàn bảng rồi lọc — NPC tối đa ~15 bản ghi nên không tốn kém.
async function lookupRecurringNpcs(sceneQuery) {
  if (!sceneQuery || !String(sceneQuery).trim()) return '';
  const q = String(sceneQuery);
  const all = await window.StoryDB.db.characters.toArray();
  const matched = all
    .filter((n) => {
      if (n.role !== 'npc' || (n.appearances || 0) < 3 || !n.name) return false;
      // Khớp tên riêng đúng ranh giới từ, phân biệt hoa/thường (như countNameInText):
      // 'Lan' không khớp 'hoa lan'/'lan ra', 'Minh' không khớp 'minh chứng'.
      const escaped = String(n.name).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'u').test(q);
    })
    .slice(0, 2);
  if (matched.length === 0) return '';
  return `QUẦN CHÚNG QUEN MẶT:\n${matched.map((n) => `- ${n.name}: ${n.note || n.personality || ''}`).join('\n')}`;
}

const HONORIFIC_PREFIX_RE = /^(?:cô|chú|bác|anh|chị|ông|bà|tiểu|lão)\s+/iu;

function stripHonorificPrefix(raw) {
  return String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(HONORIFIC_PREFIX_RE, '').trim();
}

function resolveKnownCharName(raw, allowedNames = []) {
  const clean = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!clean) return null;
  for (const name of allowedNames) {
    if (String(name || '').trim().toLowerCase() === clean) return name;
  }
  const stripped = stripHonorificPrefix(clean);
  if (!stripped) return null;
  for (const name of allowedNames) {
    const canonLower = String(name || '').trim().toLowerCase();
    if (canonLower === stripped || stripHonorificPrefix(canonLower) === stripped) return name;
  }
  return null;
}

function makePairKey(nameA, nameB) {
  const pair = [nameA, nameB];
  const swapped = pair[0].localeCompare(pair[1], 'vi') > 0;
  const a = swapped ? nameB : nameA;
  const b = swapped ? nameA : nameB;
  return { key: `${a}|${b}`, a, b, swapped };
}

function nameAppearsInText(text, name) {
  if (!text || !name) return false;
  const escaped = String(name).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'u').test(String(text));
}

function getActiveSceneRelationships(relationships, sceneQuery) {
  if (!relationships || !sceneQuery || !String(sceneQuery).trim()) return [];
  const q = String(sceneQuery);
  return Object.values(relationships).filter((rel) => {
    if (!rel || !rel.a || !rel.b) return false;
    if (!rel.aToB && !rel.bToA) return false;
    return nameAppearsInText(q, rel.a) && nameAppearsInText(q, rel.b);
  });
}

function formatSceneRelationships(relationships, sceneQuery) {
  const matched = getActiveSceneRelationships(relationships, sceneQuery);
  if (matched.length === 0) return '';
  const parts = matched.map((r) => {
    const dirs = [];
    if (r.aToB) dirs.push(`${r.a}→${r.b} "${r.aToB}"`);
    if (r.bToA) dirs.push(`${r.b}→${r.a} "${r.bToA}"`);
    return `${dirs.join(', ')} (từ ch.${r.sinceChapter || 1})`;
  });
  return `Xưng hô đã nhớ: ${parts.join('; ')} — giữ nguyên trừ khi quan hệ đổi.`;
}

// memory.js — Bộ lọc Chống Đầu Độc 3 lớp (0 token, 0 call, chạy trước khi upsert l2.relationships)
const INVALID_ADDRESS_VALUES = new Set(['không rõ', 'chưa rõ', 'chưa có', 'không có', 'none', 'null', 'n/a', 'undefined']);
const POISON_DEFAULT_RE = /^(?:tôi\s*[-–/]\s*bạn|bạn\s*[-–/]\s*tôi|cậu\s*[-–/]\s*mình|mình\s*[-–/]\s*cậu|bạn)$/iu;
const HOSTILE_OR_ROMANTIC_REASON_RE =
  /(?:trở thành|là)\s*(?:người yêu|tình nhân|kẻ thù|đối thủ)|tỏ tình|yêu nhau|trở mặt|thù địch|cắt đứt/iu;

// Lớp 1 — Kiểm tra hình dạng (shape): ngắn gọn 1–18 ký tự, <=4 từ, có chữ cái tiếng Việt, không rác/dấu câu
function isValidAddressingShape(val) {
  const clean = String(val || '').trim().replace(/\s+/g, ' ');
  if (!clean || clean.length > 18) return false;
  if (INVALID_ADDRESS_VALUES.has(clean.toLowerCase())) return false;
  if (/[.!?;,\n\r{}[\]()"“”<>]/.test(clean)) return false;
  if (!/\p{L}/u.test(clean)) return false;
  if (clean.split(/\s+/).length > 4) return false;
  return true;
}

// Lớp 2 — Quorum >=2 lần trong các dòng thoại "Tên: ..." của ĐÚNG người nói (from)
function countAddressingInDialogue(fullText, speakerName, addressForm) {
  if (!fullText || !speakerName || !addressForm) return 0;
  const targetSpeaker = stripHonorificPrefix(speakerName);
  const speakerLines = [];
  const dialogueRe = /^([A-ZÀ-Ỹ][\wÀ-ỹ\s]{0,24}):\s+(.+)$/;

  for (const rawLine of String(fullText).split('\n')) {
    const m = rawLine.trim().match(dialogueRe);
    if (!m) continue;
    const lineSpeaker = stripHonorificPrefix(m[1]);
    if (lineSpeaker === targetSpeaker || m[1].trim().toLowerCase() === speakerName.trim().toLowerCase()) {
      speakerLines.push(m[2].trim());
    }
  }
  if (speakerLines.length === 0) return 0;

  // Nếu dạng gọi ghép 2 vế kiểu "anh-em" / "tôi-bạn": tách thành 2 vế, tính số lần vế xưng/hô cùng xuất hiện hoặc lặp >=2
  const parts = String(addressForm)
    .split(/\s*[-–/]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  const countTerm = (term) => {
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])`, 'giu');
    return speakerLines.reduce((sum, line) => sum + (line.match(re) || []).length, 0);
  };

  if (parts.length === 2) {
    // Yêu cầu cả hai vế đều có mặt trong thoại của speaker VÀ vế gọi đối phương (hoặc tổng cả cặp) đạt quorum >= 2
    const c1 = countTerm(parts[0]);
    const c2 = countTerm(parts[1]);
    if (c1 === 0 || c2 === 0) return 0;
    return Math.min(c1, c2);
  }
  return countTerm(String(addressForm).trim());
}

// Lớp 3 — Chặn hẹp "tôi-bạn"/"cậu-mình" CHỈ khi có role === 'antagonist' hoặc reason trực tiếp là yêu/thù
function isPoisonedDefaultAddressing(addressForm, charA, charB, reason = '') {
  const clean = String(addressForm || '').trim();
  if (!POISON_DEFAULT_RE.test(clean)) return false;
  const hasAntagonist = charA?.role === 'antagonist' || charB?.role === 'antagonist';
  const hasDirectReason = HOSTILE_OR_ROMANTIC_REASON_RE.test(String(reason || ''));
  return hasAntagonist || hasDirectReason;
}

function mergeAddressingChanges(
  existingRelationships,
  changes,
  allowedNames = [],
  chapterNumber = 1,
  deletedNames = [],
  options = {}
) {
  const deletedSet = new Set((deletedNames || []).map((n) => String(n || '').trim().toLowerCase()));
  const next = {};

  // Giữ cặp cũ, loại mọi cặp chứa tên vừa bị prune
  for (const [k, v] of Object.entries(existingRelationships || {})) {
    if (!v || !v.a || !v.b) continue;
    if (deletedSet.has(v.a.toLowerCase()) || deletedSet.has(v.b.toLowerCase())) continue;
    next[k] = { ...v };
  }

  const fullText = typeof options?.fullText === 'string' ? options.fullText : null;
  const minQuorum = Number.isInteger(options?.minQuorum) ? options.minQuorum : 2;
  const charsByName = options?.charsByName && typeof options.charsByName.get === 'function' ? options.charsByName : new Map();

  for (const ch of Array.isArray(changes) ? changes : []) {
    if (!ch || !ch.a || !ch.b) continue;
    const canonA = resolveKnownCharName(ch.a, allowedNames);
    const canonB = resolveKnownCharName(ch.b, allowedNames);
    if (!canonA || !canonB || canonA === canonB) continue;
    if (deletedSet.has(canonA.toLowerCase()) || deletedSet.has(canonB.toLowerCase())) continue;

    const charA = charsByName.get(canonA.toLowerCase()) || null;
    const charB = charsByName.get(canonB.toLowerCase()) || null;
    const reason = String(ch.reason || '');

    const filterDirection = (rawVal, speakerName) => {
      const val = String(rawVal || '').trim().replace(/\s+/g, ' ');
      if (!val) return '';
      // Lớp 1: shape
      if (!isValidAddressingShape(val)) return '';
      // Lớp 3: chặn hẹp mặc định dịch máy cho antagonist / reason yêu-thù
      if (isPoisonedDefaultAddressing(val, charA, charB, reason)) return '';
      // Lớp 2: quorum >= 2 lần trong dòng thoại của đúng speaker (chỉ chạy khi có fullText)
      if (fullText !== null && countAddressingInDialogue(fullText, speakerName, val) < minQuorum) {
        return '';
      }
      return val;
    };

    const valAB = filterDirection(ch.aToB, canonA);
    const valBA = filterDirection(ch.bToA, canonB);
    if (!valAB && !valBA) continue;

    const { key, a, b, swapped } = makePairKey(canonA, canonB);
    const inAtoB = swapped ? valBA : valAB;
    const inBtoA = swapped ? valAB : valBA;
    const prev = next[key];

    const changedExisting =
      Boolean(prev) &&
      ((inAtoB && prev.aToB && inAtoB.toLowerCase() !== prev.aToB.toLowerCase()) ||
        (inBtoA && prev.bToA && inBtoA.toLowerCase() !== prev.bToA.toLowerCase()));

    next[key] = {
      a,
      b,
      aToB: inAtoB || prev?.aToB || '',
      bToA: inBtoA || prev?.bToA || '',
      sinceChapter: changedExisting ? chapterNumber : prev?.sinceChapter || chapterNumber
    };
  }

  return next;
}

// Bộ đếm lỗi từ vựng tầng 1 (0 call, 0 token)
const LEXICAL_CJK_RE = /[\u4E00-\u9FFF]/gu;
const LEXICAL_DUP_RE = /(?<![\p{L}\p{N}_])(\p{L}[\p{L}\p{M}]*)\s+\1(?![\p{L}\p{N}_])/giu;
const LEXICAL_DUP_WHITELIST = new Set([
  'từ',
  'khẽ',
  'nhè',
  'đều',
  'rè',
  'xè',
  'cộp',
  'tõm',
  'đêm',
  'ngày',
  'đi',
  'nhanh',
  'chậm',
  // FIX-L2: từ láy màu hợp lệ ("đỏ đỏ", "xanh xanh" là sắc thái, không phải lỗi gõ)
  'đỏ',
  'xanh',
  'vàng',
  'trắng',
  'đen',
  'hồng',
  'tím',
  'nâu',
  // FIX-L3 (tự phát hiện khi probe, ngoài lệnh gốc): từ láy giảm nhẹ hợp lệ ("xa xa", "nhẹ nhẹ", "nhỏ nhỏ") — auto-fix mà gộp sẽ làm sai nghĩa văn đúng
  'xa',
  'gần',
  'nhẹ',
  'nhỏ',
  'vui',
  'buồn',
  'to',
  'cao',
  'dài',
  'ngắn',
  'thấp',
  'lặng',
  'im'
]);
// FIX-L1: đã xóa "say" ("say rượu") và "day" ("day dứt") — là âm tiết tiếng Việt, không phải từ Anh
const LEXICAL_EN_FUNC_RE =
  /(?<![\p{L}\p{N}_])(?:under|with|from|into|between|through|the|and|for|about|over|after|before|during|without|within|against|among|across|behind|beyond|upon|along|around|because|while|which|that|this|these|those|what|when|where|why|how|but|not|are|was|were|been|have|has|had|will|would|could|should|might|must|shall|at|on|or|up|out|off|all|any|one|two|first|last|new|old|big|get|got|let|see|way)(?![\p{L}\p{N}_])/gu;

function extractLexicalContext(str, index, matchLen) {
  const half = Math.max(0, Math.floor((40 - matchLen) / 2));
  const start = Math.max(0, index - half);
  const end = Math.min(str.length, start + 40);
  return str.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 40);
}

function countLexicalIssues(text) {
  const str = String(text || '');
  let cjk = 0;
  let enFunc = 0;
  let dup = 0;
  const details = [];
  // Cắt ví dụ theo từng loại (4/3/3) để ví dụ không rỗng khi lỗi dồn một loại
  const caps = { cjk: 4, enFunc: 3, dup: 3 };
  const counts = { cjk: 0, enFunc: 0, dup: 0 };
  const pushDetail = (type, word, index, matchLen) => {
    if (counts[type] >= caps[type]) return;
    counts[type]++;
    details.push({
      type,
      word,
      index,
      context: extractLexicalContext(str, index, matchLen)
    });
  };

  for (const m of str.matchAll(LEXICAL_CJK_RE)) {
    cjk++;
    pushDetail('cjk', m[0], m.index, m[0].length);
  }

  for (const m of str.matchAll(LEXICAL_EN_FUNC_RE)) {
    enFunc++;
    pushDetail('enFunc', m[0], m.index, m[0].length);
  }

  for (const m of str.matchAll(LEXICAL_DUP_RE)) {
    const baseWord = m[1].toLowerCase();
    if (LEXICAL_DUP_WHITELIST.has(baseWord)) continue;
    dup++;
    pushDetail('dup', m[0], m.index, m[0].length);
  }

  return { cjk, enFunc, dup, details };
}

// JS Style Linter chạy cục bộ (0 API call)
function lintScene(text, options = {}) {
  const warnings = [];
  const lower = text.toLowerCase();

  const foundSlop = BANNED_SLOP.filter((phrase) => lower.includes(phrase));
  if (foundSlop.length > 0) {
    warnings.push(`Tránh lặp các cụm sáo rỗng: "${foundSlop.join('", "')}".`);
  }

  const lines = text.split('\n');
  const dialogueRe = /^([A-ZÀ-Ỹ][\wÀ-ỹ\s]{0,24}):\s+(.+)$/;
  const dialogueEntries = [];
  const nonDialogueParts = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    const m = trimmed.match(dialogueRe);
    if (m) {
      dialogueEntries.push({ speaker: m[1].trim(), speech: m[2].trim() });
    } else if (trimmed) {
      nonDialogueParts.push(trimmed);
    }
  }

  const strippedQuotes = nonDialogueParts.join(' ').replace(/["“][^"”]*["”]/g, '');
  if (/(?<![\p{L}\p{N}_])(tôi|mình)(?![\p{L}\p{N}_])/iu.test(strippedQuotes)) {
    warnings.push('Phát hiện đại từ ngôi thứ nhất ("tôi/mình") trong đoạn trần thuật; giữ chặt ngôi thứ ba.');
  }

  // Kiểm tra trôi đại từ POV (VD: đã khóa "hắn" nhưng trượt sang "anh ấy/anh ta")
  const povPronoun = options?.mainChar?.narratorPronoun ? String(options.mainChar.narratorPronoun).trim().toLowerCase() : '';
  if (povPronoun === 'hắn') {
    const hanCount = (strippedQuotes.match(/(?<![\p{L}\p{N}_])hắn(?![\p{L}\p{N}_])/giu) || []).length;
    const driftCount = (strippedQuotes.match(/(?<![\p{L}\p{N}_])(anh ấy|anh ta)(?![\p{L}\p{N}_])/giu) || []).length;
    if (driftCount >= 2 && driftCount >= hanCount) {
      warnings.push('Trần thuật đang trượt sang "anh ấy/anh ta"; giữ chặt đại từ đã nhớ "hắn" cho nhân vật chính.');
    }
  }

  // Kiểm tra vi phạm cặp xưng hô đã nhớ trên dòng thoại "Tên: lời thoại"
  const activeRels = Array.isArray(options?.sceneRelationships)
    ? options.sceneRelationships
    : getActiveSceneRelationships(options?.relationships, options?.sceneQuery);

  if (activeRels.length > 0 && dialogueEntries.length > 0) {
    const distinctSpeakers = new Set(dialogueEntries.map((d) => d.speaker.toLowerCase()));
    const conflictNeutralRe = /(?<![\p{L}\p{N}_])(bạn|cậu|mình)(?![\p{L}\p{N}_])/iu;

    for (const rel of activeRels) {
      const checks = [
        { from: rel.a, to: rel.b, expected: rel.aToB },
        { from: rel.b, to: rel.a, expected: rel.bToA }
      ];
      for (const { from, to, expected } of checks) {
        if (!expected) continue;
        const fromLines = dialogueEntries.filter((d) => d.speaker.toLowerCase() === from.toLowerCase());
        if (fromLines.length === 0) continue;

        const directedLines =
          distinctSpeakers.size <= 2
            ? fromLines
            : fromLines.filter((d) => nameAppearsInText(d.speech, to));
        if (directedLines.length === 0) continue;

        const expectedEscaped = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const expectedRe = new RegExp(`(?<![\\p{L}\\p{N}_])${expectedEscaped}(?![\\p{L}\\p{N}_])`, 'iu');
        const usedExpected = directedLines.some((d) => expectedRe.test(d.speech));
        const expectedAllowsNeutral = conflictNeutralRe.test(expected);
        const leakedNeutral = !expectedAllowsNeutral && directedLines.some((d) => conflictNeutralRe.test(d.speech));

        if (!usedExpected && leakedNeutral) {
          warnings.push(`Xưng hô ${from}→${to} đang lệch khỏi dạng đã nhớ ("${expected}"); giữ đúng ở cảnh tiếp theo trừ khi quan hệ vừa đổi.`);
        }
      }
    }
  }

  // Kiểm tra độ dài câu trung bình
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  if (sentences.length > 0) {
    const avgWords = countWords(text) / sentences.length;
    if (avgWords > 30) {
      warnings.push(`Câu văn đang hơi dài (trung bình ${Math.round(avgWords)} từ/câu), hãy tách câu gọn và sắc hơn.`);
    }
  }

  // Kiểm tra lỗi từ vựng tầng 1 (CJK, từ chức năng tiếng Anh)
  const lex = countLexicalIssues(text);
  if (lex.cjk > 0) {
    const sample = lex.details
      .filter((d) => d.type === 'cjk')
      .slice(0, 3)
      .map((d) => `"${d.word}" trong "${d.context}"`)
      .join('; ');
    warnings.push(`Phát hiện ký tự Hán trong văn xuôi (VD: ${sample}); viết lại bằng chữ Việt.`);
  }
  if (lex.enFunc > 0) {
    const sample = lex.details
      .filter((d) => d.type === 'enFunc')
      .slice(0, 3)
      .map((d) => `"${d.word}" trong "${d.context}"`)
      .join('; ');
    warnings.push(`Phát hiện từ tiếng Anh lọt vào văn xuôi (VD: ${sample}); viết lại bằng chữ Việt.`);
  }
  // Không cảnh báo lặp âm tiết: bộ đếm dup dương tính giả cao trên văn thật (từ láy hợp lệ, trùng âm tiết qua ranh giới từ) — chỉ dùng để đo.

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
  // Lọc bỏ role === 'npc' khỏi L1-Core, dùng isMainCharacter đồng bộ thay cho isMain === true
  const coreCandidates = chars.filter((c) => c.role !== 'npc');
  const orderedChars = [...coreCandidates].sort((a, b) => {
    const aMain = window.CodexParser?.isMainCharacter(a) ? 5 : (a.role === 'ally' || a.role === 'antagonist' ? 2 : 0);
    const bMain = window.CodexParser?.isMainCharacter(b) ? 5 : (b.role === 'ally' || b.role === 'antagonist' ? 2 : 0);
    const aHit = qLower && a.name && qLower.includes(a.name.toLowerCase()) ? 3 : 0;
    const bHit = qLower && b.name && qLower.includes(b.name.toLowerCase()) ? 3 : 0;
    return (bMain + bHit) - (aMain + aHit);
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

// D-01: "" / null / undefined = KHÔNG ĐỔI; "[XÓA]" = XÓA THẬT (về "")
const CLEAR_SENTINEL = '[XÓA]';

function mergeFieldValue(oldVal, newVal) {
  if (newVal === undefined || newVal === null) return oldVal ?? '';
  const trimmed = String(newVal).trim();
  if (trimmed === '') return oldVal ?? '';
  if (trimmed === CLEAR_SENTINEL) return '';
  return trimmed;
}

function mergeCharacterState(oldState = {}, patchState = {}) {
  const prev = oldState || {};
  const next = patchState || {};
  return {
    level: mergeFieldValue(prev.level, next.level),
    injuries: mergeFieldValue(prev.injuries, next.injuries),
    inventory: mergeFieldValue(prev.inventory, next.inventory),
    pickedUpItems: mergeFieldValue(prev.pickedUpItems, next.pickedUpItems)
  };
}

async function saveL2Ledger(nextLedger) {
  await window.StoryDB.db.ledger.put({ key: 'current', value: nextLedger, updatedAt: Date.now() });
  const states = nextLedger.characterStates || {};
  for (const [name, st] of Object.entries(states)) {
    const existing = await window.StoryDB.db.characters.get(name);
    if (existing) {
      // D-01 (lớp 2): ledger đã merge xong ở lớp 1 nên chỉ đồng bộ nguyên trạng — "" là đã xóa/không có, KHÔNG merge lại (merge lại sẽ hồi sinh field vừa "[XÓA]")
      existing.state = {
        level: st.level ?? '',
        injuries: st.injuries ?? '',
        inventory: st.inventory ?? '',
        pickedUpItems: st.pickedUpItems ?? ''
      };
      await window.StoryDB.db.characters.put(existing);
    }
  }
}

// [K13] hướng (a): chỉ đổ vào prompt trạng thái của nhân vật có hồ sơ thật (role !== 'npc'),
// chỉ giữ pickedUpItems mới — không đổ trường inventory cũ (chặn đồ bịa hợp thức hóa qua l2 JSON).
async function serializeL2ForPrompt(l2) {
  const chars = await window.StoryDB.db.characters.toArray();
  const allowed = new Set(chars.filter((c) => c.role !== 'npc').map((c) => c.name));
  const cleanStates = {};
  for (const [name, st] of Object.entries(l2?.characterStates || {})) {
    if (!allowed.has(name) || !st) continue;
    cleanStates[name] = {
      level: st.level || '',
      injuries: st.injuries || '',
      pickedUpItems: st.pickedUpItems || ''
    };
  }
  const { relationships: _omitRelationships, ...restL2 } = l2 || {};
  return JSON.stringify({ ...restL2, characterStates: cleanStates });
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

function hasValidEvidence(fullText, evidenceMap, key) {
  if (!evidenceMap || typeof evidenceMap !== 'object') return false;
  const quote = String(evidenceMap[key] || '').trim();
  if (quote.length < 8 || quote.length > 140) return false;
  const normText = fullText.replace(/\s+/g, ' ').toLowerCase();
  const normQuote = quote.replace(/\s+/g, ' ').toLowerCase();
  return normText.includes(normQuote);
}

async function harvestFromDigest(newChars = [], newRules = [], fullText = null, chapterNumber = null, evidence = null) {
  const isFromDigest = typeof fullText === 'string' && fullText.length > 0;
  let addedChars = 0;
  let addedRules = 0;

  const existing = await window.StoryDB.db.characters.toArray();
  const conflicts = window.CodexParser ? window.CodexParser.buildNameConflictSet(existing) : { fullNames: new Set(), uniqueShort: new Set() };
  const byLowerName = new Map(existing.map((c) => [String(c.name || '').toLowerCase(), c]));

  if (Array.isArray(newChars) && newChars.length > 0) {
    for (const nc of newChars) {
      if (!nc || !nc.name) continue;
      const cleanName = window.CodexParser ? window.CodexParser.capitalizeName(nc.name) : nc.name.trim();
      const lower = cleanName.toLowerCase();
      if (!cleanName) continue;

      if (isFromDigest) {
        // Nhánh Digest: kiểm tra evidence, danh xưng chung, tăng appearances nếu là NPC cũ
        const existingRec = byLowerName.get(lower);
        if (existingRec) {
          if (existingRec.role === 'npc') {
            existingRec.appearances = (existingRec.appearances || 1) + 1;
            existingRec.lastSeenChapter = chapterNumber || existingRec.lastSeenChapter;
            await window.StoryDB.db.characters.put(existingRec);
          }
          continue;
        }
        if (window.CodexParser?.isGenericNpcTitle(cleanName)) continue;
        if (conflicts.fullNames.has(lower) || conflicts.uniqueShort.has(lower)) continue;
        // Không có evidence khớp trong fullText thì bỏ mục (fail-closed, không đoán).
        if (!hasValidEvidence(fullText, evidence, nc.name) && !hasValidEvidence(fullText, evidence, cleanName)) continue;
        const occ = window.CodexParser ? window.CodexParser.countNameInText(fullText, cleanName) : 2;
        if (occ < 2) continue;

        const npc = window.CodexParser.emptyNpc(cleanName, nc.personality || nc.appearance || '', chapterNumber || 1);
        await window.StoryDB.db.characters.put(npc);
        conflicts.fullNames.add(lower);
        addedChars++;
      } else {
        // Nhánh Seed Mode (chapter.js:330, fullText == null): bỏ lọc >=2 lần & evidence, giữ vai khởi tạo
        if (conflicts.fullNames.has(lower)) continue;
        const base = window.CodexParser ? window.CodexParser.emptyChar(cleanName) : { name: cleanName };
        const record = {
          ...base,
          name: cleanName,
          role: nc.role || (nc.isMain === true ? 'protagonist' : 'supporting'),
          isMain: nc.role === 'protagonist' || nc.isMain === true,
          appearance: [nc.gender, nc.age ? `${nc.age} tuổi` : '', nc.appearance].filter(Boolean).join(', '),
          personality: nc.personality || '',
          description: nc.personality || nc.appearance || '',
          speech_style: nc.speech_style || '',
          misbelief: nc.misbelief || '',
          thirdRail: nc.thirdRail || '',
          source: 'seed',
          updatedAt: Date.now()
        };
        await window.StoryDB.db.characters.put(record);
        conflicts.fullNames.add(lower);
        addedChars++;
      }
    }
  }

  if (Array.isArray(newRules) && newRules.length > 0) {
    const existingRules = await window.StoryDB.db.worldRules.where('type').anyOf('hard_rule', 'soft_lore').toArray();
    const knownRules = new Set(existingRules.map((r) => String(r.content || '').toLowerCase().trim()));
    for (const rule of newRules) {
      const clean = String(rule || '').trim();
      if (clean.length < 8 || knownRules.has(clean.toLowerCase())) continue;
      if (isFromDigest && !hasValidEvidence(fullText, evidence, rule)) continue;
      await window.StoryDB.db.worldRules.add({
        type: 'soft_lore',
        content: clean,
        source: isFromDigest ? 'digest' : 'seed',
        updatedAt: Date.now()
      });
      knownRules.add(clean.toLowerCase());
      addedRules++;
    }
  }
  return { addedChars, addedRules };
}

async function pruneInactiveNpcs(chapterNumber, activeNpcNames = []) {
  const MAX_ACTIVE_NPCS = 15;
  const all = await window.StoryDB.db.characters.toArray();
  const npcs = all.filter((c) => c.role === 'npc');
  if (npcs.length <= MAX_ACTIVE_NPCS) return [];

  const activeSet = new Set((activeNpcNames || []).map((s) => String(s || '').toLowerCase().trim()));
  const candidates = npcs
    .filter((n) => (n.appearances || 1) === 1 && chapterNumber - (n.lastSeenChapter || 0) > 5 && !activeSet.has(n.name.toLowerCase()))
    .sort((a, b) => (a.lastSeenChapter || 0) - (b.lastSeenChapter || 0));

  const toDelete = candidates.slice(0, npcs.length - MAX_ACTIVE_NPCS);
  if (toDelete.length === 0) return [];

  const backup = await window.StoryDB.getSetting('pruned_npcs_backup', []);
  const nextBackup = [...backup, ...toDelete].slice(-20);
  await window.StoryDB.setSetting('pruned_npcs_backup', nextBackup);
  await Promise.all(toDelete.map((n) => window.StoryDB.db.characters.delete(n.name)));
  return toDelete.map((n) => n.name);
}


window.StoryMemory = {
  VOICE_HANDBOOK,
  VOICE_ANCHORS,
  countWords,
  scoreByKeywords,
  buildCharCoreCard,
  retrieveDynamicCanon,
  lintScene,
  countLexicalIssues,
  getL1HardCanon,
  getL2Ledger,
  saveL2Ledger,
  getL3Summaries,
  searchL4Chapters,
  buildVoiceHandbook,
  buildVoiceAnchors,
  harvestFromDigest,
  lookupRecurringNpcs,
  serializeL2ForPrompt,
  pruneInactiveNpcs,
  CLEAR_SENTINEL,
  mergeCharacterState,
  resolveKnownCharName,
  getActiveSceneRelationships,
  formatSceneRelationships,
  mergeAddressingChanges,
  isValidAddressingShape,
  countAddressingInDialogue,
  isPoisonedDefaultAddressing
};
