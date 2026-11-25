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

function countWords(text) {
  const clean = String(text || '').trim();
  return clean ? clean.split(/\s+/).length : 0;
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

// L1: Hard Canon (worldRules hard_rule + pinnedFacts + hồ sơ nhân vật chính)
async function getL1HardCanon() {
  const rules = await window.StoryDB.db.worldRules.where('type').equals('hard_rule').toArray();
  const pinned = await window.StoryDB.getSetting('pinned_facts', []);
  const chars = await window.StoryDB.db.characters.toArray();

  const ruleText = rules.map((r) => `- ${r.content}`).join('\n') || '- Tuân thủ logic sinh tồn thực tế.';
  const pinnedText = pinned.length ? pinned.map((p) => `- ${p}`).join('\n') : '';
  const charText = chars
    .slice(0, 6)
    .map((c) => `- ${c.name}: ${c.personality || c.description || ''} ${c.hard_constraints ? `(Cấm: ${c.hard_constraints})` : ''}`.trim())
    .join('\n');

  return [
    'LUẬT THẾ GIỚI BẤT BIẾN (L1):',
    ruleText,
    pinnedText ? `SỰ THẬT ĐÃ GHIM:\n${pinnedText}` : '',
    charText ? `NHÂN VẬT CỐT LÕI:\n${charText}` : ''
  ]
    .filter(Boolean)
    .join('\n\n');
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

// L4: Tìm kiếm từ khóa đơn giản trên toàn văn chương cũ (0 API call)
async function searchL4Chapters(query, limit = 2) {
  const keywords = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  if (keywords.length === 0) return [];

  const chapters = await window.StoryDB.db.chapters.toArray();
  const hits = [];

  for (const ch of chapters) {
    if (!ch.text) continue;
    const paras = ch.text.split(/\n{2,}/);
    for (const p of paras) {
      const lower = p.toLowerCase();
      let score = 0;
      for (const kw of keywords) {
        if (lower.includes(kw)) score++;
      }
      if (score > 0) {
        hits.push({ chapterNumber: ch.number, score, snippet: p.slice(0, 450) });
      }
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

window.StoryMemory = {
  VOICE_HANDBOOK,
  VOICE_ANCHORS,
  countWords,
  lintScene,
  getL1HardCanon,
  getL2Ledger,
  saveL2Ledger,
  getL3Summaries,
  searchL4Chapters
};
