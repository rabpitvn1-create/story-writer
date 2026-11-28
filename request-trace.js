// Nhật ký định tuyến: chỉ lưu metadata, tuyệt đối không lưu API key, prompt hay nội dung truyện.
const MAX_REQUEST_TRACE_EVENTS = 250;
let events = [];
let latestOutline = null;
let writeChain = Promise.resolve();
let sequence = 0;

function persist() {
  if (!window.StoryDB?.setSetting) return Promise.resolve();
  const snapshot = {
    events: events.slice(-MAX_REQUEST_TRACE_EVENTS),
    latestOutline
  };
  writeChain = writeChain
    .catch(() => {})
    .then(() => window.StoryDB.setSetting('requestTrace', snapshot))
    .catch((err) => console.warn('Không lưu được Request Trace:', err));
  return writeChain;
}

function renderStatus() {
  const el = document.getElementById('request-trace-status');
  if (!el) return;
  const last = events[events.length - 1];
  if (!events.length) {
    el.textContent = 'Chưa có request nào được ghi nhận.';
    return;
  }
  const state = last.status === 'success' ? 'thành công' : last.status === 'error' ? 'lỗi' : 'đang chạy';
  el.textContent = `Đã ghi ${events.length} request. Gần nhất: ${last.task} · ${last.provider.toUpperCase()} · ${state}.`;
}

async function init() {
  const saved = await window.StoryDB.getSetting('requestTrace', null);
  events = Array.isArray(saved?.events) ? saved.events.slice(-MAX_REQUEST_TRACE_EVENTS) : [];
  latestOutline = saved?.latestOutline || null;
  renderStatus();
}

function start(details) {
  const event = {
    id: `${Date.now()}-${++sequence}`,
    startedAt: new Date().toISOString(),
    task: details.task || details.lane || 'unknown',
    lane: details.lane || 'utility',
    chapterNumber: details.chapterNumber ?? null,
    sceneIndex: details.sceneIndex ?? null,
    modelMode: details.modelMode || 'unknown',
    provider: details.provider || 'unknown',
    sourceLabel: details.sourceLabel || '',
    isProxy: Boolean(details.isProxy),
    fallback: Boolean(details.fallback),
    modelSent: details.model || '',
    status: 'dispatched',
    responseModel: null,
    responseProvider: null,
    responseModelConfirmed: false,
    finishedAt: null,
    durationMs: null,
    usage: null,
    error: null
  };
  events.push(event);
  if (events.length > MAX_REQUEST_TRACE_EVENTS) events = events.slice(-MAX_REQUEST_TRACE_EVENTS);
  persist();
  renderStatus();
  return event.id;
}

function update(id, patch) {
  const event = events.find((item) => item.id === id);
  if (!event) return;
  Object.assign(event, patch);
  persist();
  renderStatus();
}

function finish(id, result = {}) {
  const event = events.find((item) => item.id === id);
  if (!event) return;
  const finishedAt = Date.now();
  update(id, {
    status: 'success',
    finishedAt: new Date(finishedAt).toISOString(),
    durationMs: Math.max(0, finishedAt - Date.parse(event.startedAt)),
    usage: result.usage || null
  });
}

function fail(id, error) {
  const event = events.find((item) => item.id === id);
  if (!event) return;
  const finishedAt = Date.now();
  update(id, {
    status: error?.name === 'AbortError' ? 'aborted' : 'error',
    finishedAt: new Date(finishedAt).toISOString(),
    durationMs: Math.max(0, finishedAt - Date.parse(event.startedAt)),
    error: {
      name: String(error?.name || 'Error'),
      message: String(error?.message || error || 'Unknown error').slice(0, 500),
      status: Number.isFinite(error?.status) ? error.status : null
    }
  });
}

function setResponseMeta(id, meta) {
  if (!meta) return;
  update(id, {
    responseModel: meta.model || null,
    responseProvider: meta.provider || null,
    responseModelConfirmed: Boolean(meta.model)
  });
}

function setLatestOutline(chapterNumber, outline) {
  if (!outline || typeof outline !== 'object') return;
  latestOutline = {
    chapterNumber,
    capturedAt: new Date().toISOString(),
    outline: structuredClone(outline)
  };
  persist();
}

async function copy() {
  await writeChain.catch(() => {});
  const payload = {
    exportedAt: new Date().toISOString(),
    note: 'Request Trace ghi nhận model/provider gửi trong request; responseModel chỉ được xác nhận khi endpoint trả metadata model. Không chứa API key, prompt hay toàn văn truyện.',
    requestCount: events.length,
    events,
    latestOutline
  };
  const text = JSON.stringify(payload, null, 2);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('Trình duyệt không cho phép sao chép nhật ký.');
  }
  const status = document.getElementById('request-trace-status');
  if (status) status.textContent = `Đã sao chép ${events.length} request và dàn ý gần nhất.`;
}

window.RequestTrace = {
  init,
  start,
  update,
  finish,
  fail,
  setResponseMeta,
  setLatestOutline,
  copy,
  renderStatus
};
