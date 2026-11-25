const MAX_CONSECUTIVE_CHAPTERS = 10;

let endlessRunning = false;
let endlessStopRequested = false;
let wakeLockSentinel = null;

async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLockSentinel) {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
    }
  } catch {
    // Trình duyệt không hỗ trợ hoặc từ chối Wake Lock -> bỏ qua an toàn
  }
}

async function releaseWakeLock() {
  try {
    if (wakeLockSentinel) {
      await wakeLockSentinel.release();
      wakeLockSentinel = null;
    }
  } catch {
    wakeLockSentinel = null;
  }
}

// Chọn nhánh cốt truyện theo trọng số: 20% safe / 50% twist / 30% psychological-mystery
function pickWeightedBranch() {
  const r = Math.random() * 100;
  if (r < 20) return 'safe';
  if (r < 70) return 'twist';
  return 'psychological-mystery';
}

function formatBranchLabel(branch) {
  if (branch === 'safe') return 'An toàn (Logic)';
  if (branch === 'twist') return 'Đột biến (Twist)';
  return 'Tâm lý & Bí ẩn';
}

// Tính nhịp căng thẳng mục tiêu (sau 2 chương 8-9 thì ép về 3-4)
function computeTargetTension(l2) {
  const hist = Array.isArray(l2.tensionHistory) ? l2.tensionHistory : [];
  if (hist.length >= 2 && hist[hist.length - 1] >= 8 && hist[hist.length - 2] >= 8) {
    return { target: 4, note: 'Hai chương trước đã rất căng (8-9/10). Chương này BẮT BUỘC phải là chương lắng (3-4/10): tập trung nội tâm, quan sát, giải mã manh mối.' };
  }
  return { target: null, note: '' };
}

async function getCreativityConstraints(l2) {
  const recentMotifs = (await window.StoryDB.getSetting('recent_motifs', []))
    .filter((m) => m && typeof m.conflict === 'string' && typeof m.environment === 'string')
    .slice(-4);
  const branch = pickWeightedBranch();
  const tension = computeTargetTension(l2);

  return {
    branch,
    branchLabel: formatBranchLabel(branch),
    recentMotifs,
    tensionNote: tension.note
  };
}

async function recordChapterMotif(motif) {
  // Chỉ lưu motif đúng dạng {conflict, environment} — model hay trả chuỗi trơn làm hỏng cooldown
  if (!motif || typeof motif.conflict !== 'string' || typeof motif.environment !== 'string') return;
  const recent = await window.StoryDB.getSetting('recent_motifs', []);
  recent.push(motif);
  await window.StoryDB.setSetting('recent_motifs', recent.slice(-4));
}

