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

async function generateOutline(chapterNumber, l1, l2, l3, l4Hits, signal) {
  const l4Text = l4Hits.map((h) => `[Chương ${h.chapterNumber}]: ${h.snippet}`).join('\n');
  const prompt = `Lập dàn ý 3 cảnh lớn cho Chương ${chapterNumber} (mục tiêu tổng 5.000–6.000 từ tiếng Việt, mỗi cảnh ~1.800–2.000 từ) và tự kiểm tra không vi phạm L1/L2.
Trả về JSON thuần theo mẫu:
{
  "title": "Tên chương ngắn",
  "canonCheck": "Xác nhận không dùng vật phẩm đã mất / nhân vật đã chết",
  "scenes": [
    { "index": 1, "goal": "Mở đầu & khám phá", "beats": "Chi tiết hành động, không gian" },
    { "index": 2, "goal": "Biến cố & cao trào", "beats": "Chi tiết xung đột" },
    { "index": 3, "goal": "Dư âm & móc nối", "beats": "Chi tiết dư chấn, mở hook mới" }
  ]
}

TRẠNG THÁI L2: ${JSON.stringify(l2)}
TÓM TẮT L3: ${l3.arcsText}\n${l3.recentText}
TRA CỨU L4: ${l4Text || 'Không có'}`;

  // Free-tier hay trả JSON bị cắt: thử lại 1 lần rồi mới báo lỗi thân thiện
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await window.RequestQueue.enqueue({
      lane: 'utility',
      systemPrompt: `${l1}\n\nChỉ trả về JSON hợp lệ.`,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1800,
      temperature: 0.7,
      stream: false,
      signal
    });

    try {
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
      const outline = JSON.parse(cleaned);
      if (!outline || !Array.isArray(outline.scenes) || outline.scenes.length === 0) {
        throw new Error('Dàn ý thiếu danh sách cảnh.');
      }
      return outline;
    } catch {
      if (attempt === 1) throw new Error('Dàn ý trả về không phải JSON hợp lệ, bấm Viết chương tiếp để thử lại.');
    }
  }
}

async function writeSingleScene({ chapterNumber, scene, totalScenes, l1, l2, l3, rollingTail, linterNotes, signal, onProgress }) {
  const systemPrompt = `${l1}\n\n${window.StoryMemory.VOICE_HANDBOOK}\n\n${window.StoryMemory.VOICE_ANCHORS}`;
  const isLast = scene.index === totalScenes;

  const userPrompt = `Viết Cảnh ${scene.index}/${totalScenes} của Chương ${chapterNumber} (độ dài mục tiêu: 1.800–2.000 từ tiếng Việt).
Mục tiêu cảnh: ${scene.goal}
Chi tiết: ${scene.beats}
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
    onToken: (_, full) => {
      if (onProgress) onProgress(window.StoryMemory.countWords(full));
    },
    signal
  });

  // Cổng kiểm số từ: thiếu dưới 1.700 từ thì viết nối tiếp cho đủ ~1.850 từ (3 cảnh x 1.700 = 5.100)
  let words = window.StoryMemory.countWords(text);
  if (words < 1700) {
    const tail = text.split(/\s+/).slice(-450).join(' ');
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
      signal
    });
    text = `${text.trim()}\n\n${extra.trim()}`;
  }

  return trimToWordLimit(text, 2250);
}

async function digestChapter(chapterNumber, fullText, l2, signal) {
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
  }
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
      signal
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

  const nextLedger = {
    location: data.location || l2.location,
    deadCharacters: [...new Set([...(l2.deadCharacters || []), ...(data.newDeadCharacters || [])])],
    lostItems: [...new Set([...(l2.lostItems || []), ...(data.newLostItems || [])])],
    openHooks: Array.isArray(data.openHooks) ? data.openHooks : l2.openHooks,
    relationships: l2.relationships || {},
    characterStates: { ...(l2.characterStates || {}), ...(data.characterStates || {}) }
  };
  await window.StoryMemory.saveL2Ledger(nextLedger);
}

async function writeNextChapter({ onStatus, onChapterReady }) {
  if (isWriting) return;
  isWriting = true;
  gracefulStopRequested = false;
  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;

  try {
    const draft = await window.StoryDB.getSetting('chapter_draft', null);
    const lastCh = await window.StoryDB.db.chapters.orderBy('number').last();
    const chapterNumber = draft ? draft.number : (lastCh ? lastCh.number + 1 : 1);

    const l1 = await window.StoryMemory.getL1HardCanon();
    const l2 = await window.StoryMemory.getL2Ledger();
    const l3 = await window.StoryMemory.getL3Summaries();
    const l4Hits = await window.StoryMemory.searchL4Chapters((l2.openHooks || []).join(' '), 2);

    let outline = draft?.outline;
    let sceneTexts = draft?.sceneTexts || [];

    if (!outline) {
      onStatus(`Chương ${chapterNumber}: Đang lập dàn ý & tự kiểm canon...`);
      outline = await generateOutline(chapterNumber, l1, l2, l3, l4Hits, signal);
      await window.StoryDB.setSetting('chapter_draft', { number: chapterNumber, outline, sceneTexts });
    }

    let linterNotes = [];
    for (let i = sceneTexts.length; i < outline.scenes.length; i++) {
      const scene = outline.scenes[i];
      const prevText = sceneTexts[i - 1] || '';
      const rollingTail = prevText ? prevText.split(/\s+/).slice(-650).join(' ') : '';

      onStatus(`Chương ${chapterNumber}: Đang viết cảnh ${i + 1}/3...`);
      const sceneText = await writeSingleScene({
        chapterNumber,
        scene,
        totalScenes: outline.scenes.length,
        l1,
        l2,
        l3,
        rollingTail,
        linterNotes,
        signal,
        onProgress: (w) => onStatus(`Chương ${chapterNumber}: Cảnh ${i + 1}/3 (${w} từ)...`)
      });

      // Cảnh rỗng thì không lưu — lần chạy sau sẽ viết lại đúng cảnh đó
      if (sceneText.trim()) sceneTexts.push(sceneText);
      linterNotes = window.StoryMemory.lintScene(sceneText);
      // Checkpoint ngay sau mỗi cảnh
      await window.StoryDB.setSetting('chapter_draft', { number: chapterNumber, outline, sceneTexts });
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
      createdAt: Date.now()
    };

    await window.StoryDB.db.chapters.put(chapterRecord);
    onStatus(`Chương ${chapterNumber}: Đang tóm tắt & cập nhật bộ nhớ 4 tầng...`);
    await digestChapter(chapterNumber, fullText, l2, signal);
    await window.StoryDB.setSetting('chapter_draft', null);

    onStatus(`Hoàn thành Chương ${chapterNumber} (${chapterRecord.wordCount} từ).`);
    if (onChapterReady) onChapterReady(chapterRecord, gracefulStopRequested);
  } catch (err) {
    if (err.name === 'AbortError') {
      onStatus('Đã dừng khẩn cấp. Tiến độ các cảnh đã viết được giữ an toàn.');
    } else {
      onStatus(`Tạm dừng: ${err.message}`);
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
  writeNextChapter,
  hardStop,
  requestGracefulStop,
  isWriting: () => isWriting
};
