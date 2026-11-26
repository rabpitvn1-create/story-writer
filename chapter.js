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
  if (Array.isArray(check.deadMentioned) && check.deadMentioned.length > 0) {
    errors.push(`Dàn ý tự báo có nhắc nhân vật đã chết: ${check.deadMentioned.join(', ')}.`);
  }
  if (Array.isArray(check.lostItemsUsed) && check.lostItemsUsed.length > 0) {
    errors.push(`Dàn ý tự báo có dùng vật phẩm đã mất: ${check.lostItemsUsed.join(', ')}.`);
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
  return errors;
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

  const prompt = `Lập dàn ý 3 cảnh lớn cho Chương ${chapterNumber} (mục tiêu tổng 5.000–6.000 từ tiếng Việt) và tự kiểm tra L1/L2.
HƯỚNG CỐT TRUYỆN ĐƯỢC CHỌN: ${creativity?.branch || 'twist'} (${creativity?.branchLabel || ''})
TRÁNH LẶP MOTIF ĐÃ DÙNG GẦN ĐÂY: ${recentMotifsText}
${creativity?.tensionNote ? `NHỊP CĂNG THẲNG: ${creativity.tensionNote}` : ''}
${userDirection ? `GỢI Ý CỦA NGƯỜI VIẾT (ưu tiên cao nhất, dàn ý phải bám sát gợi ý này): ${userDirection}` : ''}
${prefsDirective ? `${prefsDirective}\n` : ''}
${auditFixNote ? `SỬA LỖI VI PHẠM CANON TRƯỚC ĐÓ: ${auditFixNote}` : ''}
${seedBlock}
Được phép tạo NPC quần chúng cho bối cảnh sống động nhưng cấm trùng tên với nhân vật đã có.
Trả về JSON thuần:
{
  "title": "Tên chương ngắn",
  "branch": "${creativity?.branch || 'twist'}",
  "motif": { "conflict": "sinh tồn/tâm lý/giải đố/gặp gỡ", "environment": "mô tả ngắn bối cảnh" },
  "scenes": [
    { "index": 1, "goal": "Mở đầu & khám phá", "beats": "Chi tiết" },
    { "index": 2, "goal": "Biến cố & cao trào", "beats": "Chi tiết" },
    { "index": 3, "goal": "Dư âm & móc nối", "beats": "Chi tiết" }
  ],
  "canonCheck": {
    "deadMentioned": [],
    "lostItemsUsed": [],
    "factsUsed": ["trích nguyên văn <=100 ký tự từ L1 hoặc L2 làm căn cứ cho dàn ý"]
  }
}
L2: ${l2Str}
L3: ${l3.arcsText}\n${l3.recentText}
L4: ${l4Text || 'Không có'}`;

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

async function writeSingleScene({ chapterNumber, scene, totalScenes, l1, l2, l3, rollingTail, linterNotes, signal, onProgress, onChunk, prefsDirective = '', onUsage = null, mainChar = null }) {
  const systemPrompt = `${l1}\n\n${window.StoryMemory.buildVoiceHandbook(mainChar)}\n\n${window.StoryMemory.buildVoiceAnchors(mainChar)}`;
  const isLast = scene.index === totalScenes;
  const l2Str = await window.StoryMemory.serializeL2ForPrompt(l2);
  const sceneQuery = `${scene.goal || ''} ${scene.beats || ''}`;
  const recurringNpcText = await window.StoryMemory.lookupRecurringNpcs(sceneQuery);
  const addressingLine = window.StoryMemory.formatSceneRelationships(l2?.relationships, sceneQuery);

  const userPrompt = `Viết Cảnh ${scene.index}/${totalScenes} của Chương ${chapterNumber} (độ dài mục tiêu: 1.800–2.000 từ tiếng Việt).
Mục tiêu cảnh: ${scene.goal}
${prefsDirective ? `${prefsDirective}\n` : ''}Chi tiết: ${scene.beats}
Trạng thái hiện tại (L2): ${l2Str}${recurringNpcText ? `\n${recurringNpcText}` : ''}
Tóm tắt gần nhất (L3): ${l3.recentText || 'Chương mở đầu'}
${rollingTail ? `Đoạn cuối cảnh trước (viết nối tiếp mượt mà, không lặp lại):\n"""\n${rollingTail}\n"""` : ''}
Lời thoại CHỈ viết dạng Tên: lời thoại, một câu một dòng — KHÔNG viết thoại trong ngoặc kép kiểu văn xuôi, KHÔNG đổi dạng giữa chừng.
${addressingLine ? `${addressingLine}` : ''}
${linterNotes.length ? `LƯU Ý SỬA PHONG CÁCH:\n- ${linterNotes.join('\n- ')}` : ''}
${isLast ? 'Đây là cảnh cuối chương, hãy khép lại bằng một dư âm hoặc móc nối mở.' : 'KHÔNG được kết thúc chương ở cảnh này, chỉ dừng ở điểm chuyển cảnh tự nhiên.'}`;

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

  // Cổng kiểm số từ: thiếu dưới 1.700 từ thì viết nối tiếp cho đủ ~1.850 từ (3 cảnh x 1.700 = 5.100)
  let words = window.StoryMemory.countWords(text);
  if (words < 1700) {
    const tail = text.split(/\s+/).slice(-450).join(' ');
    let firstExtraChunk = true;
    const extra = await window.RequestQueue.enqueue({
      lane: 'writer',
      systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Đoạn cảnh ${scene.index} mới đạt ${words} từ. Hãy viết tiếp nối ngay sau đoạn sau để bổ sung thêm ~${1850 - words} từ chi tiết giác quan, tâm lý và đối thoại (không tóm tắt vội):\n"""\n${tail}\n"""`
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

  return trimToWordLimit(text, 2250);
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
      const sceneText = await writeSingleScene({
        chapterNumber,
        scene,
        totalScenes: totalScenesCount,
        l1: sceneL1,
        l2,
        l3,
        rollingTail,
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
        sceneTexts.push(sceneText);
        linterNotes = window.StoryMemory.lintScene(sceneText, {
          mainChar,
          relationships: l2?.relationships,
          sceneQuery
        });
        // Checkpoint ngay sau mỗi cảnh
        await window.StoryDB.setSetting('chapter_draft', { number: chapterNumber, outline, sceneTexts });
        if (onSceneDone) onSceneDone(i, sceneText);
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
