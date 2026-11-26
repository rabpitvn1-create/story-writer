let activeAbortController = null;
let gracefulStopRequested = false;
let isWriting = false;

function parseTextToBlocks(text) {
  const lines = String(text || '').split(/\r?\n/);
  const blocks = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([A-ZÀ-Ỹ][A-Za-zÀ-ỹ0-9\s]{0,24}):\s+(.+)$/);
    if (m) {
      blocks.push({ type: 'dialogue', speaker: m[1].trim(), text: m[2].trim() });
    } else {
      blocks.push({ type: 'narrative', text: line });
    }
  }
  return blocks;
}

function trimToWordLimit(text, maxWords = 2250) {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text;
  const sliced = words.slice(0, maxWords).join(' ');
  const lastPeriod = Math.max(sliced.lastIndexOf('.'), sliced.lastIndexOf('!'), sliced.lastIndexOf('?'));
  return lastPeriod > sliced.length * 0.7 ? sliced.slice(0, lastPeriod + 1) : sliced;
}

// chapter.js — cắt lùi về dấu kết câu gần nhất nếu model tự dừng giữa câu (chỉ cắt khi nằm sau 70% văn bản)
function trimIncompleteEnding(text) {
  const clean = String(text || '').trim();
  if (!clean) return clean;
  if (/[.!?…]["”»)]*$/u.test(clean)) return clean;

  const lastIdx = Math.max(
    clean.lastIndexOf('.'),
    clean.lastIndexOf('!'),
    clean.lastIndexOf('?'),
    clean.lastIndexOf('…')
  );
  if (lastIdx <= 0) return clean;

  let cutPos = lastIdx + 1;
  while (cutPos < clean.length && /["”»)]/.test(clean[cutPos])) {
    cutPos++;
  }
  if (cutPos > clean.length * 0.7) {
    return clean.slice(0, cutPos).trim();
  }
  return clean;
}

async function getStoryPrefsDirective() {
  const prefs = await window.StoryDB.getSetting('storyPrefs', null);
  if (!prefs) return '';
  const allGenres = Array.isArray(prefs.genres) ? [...prefs.genres] : [];
  if (prefs.customGenre) allGenres.push(prefs.customGenre);
  const genreStr = allGenres.length ? allGenres.join(', ') : 'Tự do';
  return `GU TRUYỆN: Thể loại [${genreStr}]; Kịch tính: ${prefs.drama || 'Trung bình'}; Tỉ lệ nhân vật phụ (có hồ sơ) chết: ${prefs.sideCharDeathRate || 'Trung bình'}; Định hướng kết thúc: ${prefs.ending || 'Kết thúc mở'} (lái dần các biến cố và móc nối về hướng này).`;
}

// R2-02: kiểm tra canon sau mỗi lần generate (fail-closed); Seed Mode bỏ qua factsUsed (l1 chỉ có 1 dòng mặc định)
function verifyOutlineCanon(parsed, l1, l2, isSeedMode = false) {
  const errors = [];
  if (window.EndlessManager) {
    errors.push(...window.EndlessManager.auditOutlineContinuity(parsed, l2));
  }

  const check = parsed?.canonCheck;
  if (!check || typeof check !== 'object') {
    errors.push('Thiếu trường bắt buộc canonCheck trong dàn ý.');
    return errors;
  }

  // 1. Chỉ báo lỗi người chết khi họ xuất hiện trong characters (có mặt trực tiếp), KHÔNG báo oan khi chỉ ở mentions
  const deadList = Array.isArray(l2?.deadCharacters) ? l2.deadCharacters.filter(Boolean) : [];
  const presentChars = Array.isArray(check.characters) ? check.characters.map((s) => String(s || '').trim().toLowerCase()) : [];
  const mentionedChars = new Set(
    (Array.isArray(check.mentions) ? check.mentions : []).map((s) => String(s || '').trim().toLowerCase())
  );
  for (const dead of deadList) {
    const dl = String(dead).trim().toLowerCase();
    if (dl && presentChars.includes(dl)) {
      errors.push(`Nhân vật đã chết "${dead}" xuất hiện trực tiếp trong canonCheck.characters.`);
    }
  }
  // Tương thích ngược: nếu model tự ghi deadMentioned mà không nằm trong mentions
  if (Array.isArray(check.deadMentioned)) {
    for (const dm of check.deadMentioned) {
      const dml = String(dm || '').trim().toLowerCase();
      if (dml && !mentionedChars.has(dml)) {
        errors.push(`Dàn ý đưa nhân vật đã chết "${dm}" trở lại ngoài hồi tưởng.`);
      }
    }
  }

  // 2. Đồ đã mất
  if (Array.isArray(check.lostItemsUsed) && check.lostItemsUsed.length > 0) {
    errors.push(`Dàn ý dùng lại đồ đã mất: ${check.lostItemsUsed.join(', ')}.`);
  } else if (Array.isArray(l2?.lostItems) && l2.lostItems.length > 0 && Array.isArray(parsed?.scenes)) {
    const sceneBlob = parsed.scenes.map((s) => `${s.goal || ''} ${s.beats || ''}`).join(' ').toLowerCase();
    for (const item of l2.lostItems) {
      const il = String(item).trim().toLowerCase();
      if (il.length >= 4 && sceneBlob.includes(il) && !mentionedChars.has(il)) {
        errors.push(`Dàn ý có dấu hiệu dùng lại đồ đã mất "${item}".`);
      }
    }
  }

  // factsUsed phải là substring thật của L1 hoặc L2; Seed Mode bỏ qua (l1 mặc định 1 dòng, model dễ lệch vài ký tự)
  if (!isSeedMode) {
    const facts = Array.isArray(check.factsUsed) ? check.factsUsed.filter((s) => String(s || '').trim().length >= 8) : [];
    if (facts.length === 0) {
      errors.push('canonCheck.factsUsed phải có ít nhất 1 trích đoạn nguyên văn (>=8 ký tự) từ L1 hoặc L2.');
    } else {
      const corpus = `${String(l1 || '')}\n${JSON.stringify(l2 || {})}`.replace(/\s+/g, ' ').toLowerCase();
      const hasRealFact = facts.some((f) => corpus.includes(String(f).replace(/\s+/g, ' ').trim().toLowerCase()));
      if (!hasRealFact) {
        errors.push('canonCheck.factsUsed không khớp nguyên văn với L1 hoặc L2 (nghi ngờ bịa canon).');
      }
    }
  }

  // 3. Kiểm tra nhịp outcome, hook và nối tiếp exitState (chỉ chạy khi có scenes)
  const scenes = Array.isArray(parsed?.scenes) ? parsed.scenes : [];
  if (scenes.length > 0) {
    const outcomes = scenes.map((s) => String(s?.outcome || '').trim().toLowerCase()).filter(Boolean);
    if (scenes.length >= 3 && outcomes.length === scenes.length && outcomes.every((o) => o === 'yes')) {
      errors.push('Cả 3 cảnh đều có outcome "yes" (thiếu áp lực); đổi ít nhất 1 cảnh sang "yes-but" hoặc "no-and".');
    }

    // Hook thiếu thì KHÔNG lỗi cứng: prompt đã yêu cầu, normalizeOutlineData cho fallback rỗng,
    // prompt cảnh bỏ qua hook khi rỗng — làm fail-closed ở đây sẽ vỡ chương khi model bỏ sót hook.
    // (Chỉ kiểm nhịp outcome khi model đã trả đủ outcome cho cả 3 cảnh — xem trên.)

    for (let i = 0; i < scenes.length - 1; i++) {
      const prevExit = String(scenes[i]?.exitState || '').trim();
      const nextText = `${scenes[i + 1]?.goal || ''} ${scenes[i + 1]?.beats || ''}`.trim();
      if (prevExit.length >= 8 && !nextText) {
        errors.push(`Cảnh ${i + 2} chưa có nội dung nối tiếp từ exitState của Cảnh ${i + 1}.`);
      }
      // Bắt lỗi ngược bối cảnh hiển nhiên: cảnh i rời khỏi nơi X nhưng cảnh i+1 vẫn mở trong nơi X
      const leftMatch = prevExit.match(/rời(?:\s+khỏi)?\s+([^\.,;]{3,28})/iu);
      if (leftMatch && nextText) {
        const place = leftMatch[1].trim().toLowerCase();
        const nextFirst = nextText.slice(0, 120).toLowerCase();
        if (place.length >= 4 && (nextFirst.includes(`trong ${place}`) || nextFirst.includes(`tại ${place}`))) {
          errors.push(`Cảnh ${i + 2} có dấu hiệu quay ngược lại "${leftMatch[1].trim()}" dù exitState Cảnh ${i + 1} đã rời đi.`);
        }
      }
    }
  }

  return errors;
}

// chapter.js — chuẩn hóa outline mới với JS fallback an toàn (giữ scene.beats dạng chuỗi để mọi caller cũ không vỡ)
const VALID_OUTCOMES = new Set(['yes', 'no', 'yes-but', 'no-and']);
const VALID_HOOK_TYPES = new Set(['cliffhanger', 'question', 'revelation', 'reversal', 'decision', 'emotional', 'resolution']);

function normalizeOutlineData(rawOutline) {
  if (!rawOutline || typeof rawOutline !== 'object') return rawOutline;
  const out = { ...rawOutline };
  out.threads = typeof out.threads === 'string' ? out.threads.trim() : '';
  out.anchors = typeof out.anchors === 'string' ? out.anchors.trim() : '';
  out.unsaid = typeof out.unsaid === 'string' ? out.unsaid.trim() : '';

  if (out.hook && typeof out.hook === 'object') {
    const hType = String(out.hook.type || '').trim().toLowerCase();
    out.hook = {
      type: VALID_HOOK_TYPES.has(hType) ? hType : 'question',
      line: String(out.hook.line || '').trim()
    };
  } else if (typeof out.hook === 'string' && out.hook.trim()) {
    out.hook = { type: 'question', line: out.hook.trim() };
  } else {
    out.hook = { type: '', line: '' };
  }

  if (out.canonCheck && typeof out.canonCheck === 'object') {
    out.canonCheck = {
      characters: Array.isArray(out.canonCheck.characters) ? out.canonCheck.characters : [],
      mentions: Array.isArray(out.canonCheck.mentions) ? out.canonCheck.mentions : [],
      deadMentioned: Array.isArray(out.canonCheck.deadMentioned) ? out.canonCheck.deadMentioned : [],
      lostItemsUsed: Array.isArray(out.canonCheck.lostItemsUsed) ? out.canonCheck.lostItemsUsed : [],
      factsUsed: Array.isArray(out.canonCheck.factsUsed) ? out.canonCheck.factsUsed : []
    };
  }

  if (Array.isArray(out.scenes)) {
    out.scenes = out.scenes.map((sc, idx) => {
      const s = sc && typeof sc === 'object' ? { ...sc } : {};
      s.index = Number(s.index) || idx + 1;
      s.goal = String(s.goal || '').trim();
      if (Array.isArray(s.beats)) {
        s.beatList = s.beats.map((b) => String(b || '').trim()).filter(Boolean);
        s.beats = s.beatList.map((b, bi) => `${bi + 1}. ${b}`).join(' ');
      } else {
        s.beats = String(s.beats || '').trim();
        s.beatList = s.beats ? [s.beats] : [];
      }
      const oc = String(s.outcome || '').trim().toLowerCase();
      s.outcome = VALID_OUTCOMES.has(oc) ? oc : '';
      s.tension = String(s.tension || '').trim();
      s.exitState = String(s.exitState || '').trim();
      s.povBlindspot = String(s.povBlindspot || '').trim();
      return s;
    });
  }
  return out;
}

async function generateOutline(chapterNumber, l1, l2, l3, l4Hits, signal, auditFixNote = '', creativity = null, userDirection = '', prefsDirective = '', onUsage = null, isSeedMode = false, auditRound = 0) {
  const l4Text = l4Hits.map((h) => `[Chương ${h.chapterNumber}]: ${h.snippet}`).join('\n');
  const recentMotifsText = creativity?.recentMotifs?.length
    ? creativity.recentMotifs.map((m) => `${m.conflict}/${m.environment}`).join(', ')
    : 'Chưa có';

  const seedBlock = isSeedMode
    ? `\nCHẾ ĐỘ KHỞI TẠO (CODEX TRỐNG): Tự sáng tác 2–3 nhân vật (nhân vật đầu tiên là nhân vật chính POV) và 2–3 luật thế giới nền khớp thể loại & bối cảnh. Trả thêm 2 mảng trong JSON:
  "seededCharacters": [{ "name": "", "age": "", "gender": "", "appearance": "", "personality": "", "misbelief": "niềm tin sai lầm cốt lõi", "thirdRail": "chủ đề cấm kỵ/dễ nổ", "speech_style": "1 dòng giọng nói riêng biệt" }],
  "seededRules": ["luật thế giới nền ngắn gọn"]\n`
    : '';
  const l2Str = await window.StoryMemory.serializeL2ForPrompt(l2);

  const prompt = `Lập dàn ý gọn-nhưng-chắc cho Chương ${chapterNumber} (mục tiêu tổng: khoảng 3.000 từ tiếng Việt, chia đúng 3 cảnh, mỗi cảnh ~900-1.100 từ).
${prefsDirective ? `${prefsDirective}\n` : ''}${userDirection ? `Gợi ý hướng đi từ tác giả: ${userDirection}\n` : ''}${auditFixNote ? `BẮT BUỘC SỬA LỖI DÀN Ý LẦN TRƯỚC:\n${auditFixNote}\n` : ''}
HƯỚNG CỐT TRUYỆN ĐƯỢC CHỌN: ${creativity?.branch || 'twist'} (${creativity?.branchLabel || ''})
TRÁNH LẶP MOTIF ĐÃ DÙNG GẦN ĐÂY: ${recentMotifsText}
${creativity?.tensionNote ? `NHỊP CĂNG THẲNG: ${creativity.tensionNote}` : ''}
${seedBlock}
Được phép tạo NPC quần chúng cho bối cảnh sống động nhưng cấm trùng tên với nhân vật đã có.
L2: ${l2Str}
L3: ${l3.arcsText}\n${l3.recentText}
L4: ${l4Text || 'Không có'}

LUẬT CẤU TRÚC BẮT BUỘC:
- Cấm giải thích toạc chủ đề hay rút bài học cuối cảnh/chương (ý nghĩa ngầm ghi ở "unsaid" và KHÔNG viết vào văn xuôi).
- Cấm giải quyết nút thắt bằng "nhân vật bỗng ngộ ra"; phải giải quyết bằng hành động hoặc quyết định có cái giá cụ thể.
- Giữ vùng xám đạo đức & chi tiết bỏ lửng; trong 3 cảnh PHẢI có ít nhất 1 cảnh có outcome là "yes-but" hoặc "no-and".
- Cảnh i+1 phải nối tiếp trực tiếp từ exitState của Cảnh i (không nhảy ngược bối cảnh).

Trả về ĐÚNG 1 JSON hợp lệ (KHÔNG giải thích thêm):
{
  "title": "Tiêu đề chương ngắn gọn, gợi hình",
  "branch": "${creativity?.branch || 'twist'}",
  "motif": { "conflict": "sinh tồn/tâm lý/giải đố/gặp gỡ", "environment": "mô tả ngắn bối cảnh" },
  "threads": "1 câu: tuyến thứ hai chạy song song hoặc tạo ma sát ngược tuyến chính",
  "anchors": "2-3 neo cụ thể (tên đường, quán, vật dụng, mốc năm thật đúng bối cảnh)",
  "unsaid": "1 câu ý nghĩa ngầm sẽ KHÔNG viết thẳng ra trong văn xuôi",
  "hook": { "type": "cliffhanger|question|revelation|reversal|decision|emotional|resolution", "line": "1 câu cụ thể khép chương" },
  "scenes": [
    {
      "index": 1,
      "goal": "1 câu: nhân vật chính muốn gì vs thứ cản lại (Cảnh 1 mở thẳng giữa tình huống)",
      "beats": ["Beat 1 (1 câu)", "Beat 2 do beat 1 gây ra (1 câu)", "Beat 3 dẫn tới hệ quả (1 câu)"],
      "outcome": "yes-but",
      "tension": "5 - tăng",
      "exitState": "1 câu: kết cảnh ở đâu, cùng ai, trạng thái gì vừa đổi",
      "povBlindspot": "(tùy chọn) điều nhân vật chính chưa biết trong cảnh này"
    },
    {
      "index": 2,
      "goal": "1 câu: biến cố đẩy cao trào",
      "beats": ["Beat 1 (1 câu)", "Beat 2 do beat 1 gây ra (1 câu)", "Beat 3 dẫn tới hệ quả (1 câu)"],
      "outcome": "no-and",
      "tension": "8 - đỉnh",
      "exitState": "1 câu: kết cảnh ở đâu, cùng ai, trạng thái gì vừa đổi",
      "povBlindspot": "(tùy chọn) điều nhân vật chính chưa biết trong cảnh này"
    },
    {
      "index": 3,
      "goal": "1 câu: dư âm & móc nối mở",
      "beats": ["Beat 1 (1 câu)", "Beat 2 do beat 1 gây ra (1 câu)", "Beat 3 dẫn tới hệ quả (1 câu)"],
      "outcome": "yes-but",
      "tension": "6 - dư âm",
      "exitState": "1 câu: kết cảnh ở đâu, cùng ai, trạng thái gì vừa đổi",
      "povBlindspot": "(tùy chọn) điều nhân vật chính chưa biết trong cảnh này"
    }
  ],
  "canonCheck": {
    "characters": ["tên nhân vật CÓ MẶT trực tiếp trong chương"],
    "mentions": ["tên nhân vật chỉ được nhắc tên hoặc hồi tưởng"],
    "deadMentioned": [],
    "lostItemsUsed": [],
    "factsUsed": ["2-3 chi tiết trích nguyên văn từ L1 hoặc L2 làm căn cứ"]
  }
}`;

  // Free-tier hay trả JSON bị cắt: thử lại 1 lần rồi mới báo lỗi thân thiện
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await window.RequestQueue.enqueue({
      lane: 'utility',
      systemPrompt: `${l1}\n\nChỉ trả về JSON hợp lệ.`,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1800,
      temperature: 0.7,
      reasoningEffort: window.UnifiedAdapter?.REASONING_EFFORT?.outline || 'low',
      stream: false,
      signal,
      onUsage
    });

    let outline = null;
    try {
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
      outline = JSON.parse(cleaned);
      outline = normalizeOutlineData(outline);
      if (!outline || !Array.isArray(outline.scenes) || outline.scenes.length === 0) {
        throw new Error('Dàn ý thiếu danh sách cảnh.');
      }
    } catch {
      if (attempt === 1) throw new Error('Dàn ý trả về không phải JSON hợp lệ, bấm Viết chương tiếp để thử lại.');
      continue;
    }
    // R2-02: kiểm tra canon sau MỖI lần generate (kể cả lần sửa), tối đa 2 vòng rồi fail-closed
    const MAX_AUDIT_ROUNDS = 2;
    const violations = verifyOutlineCanon(outline, l1, l2, isSeedMode);
    if (violations.length > 0) {
      if (auditRound < MAX_AUDIT_ROUNDS) {
        return generateOutline(chapterNumber, l1, l2, l3, l4Hits, signal, violations.join(' '), creativity, userDirection, prefsDirective, onUsage, isSeedMode, auditRound + 1);
      }
      throw new Error(`Dàn ý vẫn vi phạm canon sau ${MAX_AUDIT_ROUNDS} lần tự kiểm tra (${violations[0]}). Vui lòng thử bấm viết lại hoặc kiểm tra sổ cái.`);
    }
    return outline;
  }
}

async function writeSingleScene({ chapterNumber, scene, totalScenes, l1, l2, l3, rollingTail, prevExitState = '', outlineMeta = null, linterNotes, signal, onProgress, onChunk, prefsDirective = '', onUsage = null, mainChar = null }) {
  const systemPrompt = `${l1}\n\n${window.StoryMemory.buildVoiceHandbook(mainChar)}\n\n${window.StoryMemory.buildVoiceAnchors(mainChar)}`;
  const isLast = scene.index === totalScenes;
  const l2Str = await window.StoryMemory.serializeL2ForPrompt(l2);
  const sceneQuery = `${scene.goal || ''} ${scene.beats || ''}`;
  const recurringNpcText = await window.StoryMemory.lookupRecurringNpcs(sceneQuery);
  const addressingLine = window.StoryMemory.formatSceneRelationships(l2?.relationships, sceneQuery);

  const sceneMetaParts = [];
  if (scene.outcome) sceneMetaParts.push(`Kết cục cảnh: ${scene.outcome}`);
  if (scene.tension) sceneMetaParts.push(`Nhịp căng: ${scene.tension}`);
  if (scene.povBlindspot) sceneMetaParts.push(`Điểm mù POV (chưa biết): ${scene.povBlindspot}`);
  if (scene.exitState) sceneMetaParts.push(`Trạng thái kết cảnh bắt buộc: ${scene.exitState}`);

  const chapterMetaParts = [];
  if (outlineMeta?.threads) chapterMetaParts.push(`Tuyến phụ tạo ma sát: ${outlineMeta.threads}`);
  if (outlineMeta?.anchors) chapterMetaParts.push(`Neo bối cảnh cụ thể: ${outlineMeta.anchors}`);
  if (isLast && outlineMeta?.hook?.line) chapterMetaParts.push(`Hook khép chương (${outlineMeta.hook.type || 'open'}): ${outlineMeta.hook.line}`);

  const userPrompt = `Viết Cảnh ${scene.index}/${totalScenes} của Chương ${chapterNumber} (độ dài mục tiêu: 900-1.100 từ tiếng Việt).
Mục tiêu cảnh: ${scene.goal}
${prefsDirective ? `${prefsDirective}\n` : ''}Chi tiết: ${scene.beats}
${sceneMetaParts.length ? `${sceneMetaParts.join(' | ')}\n` : ''}${chapterMetaParts.length ? `${chapterMetaParts.join(' | ')}\n` : ''}Trạng thái hiện tại (L2): ${l2Str}${recurringNpcText ? `\n${recurringNpcText}` : ''}
Tóm tắt gần nhất (L3): ${l3.recentText || 'Chương mở đầu'}
${prevExitState ? `Trạng thái bắt buộc nối tiếp từ cảnh trước: ${prevExitState}\n` : ''}${rollingTail ? `Đoạn cuối cảnh trước (viết nối tiếp mượt mà, không lặp lại):\n"""\n${rollingTail}\n"""` : ''}
Lời thoại CHỈ viết dạng Tên: lời thoại, một câu một dòng — KHÔNG viết thoại trong ngoặc kép kiểu văn xuôi, KHÔNG đổi dạng giữa chừng.
Ưu tiên động từ và tính từ đơn rõ nghĩa; chỉ dùng từ láy thật quen thuộc, tránh từ láy hiếm/địa phương, không chèn chữ Hán/Anh, không lặp cùng một từ láy hay tính từ miêu tả quá 2 lần trong cảnh.
${addressingLine ? `${addressingLine}` : ''}
${linterNotes.length ? `LƯU Ý SỬA PHONG CÁCH:\n- ${linterNotes.join('\n- ')}` : ''}
${isLast ? 'Đây là cảnh cuối chương, hãy khép lại bằng đúng hook đã định, không giải thích chủ đề.' : 'KHÔNG được kết thúc chương ở cảnh này, chỉ dừng ở đúng trạng thái kết cảnh để viết tiếp.'}`;

  let text = await window.RequestQueue.enqueue({
    lane: 'writer',
    systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    maxTokens: 4096,
    temperature: 0.85,
    reasoningEffort: window.UnifiedAdapter?.REASONING_EFFORT?.scene || 'low',
    stream: true,
    onToken: (chunk, full) => {
      if (onProgress) onProgress(window.StoryMemory.countWords(full));
      if (onChunk && chunk) onChunk(chunk, full);
    },
    signal,
    onUsage
  });

  // Cổng kiểm số từ: chỉ cứu cụt dưới 750 từ, nối tới ~1.100 từ (cảnh ~900-1.100 từ đã xong beats thì dừng, không ép nối)
  let words = window.StoryMemory.countWords(text);
  if (words < 750) {
    const tail = text.split(/\s+/).slice(-450).join(' ');
    const targetMore = Math.max(300, 1100 - words);
    let firstExtraChunk = true;
    const extra = await window.RequestQueue.enqueue({
      lane: 'writer',
      systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Đoạn cảnh ${scene.index} mới đạt ${words} từ (bị ngắn). Chi tiết cảnh: ${scene.beats || scene.goal || ''}.\nHãy viết tiếp nối NGAY SAU đoạn dưới đây thêm khoảng ~${targetMore} từ để khép cảnh trọn vẹn (TUYỆT ĐỐI KHÔNG lặp lại sự kiện, hành động hay lời thoại đã diễn ra trước đó; không đảo ngược bối cảnh đã thiết lập):\n"""\n${tail}\n"""`
        }
      ],
      maxTokens: 2500,
      temperature: 0.85,
      reasoningEffort: window.UnifiedAdapter?.REASONING_EFFORT?.scene || 'low',
      stream: true,
      onToken: (chunk, fullExtra) => {
        if (onProgress) onProgress(words + window.StoryMemory.countWords(fullExtra));
        if (onChunk && chunk) {
          onChunk(firstExtraChunk ? `\n\n${chunk}` : chunk, `${text}\n\n${fullExtra}`);
          firstExtraChunk = false;
        }
      },
      signal,
      onUsage
    });
    text = `${text.trim()}\n\n${extra.trim()}`;
  }

  const trimmed = trimToWordLimit(text, 1450);
  return trimIncompleteEnding(trimmed);
}

async function digestChapter(chapterNumber, fullText, l2, signal, onUsage = null) {
  const midStart = Math.max(0, Math.floor((fullText.length - 4000) / 2));
  const excerpt =
    fullText.length <= 12000
      ? fullText
      : `${fullText.slice(0, 4000)}\n...\n${fullText.slice(midStart, midStart + 4000)}\n...\n${fullText.slice(-4000)}`;
  const l2Str = await window.StoryMemory.serializeL2ForPrompt(l2);

  // D-01: mẫu characterStates liệt kê MỌI nhân vật có hồ sơ (role !== 'npc') để digest không bỏ sót key
  const allCharsForDigest = await window.StoryDB.db.characters.toArray();
  const trackedChars = allCharsForDigest.filter((c) => c.role !== 'npc');
  const mainCharForDigest =
    allCharsForDigest.find((c) => window.CodexParser?.isMainCharacter(c)) ||
    trackedChars[0] ||
    null;
  const needPovPronoun = Boolean(mainCharForDigest && !mainCharForDigest.narratorPronoun);
  const knownRelSummary = Object.values(l2?.relationships || {})
    .map((r) => `${r.a}→${r.b}:"${r.aToB || ''}",${r.b}→${r.a}:"${r.bToA || ''}"`)
    .join('; ');

  const stateTemplateObj = {};
  (trackedChars.length ? trackedChars : [{ name: Object.keys(l2.characterStates || {})[0] || 'Nhân vật chính' }]).forEach((c) => {
    stateTemplateObj[c.name] = { level: '', injuries: '', pickedUpItems: '' };
  });

  const prompt = `Đọc Chương ${chapterNumber} dưới đây và trả về 1 JSON duy nhất:
{
  "summary": "Tóm tắt sự kiện chính trong 80-130 từ",
  "location": "Vị trí/Level mới nhất",
  "newDeadCharacters": [],
  "newLostItems": [],
  "openHooks": ["Danh sách tối đa 5 lời hứa/bí ẩn đang mở"],
  "activeNpcNames": ["tối đa 2-3 NPC có vai trò mở cần giữ"],
  "newCharacters": [{ "name": "", "appearance": "", "personality": "" }],
  "newWorldRules": ["luật/bối cảnh mới thực sự xác lập, KHÔNG ghi đồ bịa"],
  "evidence": { "<tên nhân vật hoặc nguyên văn luật mới>": "<trích đoạn nguyên văn <=120 ký tự từ chương>" },
  "characterStates": ${JSON.stringify(stateTemplateObj)},
  "addressingChanges": [{ "a": "", "b": "", "aToB": "", "bToA": "", "reason": "" }],
${needPovPronoun ? `  "povPronoun": "đại từ ngôi 3 trần thuật đã dùng cho ${mainCharForDigest.name}",\n` : ''}  "tension_level": 5
}
QUY TẮC TRẠNG THÁI: Để "" hoặc null nghĩa là KHÔNG ĐỔI (giữ nguyên cũ). Đồ đã mất thì ghi vào newLostItems, không để inventory rỗng. Chỉ khi muốn xóa sạch thương tích/trạng thái đã hết mới ghi "[XÓA]".
KHÔNG đưa NPC quần chúng vào characterStates. addressingChanges chỉ ghi cặp quan trọng lần đầu đối thoại, bổ sung chiều trống hoặc đổi quan hệ lâu dài (đúng tên hồ sơ, chỉ ghi dạng đã thấy trong thoại); không đổi trả [].
Sổ cái cũ: ${l2Str}${knownRelSummary ? `\nXưng hô đã nhớ: ${knownRelSummary}` : ''}
Nội dung chương:\n${excerpt}`;

  let data = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await window.RequestQueue.enqueue({
      lane: 'utility',
      systemPrompt: 'Trả về JSON thuần, ngắn gọn, chính xác.',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1800,
      temperature: 0.2,
      reasoningEffort: window.UnifiedAdapter?.REASONING_EFFORT?.digest || 'minimal',
      stream: false,
      signal,
      onUsage
    });

    try {
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
      data = JSON.parse(cleaned);
      break;
    } catch {
      if (attempt === 1) throw new Error('Tóm tắt chương trả về không phải JSON hợp lệ, bấm Viết chương tiếp để thử lại.');
    }
  }

  await window.StoryDB.db.summaries.put({
    chapterNumber,
    summary: data.summary || '',
    isArc: false,
    createdAt: Date.now()
  });

  // Gộp Arc Summary mỗi 5 chương
  if (chapterNumber % 5 === 0) {
    const recent5 = await window.StoryDB.db.summaries
      .where('chapterNumber')
      .between(chapterNumber - 4, chapterNumber, true, true)
      .toArray();
    const arcText = recent5.map((s) => `C${s.chapterNumber}: ${s.summary}`).join(' | ');
    await window.StoryDB.db.summaries.put({
      chapterNumber: 100000 + chapterNumber,
      isArc: true,
      arcRange: `${chapterNumber - 4}-${chapterNumber}`,
      summary: arcText.slice(0, 900),
      createdAt: Date.now()
    });
  }

  const nextTension = Math.min(10, Math.max(1, Number(data.tension_level) || 5));
  const nextHistory = [...(l2.tensionHistory || []), nextTension].slice(-6);

  // D-01: merge qua mergeCharacterState ("" = giữ nguyên, "[XÓA]" = xóa thật); chỉ giữ key thuộc nhân vật có trong DB và role !== 'npc'
  const validStateNames = new Set(trackedChars.map((c) => c.name));
  const mergedStates = { ...(l2.characterStates || {}) };
  for (const [k, v] of Object.entries(data.characterStates || {})) {
    if (!validStateNames.has(k)) continue;
    mergedStates[k] = window.StoryMemory.mergeCharacterState(mergedStates[k], v);
  }

  await window.StoryMemory.harvestFromDigest(
    data.newCharacters || [],
    data.newWorldRules || [],
    fullText,
    chapterNumber,
    data.evidence || null
  );
  const deletedNpcNames = await window.StoryMemory.pruneInactiveNpcs(chapterNumber, data.activeNpcNames || []);

  // Khóa đại từ người kể 1 lần ở chương 1 nếu nhân vật chính chưa có narratorPronoun
  if (needPovPronoun && mainCharForDigest && typeof data.povPronoun === 'string') {
    const cleanPov = data.povPronoun.trim().toLowerCase();
    if (cleanPov && cleanPov.length <= 10 && !/^(tôi|mình|ta|tao)$/i.test(cleanPov)) {
      mainCharForDigest.narratorPronoun = cleanPov;
      await window.StoryDB.db.characters.put(mainCharForDigest);
    }
  }

  // Mức 2: lấy danh sách tên hợp lệ SAU khi harvest + prune đã hoàn tất
  // Truyền fullText + charsByName để kích hoạt Bộ lọc 3 lớp (0 query DB thêm: dùng allCharsAfterHarvest đã load)
  const allCharsAfterHarvest = await window.StoryDB.db.characters.toArray();
  const allowedCharNames = allCharsAfterHarvest.map((c) => c.name).filter(Boolean);
  const charsByName = new Map(
    allCharsAfterHarvest
      .filter((c) => c && c.name)
      .map((c) => [String(c.name).trim().toLowerCase(), c])
  );
  const nextRelationships = window.StoryMemory.mergeAddressingChanges(
    l2.relationships,
    data.addressingChanges,
    allowedCharNames,
    chapterNumber,
    deletedNpcNames,
    { fullText, charsByName }
  );

  const nextLedger = {
    location: data.location || l2.location,
    deadCharacters: [...new Set([...(l2.deadCharacters || []), ...(data.newDeadCharacters || [])])],
    lostItems: [...new Set([...(l2.lostItems || []), ...(data.newLostItems || [])])],
    openHooks: Array.isArray(data.openHooks) ? data.openHooks : l2.openHooks,
    relationships: nextRelationships,
    characterStates: mergedStates,
    tensionHistory: nextHistory
  };
  await window.StoryMemory.saveL2Ledger(nextLedger);
  }

async function writeNextChapter({
  onStatus,
  onChapterReady,
  onChapterStart,
  onOutlineReady,
  onSceneStream,
  onSceneDone,
  onAborted,
  onError,
  userDirection = ''
}) {
  if (isWriting) return;
  isWriting = true;
  window.RequestQueue?.resetChapterOverrides?.();
  gracefulStopRequested = false;
  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;

  let currentSceneNum = 1;
  let totalScenesCount = 3;
  let outline = null;
  const chapterUsage = {
    promptTokens: 0,
    completionTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
    calls: 0
  };
  const trackUsage = (u) => {
    chapterUsage.calls += 1;
    if (!u) return;
    chapterUsage.promptTokens += u.promptTokens || 0;
    chapterUsage.completionTokens += u.completionTokens || 0;
    chapterUsage.thinkingTokens += u.thinkingTokens || 0;
    chapterUsage.totalTokens += u.totalTokens || 0;
  };

  try {
    const draft = await window.StoryDB.getSetting('chapter_draft', null);
    const lastCh = await window.StoryDB.db.chapters.orderBy('number').last();
    const chapterNumber = draft ? draft.number : (lastCh ? lastCh.number + 1 : 1);

    const l2 = await window.StoryMemory.getL2Ledger();
    const l3 = await window.StoryMemory.getL3Summaries();
    const prefsDirective = await getStoryPrefsDirective();
    const outlineQuery = [userDirection, l2.location, ...(l2.openHooks || [])].filter(Boolean).join(' ');
    const l4Hits = await window.StoryMemory.searchL4Chapters(outlineQuery, 2);
    const existingChars = await window.StoryDB.db.characters.toArray();
    const isSeedMode = existingChars.length === 0;

    outline = draft?.outline;
    let sceneTexts = Array.isArray(draft?.sceneTexts) ? [...draft.sceneTexts] : [];

    // Đã có bản nháp thì dàn ý giữ nguyên — gợi ý mới không áp dụng cho chương này
    if (draft?.outline && userDirection) {
      onStatus(`Chương ${chapterNumber}: đang viết tiếp từ bản nháp, gợi ý mới không áp dụng cho chương này.`);
    }

    // Mở trang sách ngay lập tức và hiện sẵn các cảnh đã có trong draft (nếu đang viết tiếp)
    if (onChapterStart) onChapterStart(chapterNumber, sceneTexts);

    if (!outline) {
      const creativity = window.EndlessManager
        ? await window.EndlessManager.getCreativityConstraints(l2)
        : null;
      onStatus(`Chương ${chapterNumber}: Đang lập dàn ý (Hướng: ${creativity?.branchLabel || 'Tự do'})...`);
      const outlineL1 = await window.StoryMemory.getL1HardCanon(outlineQuery, true);
      outline = await generateOutline(chapterNumber, outlineL1, l2, l3, l4Hits, signal, '', creativity, userDirection, prefsDirective, trackUsage, isSeedMode);
      await window.StoryDB.setSetting('chapter_draft', { number: chapterNumber, outline, sceneTexts });
    }

    if (onOutlineReady && outline?.title) {
      onOutlineReady(chapterNumber, outline.title);
    }

    // Seed Mode: codex trống thì lưu nhân vật/luật do outline bịa ra TRƯỚC cảnh 1
    if (isSeedMode && outline) {
      if (Array.isArray(outline.seededCharacters) && outline.seededCharacters.length > 0) {
        const seeded = outline.seededCharacters.map((c, idx) => ({
          ...c,
          role: idx === 0 ? 'protagonist' : 'supporting',
          isMain: idx === 0
        }));
        await window.StoryMemory.harvestFromDigest(seeded, []);
      }
      if (Array.isArray(outline.seededRules) && outline.seededRules.length > 0) {
        const existingRules = await window.StoryDB.db.worldRules.where('type').equals('hard_rule').toArray();
        const knownRules = new Set(existingRules.map((r) => String(r.content || '').toLowerCase().trim()));
        for (const r of outline.seededRules) {
          const clean = String(r || '').trim();
          if (!clean || knownRules.has(clean.toLowerCase())) continue;
          await window.StoryDB.db.worldRules.add({ type: 'hard_rule', content: clean, updatedAt: Date.now() });
          knownRules.add(clean.toLowerCase());
        }
      }
    }

    // Nhân vật chính hiện tại cho giọng văn động (sau khi Seed đã lưu)
    const currentChars = await window.StoryDB.db.characters.toArray();
    const mainChar =
      currentChars.find((c) => window.CodexParser?.isMainCharacter(c)) || currentChars[0] || null;

    totalScenesCount = outline.scenes.length;
    let linterNotes = [];
    for (let i = sceneTexts.length; i < outline.scenes.length; i++) {
      currentSceneNum = i + 1;
      const scene = outline.scenes[i];
      const prevText = sceneTexts[i - 1] || '';
      const rollingTail = prevText ? prevText.split(/\s+/).slice(-650).join(' ') : '';
      const sceneQuery = `${scene.goal || ''} ${scene.beats || ''}`.trim();
      const sceneL1 = await window.StoryMemory.getL1HardCanon(sceneQuery, true);

      onStatus(`Chương ${chapterNumber}: Đang viết cảnh ${i + 1}/${totalScenesCount}...`);
      const prevExitState = i > 0 ? String(outline.scenes[i - 1]?.exitState || '').trim() : '';
      const outlineMeta = {
        threads: outline.threads || '',
        anchors: outline.anchors || '',
        hook: outline.hook || null
      };
      const sceneText = await writeSingleScene({
        chapterNumber,
        scene,
        totalScenes: totalScenesCount,
        l1: sceneL1,
        l2,
        l3,
        rollingTail,
        prevExitState,
        outlineMeta,
        linterNotes,
        signal,
        prefsDirective,
        onProgress: (w) => onStatus(`Chương ${chapterNumber}: Cảnh ${i + 1}/${totalScenesCount} (${w} từ)...`),
        onChunk: (chunk, full) => {
          if (onSceneStream) onSceneStream(chunk, full, i);
        },
        onUsage: trackUsage,
        mainChar
      });

      // Cảnh rỗng thì không lưu — lần chạy sau sẽ viết lại đúng cảnh đó
      if (sceneText && sceneText.trim()) {
        linterNotes = window.StoryMemory.lintScene(sceneText, {
          mainChar,
          relationships: l2?.relationships,
          sceneQuery
        });
        let cleanSceneText = window.StoryMemory.stripCjkChars
          ? window.StoryMemory.stripCjkChars(sceneText)
          : sceneText;
        if (window.StoryMemory.stripRawMarkdown) {
          cleanSceneText = window.StoryMemory.stripRawMarkdown(cleanSceneText);
        }
        if (window.StoryMemory.fixVerifiedLexicalTypos) {
          cleanSceneText = window.StoryMemory.fixVerifiedLexicalTypos(cleanSceneText);
        }
        sceneTexts.push(cleanSceneText);
        // Checkpoint ngay sau mỗi cảnh
        await window.StoryDB.setSetting('chapter_draft', { number: chapterNumber, outline, sceneTexts });
        if (onSceneDone) onSceneDone(i, cleanSceneText);
      }
      // Dừng nhẹ: dừng sau cảnh vừa viết xong, hoàn tất chương với các cảnh đã có
      if (gracefulStopRequested) break;
    }

    const fullText = sceneTexts.join('\n\n');
    if (window.StoryMemory.countWords(fullText) < 500) {
      throw new Error('Chương viết ra quá ngắn (dưới 500 từ), bấm Viết chương tiếp để thử lại — bản nháp đã lưu.');
    }
    const chapterRecord = {
      number: chapterNumber,
      title: outline.title || `CHAPTER ${chapterNumber}`,
      text: fullText,
      blocks: parseTextToBlocks(fullText),
      wordCount: window.StoryMemory.countWords(fullText),
      usage: chapterUsage,
      createdAt: Date.now()
    };

    await window.StoryDB.db.chapters.put(chapterRecord);
    onStatus(`Chương ${chapterNumber}: Đang tóm tắt & cập nhật bộ nhớ 4 tầng...`);
    await digestChapter(chapterNumber, fullText, l2, signal, trackUsage);
    if (window.EndlessManager && outline?.motif) {
      await window.EndlessManager.recordChapterMotif(outline.motif);
    }
    await window.StoryDB.setSetting('chapter_draft', null);

    onStatus(`Hoàn thành Chương ${chapterNumber} (${chapterRecord.wordCount} từ).`);
    if (onChapterReady) onChapterReady(chapterRecord, gracefulStopRequested);
  } catch (err) {
    if (err.name === 'AbortError') {
      if (outline) {
        onStatus(`Đã dừng khẩn cấp ở Cảnh ${currentSceneNum}/${totalScenesCount}. Các cảnh đã xong được giữ an toàn.`);
        if (onAborted) onAborted(currentSceneNum, totalScenesCount);
      } else {
        // Ngắt khi chưa lập xong dàn ý: chưa có cảnh nào, chỉ dọn con trỏ nhấp nháy
        onStatus('Đã dừng khẩn cấp trước khi lập dàn ý xong.');
        if (onError) onError(err);
      }
    } else {
      onStatus(`Tạm dừng: ${err.message}`);
      if (onError) onError(err);
    }
  } finally {
    isWriting = false;
    activeAbortController = null;
    window.RequestQueue?.resetChapterOverrides?.();
  }
}

function hardStop() {
  if (activeAbortController) activeAbortController.abort();
}

function requestGracefulStop() {
  gracefulStopRequested = true;
}

window.ChapterEngine = {
  parseTextToBlocks,
  writeNextChapter,
  hardStop,
  requestGracefulStop,
  isWriting: () => isWriting
};
