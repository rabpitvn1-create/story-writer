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
  return `GU TRUYỆN: Thể loại [${genreStr}]; Kịch tính: ${prefs.drama || 'Trung bình'}; Tỉ lệ nhân vật phụ chết: ${prefs.sideCharDeathRate || 'Trung bình'}; Định hướng kết thúc: ${prefs.ending || 'Kết thúc mở'} (lái dần các biến cố và móc nối về hướng này).`;
}

async function generateOutline(chapterNumber, l1, l2, l3, l4Hits, signal, auditFixNote = '', creativity = null, userDirection = '', prefsDirective = '', onUsage = null) {
  const l4Text = l4Hits.map((h) => `[Chương ${h.chapterNumber}]: ${h.snippet}`).join('\n');
  const recentMotifsText = creativity?.recentMotifs?.length
    ? creativity.recentMotifs.map((m) => `${m.conflict}/${m.environment}`).join(', ')
    : 'Chưa có';

  const prompt = `Lập dàn ý 3 cảnh lớn cho Chương ${chapterNumber} (mục tiêu tổng 5.000–6.000 từ tiếng Việt) và tự kiểm tra L1/L2.
HƯỚNG CỐT TRUYỆN ĐƯỢC CHỌN: ${creativity?.branch || 'twist'} (${creativity?.branchLabel || ''})
TRÁNH LẶP MOTIF ĐÃ DÙNG GẦN ĐÂY: ${recentMotifsText}
${creativity?.tensionNote ? `NHỊP CĂNG THẲNG: ${creativity.tensionNote}` : ''}
${userDirection ? `GỢI Ý CỦA NGƯỜI VIẾT (ưu tiên cao nhất, dàn ý phải bám sát gợi ý này): ${userDirection}` : ''}
${prefsDirective ? `${prefsDirective}\n` : ''}
${auditFixNote ? `SỬA LỖI VI PHẠM CANON TRƯỚC ĐÓ: ${auditFixNote}` : ''}

Trả về JSON thuần:
{
  "title": "Tên chương ngắn",
  "branch": "${creativity?.branch || 'twist'}",
  "motif": { "conflict": "sinh tồn/tâm lý/giải đố/gặp gỡ", "environment": "mô tả ngắn bối cảnh" },
  "scenes": [
    { "index": 1, "goal": "Mở đầu & khám phá", "beats": "Chi tiết" },
    { "index": 2, "goal": "Biến cố & cao trào", "beats": "Chi tiết" },
    { "index": 3, "goal": "Dư âm & móc nối", "beats": "Chi tiết" }
  ]
}
L2: ${JSON.stringify(l2)}
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
    // Kiểm tra liên tục trước khi viết (chỉ gọi lại tối đa 1 lần nếu vi phạm)
    if (!auditFixNote && window.EndlessManager) {
      const violations = window.EndlessManager.auditOutlineContinuity(outline, l2);
      if (violations.length > 0) {
        return generateOutline(chapterNumber, l1, l2, l3, l4Hits, signal, violations.join(' '), creativity, userDirection, prefsDirective, onUsage);
      }
    }
    return outline;
  }
}

async function writeSingleScene({ chapterNumber, scene, totalScenes, l1, l2, l3, rollingTail, linterNotes, signal, onProgress, onChunk, prefsDirective = '', onUsage = null }) {
  const systemPrompt = `${l1}\n\n${window.StoryMemory.VOICE_HANDBOOK}\n\n${window.StoryMemory.VOICE_ANCHORS}`;
  const isLast = scene.index === totalScenes;

  const userPrompt = `Viết Cảnh ${scene.index}/${totalScenes} của Chương ${chapterNumber} (độ dài mục tiêu: 1.800–2.000 từ tiếng Việt).
Mục tiêu cảnh: ${scene.goal}
${prefsDirective ? `${prefsDirective}\n` : ''}Chi tiết: ${scene.beats}
Trạng thái hiện tại (L2): ${JSON.stringify(l2)}
Tóm tắt gần nhất (L3): ${l3.recentText || 'Chương mở đầu'}
${rollingTail ? `Đoạn cuối cảnh trước (viết nối tiếp mượt mà, không lặp lại):\n"""\n${rollingTail}\n"""` : ''}
${linterNotes.length ? `LƯU Ý SỬA PHONG CÁCH:\n- ${linterNotes.join('\n- ')}` : ''}
${isLast ? 'Đây là cảnh cuối chương, hãy khép lại bằng một dư âm hoặc móc nối mở.' : 'KHÔNG được kết thúc chương ở cảnh này, chỉ dừng ở điểm chuyển cảnh tự nhiên.'}`;

  let text = await window.RequestQueue.enqueue({
    lane: 'writer',
    systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    maxTokens: 4096,
    temperature: 0.85,
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
  const excerpt = `${fullText.slice(0, 6000)}\n...\n${fullText.slice(-6000)}`;
  const prompt = `Đọc Chương ${chapterNumber} dưới đây và trả về 1 JSON duy nhất:
{
  "summary": "Tóm tắt sự kiện chính trong 80-130 từ",
  "location": "Vị trí/Level mới nhất",
  "newDeadCharacters": [],
  "newLostItems": [],
  "openHooks": ["Danh sách tối đa 5 lời hứa/bí ẩn đang mở"],
  "characterStates": {
    "Kai Akechi": { "level": "", "injuries": "", "inventory": "" }
  },
  "tension_level": 5
}
Sổ cái cũ: ${JSON.stringify(l2)}
Nội dung chương:\n${excerpt}`;

  let data = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await window.RequestQueue.enqueue({
      lane: 'utility',
      systemPrompt: 'Trả về JSON thuần, ngắn gọn, chính xác.',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1500,
      temperature: 0.2,
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

  const nextLedger = {
    location: data.location || l2.location,
    deadCharacters: [...new Set([...(l2.deadCharacters || []), ...(data.newDeadCharacters || [])])],
    lostItems: [...new Set([...(l2.lostItems || []), ...(data.newLostItems || [])])],
    openHooks: Array.isArray(data.openHooks) ? data.openHooks : l2.openHooks,
    relationships: l2.relationships || {},
    characterStates: { ...(l2.characterStates || {}), ...(data.characterStates || {}) },
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
      outline = await generateOutline(chapterNumber, outlineL1, l2, l3, l4Hits, signal, '', creativity, userDirection, prefsDirective, trackUsage);
      await window.StoryDB.setSetting('chapter_draft', { number: chapterNumber, outline, sceneTexts });
    }

    if (onOutlineReady && outline?.title) {
      onOutlineReady(chapterNumber, outline.title);
    }

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
        onUsage: trackUsage
      });

      // Cảnh rỗng thì không lưu — lần chạy sau sẽ viết lại đúng cảnh đó
      if (sceneText && sceneText.trim()) {
        sceneTexts.push(sceneText);
        linterNotes = window.StoryMemory.lintScene(sceneText);
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