// Kiểm tra liên tục trước khi viết (Pre-write Continuity Audit)
// Chỉ quét các trường có nghĩa (tiêu đề + mục tiêu/chi tiết từng cảnh) và khớp đúng tên đầy đủ —
// "Kai" đã chết không được báo nhầm khi dàn ý nhắc "Kai Akechi" còn sống.
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function auditOutlineContinuity(outline, l2) {
  const fields = [
    outline?.title || '',
    ...(Array.isArray(outline?.scenes) ? outline.scenes.flatMap((s) => [s.goal || '', s.beats || '']) : [])
  ].join(' ');
  const violations = [];

  const mentions = (name) => {
    const n = String(name || '').trim();
    if (!n || n.length < 3) return false;
    // Khớp đúng tên đầy đủ: không nằm trong từ dài hơn. Nếu sau tên là khoảng trắng + chữ HOA
    // thì đây là phần đầu của tên dài hơn ("Kai" trong "Kai Akechi" không tính) -> thử lần khớp sau.
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(n)}(?![\\p{L}\\p{N}_])`, 'giu');
    let m;
    while ((m = re.exec(fields)) !== null) {
      const after = fields.slice(m.index + m[0].length);
      if (/^\s+\p{Lu}/u.test(after)) continue;
      return true;
    }
    return false;
  };

  for (const dead of l2.deadCharacters || []) {
    if (mentions(dead)) {
      violations.push(`Nhân vật đã chết "${dead}" vẫn xuất hiện trong dàn ý.`);
    }
  }
  for (const lost of l2.lostItems || []) {
    if (mentions(lost)) {
      violations.push(`Vật phẩm đã mất "${lost}" vẫn bị dùng trong dàn ý.`);
    }
  }
  return violations;
}

// Vòng lặp Chế độ Vô tận (tối đa 10 chương liên tiếp)
async function startEndlessMode({ onStatus, onChapterReady, onFinished, onChapterStart, onOutlineReady, onSceneStream, onSceneDone, onAborted, onError }) {
  if (endlessRunning) return;
  endlessRunning = true;
  endlessStopRequested = false;
  await acquireWakeLock();

  let count = 0;
  try {
    while (endlessRunning && !endlessStopRequested && count < MAX_CONSECUTIVE_CHAPTERS) {
      let chapterCompleted = false;
      let gracefulFromEngine = false;

      await window.ChapterEngine.writeNextChapter({
        onStatus: (msg) => onStatus(`[Vô tận ${count + 1}/${MAX_CONSECUTIVE_CHAPTERS}] ${msg}`),
        onChapterStart,
        onOutlineReady,
        onSceneStream,
        onSceneDone,
        onAborted,
        onError,
        onChapterReady: async (ch, graceful) => {
          chapterCompleted = true;
          gracefulFromEngine = graceful;
          if (onChapterReady) await onChapterReady(ch);
        }
      });

      if (!chapterCompleted || gracefulFromEngine || endlessStopRequested) break;
      count++;

      if (count >= MAX_CONSECUTIVE_CHAPTERS) {
        onStatus(`Đã đạt giới hạn an toàn ${MAX_CONSECUTIVE_CHAPTERS} chương liên tiếp. Bấm "Viết liên tục" nếu muốn chạy tiếp.`);
        break;
      }

      onStatus(`Hoàn tất chương (${count}/${MAX_CONSECUTIVE_CHAPTERS}). Chuẩn bị chương tiếp sau 3 giây...`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  } finally {
    endlessRunning = false;
    endlessStopRequested = false;
    await releaseWakeLock();
    if (onFinished) onFinished();
  }
}

function stopEndlessGraceful() {
  endlessStopRequested = true;
  window.ChapterEngine.requestGracefulStop();
}

function stopEndlessHard() {
  endlessStopRequested = true;
  endlessRunning = false;
  window.ChapterEngine.hardStop();
}

// Xuất file (.md và .docx)
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function chapterToMarkdown(ch) {
  return `# CHAPTER ${ch.number}${ch.title ? `: ${ch.title}` : ''}\n\n${ch.text || ''}\n`;
}

async function exportCurrentChapterMd(chapterNumber) {
  const ch = await window.StoryDB.db.chapters.get(chapterNumber);
  if (!ch) return alert('Chưa có chương nào được lưu để xuất.');
  const md = chapterToMarkdown(ch);
  downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `chuong-${ch.number}.md`);
}

async function exportAllStory() {
  const chapters = await window.StoryDB.db.chapters.orderBy('number').toArray();
  if (chapters.length === 0) return alert('Chưa có chương nào được lưu để xuất.');

  const fullMd = chapters.map(chapterToMarkdown).join('\n\n');
  downloadBlob(new Blob([fullMd], { type: 'text/markdown;charset=utf-8' }), 'truyen-full.md');

  if (!window.docx) {
    alert('Đã xuất file .md. Thư viện tạo .docx chưa tải được từ CDN nên tạm bỏ qua file .docx.');
    return;
  }

  try {
    const { Document, Packer, Paragraph, HeadingLevel } = window.docx;
    const children = [];
    for (const ch of chapters) {
      children.push(
        new Paragraph({
          text: `CHAPTER ${ch.number}${ch.title ? `: ${ch.title}` : ''}`,
          heading: HeadingLevel.HEADING_1
        })
      );
      for (const para of String(ch.text || '').split(/\n+/)) {
        if (para.trim()) children.push(new Paragraph({ text: para.trim() }));
      }
    }
    const doc = new Document({ sections: [{ children }] });
    const blob = await Packer.toBlob(doc);
    downloadBlob(blob, 'truyen-full.docx');
  } catch {
    alert('Đã xuất file .md, nhưng có lỗi khi đóng gói file .docx.');
  }
}

window.EndlessManager = {
  getCreativityConstraints,
  recordChapterMotif,
  auditOutlineContinuity,
  startEndlessMode,
  stopEndlessGraceful,
  stopEndlessHard,
  isRunning: () => endlessRunning,
  exportCurrentChapterMd,
  exportAllStory
};
