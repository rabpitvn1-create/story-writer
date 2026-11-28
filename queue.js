const MIN_GAP_MS = 5500; // Khoảng nghỉ 5.5 giây giữa các lần gọi
const BACKOFF_STEPS_SEC = [15, 30, 60, 120];

const lastCallByBucket = new Map();
const TRANSIENT_RETRY_SEC = [5, 10];
const PROXY_429_BACKOFF_SEC = [15, 30, 60];

// Nút "Đổi API" giữa chương: state in-memory theo chương + gộp AbortSignal
const MAX_SWITCHES_PER_CALL = 2;
let chapterDeprioritized = [];
let chapterSwitched = false;
let activeCall = null;

function combineSignals(primarySignal, secondarySignal) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    const list = [primarySignal, secondarySignal].filter(Boolean);
    return {
      signal: list.length > 1 ? AbortSignal.any(list) : list[0] || undefined,
      cleanup: () => {}
    };
  }
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  const list = [primarySignal, secondarySignal].filter(Boolean);
  for (const s of list) {
    if (s.aborted) {
      ctrl.abort();
      return { signal: ctrl.signal, cleanup: () => {} };
    }
    s.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    cleanup: () => {
      for (const s of list) s.removeEventListener('abort', onAbort);
    }
  };
}

// Tên ngắn để hiện trên nút (label pool có thể dài, VD "Gemini Proxy (miễn phí)")
function formatSourceLabel(keyObj) {
  if (!keyObj) return 'API';
  const label = String(keyObj.label || '').replace(/\s*\(.*\)\s*$/, '').trim();
  return label || keyObj.provider || 'API';
}

function resetChapterOverrides() {
  chapterDeprioritized = [];
  chapterSwitched = false;
}

function getActiveCallState() {
  if (!activeCall) {
    return {
      active: false,
      lane: null,
      sourceLabel: '',
      startedAt: 0,
      switchCount: 0,
      maxSwitches: MAX_SWITCHES_PER_CALL,
      hasFirstToken: false,
      isWaiting: false,
      canSwitch: false
    };
  }
  return {
    active: true,
    lane: activeCall.lane,
    sourceLabel: activeCall.sourceLabel,
    startedAt: activeCall.startedAt,
    switchCount: activeCall.switchCount,
    maxSwitches: MAX_SWITCHES_PER_CALL,
    hasFirstToken: activeCall.hasFirstToken,
    isWaiting: activeCall.isWaiting,
    canSwitch: activeCall.canSwitch
  };
}

function requestSwitch() {
  if (!activeCall) return false;
  if (activeCall.hasFirstToken) return false;
  if (activeCall.switchCount >= MAX_SWITCHES_PER_CALL) return false;
  if (!activeCall.canSwitch) return false;
  activeCall.switchedByUser = true;
  activeCall.attemptController.abort();
  return true;
}

function isTransientNetworkError(err) {
  if (!err || err.name === 'AbortError') return false;
  if (err.status === 502 || err.status === 504) return true;
  if (err instanceof TypeError) return true; // Failed to fetch / RemoteDisconnected
  return /failed to fetch|network|disconnected|timeout|502|504/i.test(String(err.message || ''));
}
let queueChain = Promise.resolve();
let statusListener = null;

function setStatusListener(fn) {
  statusListener = fn;
}

function notifyStatus(state) {
  if (state?.type === 'waiting' && activeCall) activeCall.isWaiting = true;
  if (statusListener) statusListener(state);
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}

function todayKey() {
  // Ngày theo giờ địa phương (máy người dùng), không phải UTC
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function getBudgetState() {
  const apiConfig = await window.StoryDB.getSetting('apiConfig', { dailyCap: 100 });
  const saved = await window.StoryDB.getSetting('dailyBudget', { date: todayKey(), used: 0 });
  const current = saved.date === todayKey() ? saved : { date: todayKey(), used: 0 };
  return { used: current.used, cap: Number(apiConfig.dailyCap) || 100, date: current.date, promptTokens: current.promptTokens || 0, completionTokens: current.completionTokens || 0, thinkingTokens: current.thinkingTokens || 0, totalTokens: current.totalTokens || 0 };
}

async function incrementBudget(usage = null) {
  const state = await getBudgetState();
  const next = {
    date: state.date,
    used: state.used + 1,
    promptTokens: (state.promptTokens || 0) + (usage?.promptTokens || 0),
    completionTokens: (state.completionTokens || 0) + (usage?.completionTokens || 0),
    thinkingTokens: (state.thinkingTokens || 0) + (usage?.thinkingTokens || 0),
    totalTokens: (state.totalTokens || 0) + (usage?.totalTokens || 0)
  };
  await window.StoryDB.setSetting('dailyBudget', next);
  notifyStatus({ type: 'budget', used: next.used, cap: state.cap, totalTokens: next.totalTokens });
  return next;
}

async function executeWithPool({ lane, apiConfig, modelMode, systemPrompt, messages, maxTokens, temperature, reasoningEffort, stream, onToken, onUsage, signal, selectOptions, onKeySelected, onBeforeFetch, traceTask, traceChapterNumber, traceSceneIndex }) {

  // Kiểm tra ngân sách ngày
  const budget = await getBudgetState();
  if (budget.used >= budget.cap) {
    notifyStatus({ type: 'budget_reached', used: budget.used, cap: budget.cap });
    throw new Error(`Đã đạt giới hạn ngày (${budget.used}/${budget.cap} calls).`);
  }

  let transientRetries = 0;
  const proxy429Retries = new Map();
  let rpmRetriedForKeyId = null;
  let backoffIndex = 0;

  while (true) {
    const keyObj = await window.KeyPoolManager.selectKey(lane, modelMode, selectOptions || {});
    if (!keyObj) {
      const earliest = await window.KeyPoolManager.getEarliestReadyTime(lane, modelMode);
      await window.StoryDB.setSetting('checkpoint', {
        lane,
        pausedAt: Date.now(),
        resumeAt: earliest
      });
      notifyStatus({ type: 'all_cooldown', resumeAt: earliest });
      throw new Error(
        earliest
          ? 'Nguồn AI phù hợp đang tạm nghỉ. Đã lưu tiến độ.'
          : 'Không có nguồn AI phù hợp với chế độ đang chọn.'
      );
    }
    if (onKeySelected) onKeySelected(keyObj);

    // Key proxy có sẵn mang theo model mặc định của proxy đó (VD: Premium Proxy dùng occ/claude-haiku-5-5)
    const model =
      keyObj.model ||
      (keyObj.provider === 'claude'
        ? apiConfig.claudeModel || 'claude-sonnet-5-5'
        : lane === 'writer'
          ? apiConfig.geminiWriterModel || 'gemini-3.6-flash'
          : apiConfig.geminiUtilityModel || 'gemini-3.5-flash-lite');

    const bucketKey = `${keyObj.provider}:${keyObj.id || 'proxy'}:${model}`;
    const lastAt = lastCallByBucket.get(bucketKey) || 0;
    const elapsed = Date.now() - lastAt;
    if (lastAt > 0 && elapsed < MIN_GAP_MS) {
      await sleep(MIN_GAP_MS - elapsed, signal);
    }

    let callUsage = null;
    let traceId = null;
    try {
      if (keyObj.baseUrl && keyObj.provider === 'claude' && !(modelMode === 'premium' && lane === 'writer')) {
        notifyStatus({ type: 'premium_fallback' });
      }
      traceId = window.RequestTrace?.start({
        task: traceTask || lane,
        lane,
        chapterNumber: traceChapterNumber,
        sceneIndex: traceSceneIndex,
        modelMode,
        provider: keyObj.provider,
        sourceLabel: keyObj.provider,
        isProxy: Boolean(keyObj.baseUrl),
        fallback: Boolean(keyObj.baseUrl && keyObj.provider === 'claude' && !(modelMode === 'premium' && lane === 'writer')),
        model
      }) || null;
      if (onBeforeFetch) onBeforeFetch(traceId);
      const result = await window.UnifiedAdapter.callLLM({
        provider: keyObj.provider,
        apiKey: keyObj.apiKey,
        baseUrl: keyObj.baseUrl,
        model,
        systemPrompt,
        messages,
        maxTokens,
        temperature,
        reasoningEffort,
        stream,
        onToken,
        onUsage: (u) => {
          if (!u) return;
          callUsage = u;
          if (onUsage) onUsage(u);
        },
        onResponseMeta: (meta) => {
          if (traceId) window.RequestTrace?.setResponseMeta(traceId, meta);
        },
        signal
      });
      if (traceId) window.RequestTrace?.finish(traceId, { usage: callUsage });
      lastCallByBucket.set(bucketKey, Date.now());
      await window.KeyPoolManager.recordKeySuccess(keyObj.id);
      await incrementBudget(callUsage);
      return result;
    } catch (err) {
      if (traceId) window.RequestTrace?.fail(traceId, err);
      if (err.name === 'AbortError') throw err;

      // Mạng chập chờn (rớt kết nối/502/504): thử lại tối đa 2 lần, nghỉ 5s rồi 10s
      if (isTransientNetworkError(err) && transientRetries < TRANSIENT_RETRY_SEC.length) {
        const waitSec = TRANSIENT_RETRY_SEC[transientRetries++];
        notifyStatus({ type: 'waiting', reason: 'Mạng chập chờn, đang thử lại', waitSec });
        await sleep(waitSec * 1000, signal);
        continue;
      }

      if (err instanceof window.UnifiedAdapter.RateLimitError) {
        // 503/529 quá tải máy chủ -> Exponential Backoff 15s -> 30s -> 60s -> 120s, tối đa 8 lần
        if (err.status === 503 || err.status === 529) {
          if (backoffIndex >= 8) throw new Error(`Máy chủ bận (${err.status}) sau 8 lần thử lại.`);
          const baseSec = BACKOFF_STEPS_SEC[Math.min(backoffIndex, BACKOFF_STEPS_SEC.length - 1)];
          const waitSec = Math.max(baseSec, err.retryAfterSec || 0);
          backoffIndex++;
          notifyStatus({ type: 'waiting', reason: `Máy chủ bận (${err.status})`, waitSec });
          await sleep(waitSec * 1000, signal);
          continue;
        }

        // 429: giữ backoff ngắn, nhưng Free liên tục bị giới hạn thì tạm chuyển Premium.
        if (keyObj.baseUrl) {
          const retries = proxy429Retries.get(keyObj.id) || 0;
          if (keyObj.provider === 'gemini' &&
              (retries >= PROXY_429_BACKOFF_SEC.length || err.retryAfterSec > 60)) {
            // shortcut: 429 không phân biệt chắc chắn quota ngày/RPM; nghỉ 5 phút hoặc Retry-After.
            await window.KeyPoolManager.markCooldown(keyObj.id, Math.max(300, err.retryAfterSec || 0) * 1000);
            notifyStatus({ type: 'key_rotated', label: keyObj.label });
            continue;
          }
          if (retries < PROXY_429_BACKOFF_SEC.length) {
            proxy429Retries.set(keyObj.id, retries + 1);
            const waitSec = Math.max(PROXY_429_BACKOFF_SEC[retries], err.retryAfterSec || 0);
            notifyStatus({ type: 'waiting', reason: `${keyObj.label} đang bận, tự thử lại`, waitSec });
            await sleep(waitSec * 1000, signal);
            continue;
          }
          throw new Error(`${keyObj.label} đang quá tải tạm thời. Vui lòng thử lại sau ít phút.`);
        }

        // 429: Phân biệt giới hạn phút (RPM) vs giới hạn ngày (RPD)
        // Thử nghỉ 15-20s đúng 1 lần cho cùng key; nếu vẫn 429 -> khóa 24h & đổi key
        if (rpmRetriedForKeyId !== keyObj.id) {
          rpmRetriedForKeyId = keyObj.id;
          const waitSec = Math.max(18, err.retryAfterSec || 0);
          notifyStatus({ type: 'waiting', reason: `Chạm giới hạn phút (${keyObj.label})`, waitSec });
          await sleep(waitSec * 1000, signal);
          continue;
        }

        await window.KeyPoolManager.markCooldown(keyObj.id);
        notifyStatus({ type: 'key_rotated', label: keyObj.label });
        continue;
      }

      // Proxy hết key ở server (401/403): khóa proxy này 24h rồi xoay sang proxy/key còn lại
      if (keyObj.baseUrl && (err.status === 401 || err.status === 403)) {
        await window.KeyPoolManager.markCooldown(keyObj.id);
        notifyStatus({ type: 'key_rotated', label: keyObj.label });
        continue;
      }

      throw err;
    }
  }
}

// Vòng lặp đổi API: mặc định 1 lượt y hệt cũ (dormant — codex cũng đi qua đây);
// chỉ lặp tiếp khi người dùng bấm "Đổi API" (switchedByUser)
async function enqueueWithSwitch(task) {
  const lane = task?.lane || 'writer';
  const chapterSignal = task?.signal || null;
  const apiConfig = await window.StoryDB.getSetting('apiConfig', {});
  const modelMode = window.KeyPoolManager.resolveModelMode(apiConfig);
  let switchCount = 0;

  while (true) {
    const attemptController = new AbortController();
    const { signal: mergedSignal, cleanup } = combineSignals(chapterSignal, attemptController.signal);
    const availableCount = await window.KeyPoolManager.countAvailableSources(lane, modelMode);
    let fetchDispatched = false;
    let currentKey = null;
    let currentSourceKey = null;

    activeCall = {
      lane,
      sourceLabel: 'API',
      sourceKey: null,
      startedAt: Date.now(),
      switchCount,
      hasFirstToken: false,
      isWaiting: false,
      canSwitch: modelMode === 'auto' && availableCount >= 2,
      attemptController,
      switchedByUser: false
    };
    notifyStatus({ type: 'call_started', lane, switchCount });

    const origOnToken = task?.onToken;
    const wrappedOnToken = (chunk, full) => {
      if (activeCall && !activeCall.hasFirstToken && (chunk || full)) {
        activeCall.hasFirstToken = true;
        activeCall.isWaiting = false;
        notifyStatus({ type: 'first_token', lane });
      }
      if (origOnToken) origOnToken(chunk, full);
    };

    try {
      const result = await executeWithPool({
        ...task,
        lane,
        apiConfig,
        modelMode,
        traceTask: task?.traceTask,
        traceChapterNumber: task?.traceChapterNumber,
        traceSceneIndex: task?.traceSceneIndex,
        signal: mergedSignal,
        onToken: origOnToken ? wrappedOnToken : undefined,
        selectOptions: {
          deprioritized: chapterDeprioritized,
          persistSticky: !chapterSwitched
        },
        onKeySelected: (keyObj) => {
          currentKey = keyObj;
          currentSourceKey = keyObj ? `${keyObj.provider}:${keyObj.id}` : null;
          if (activeCall) {
            activeCall.sourceKey = currentSourceKey;
            activeCall.sourceLabel = formatSourceLabel(keyObj);
          }
        },
        onBeforeFetch: () => {
          fetchDispatched = true;
          if (activeCall) activeCall.isWaiting = false;
        }
      });

      cleanup();
      activeCall = null;
      notifyStatus({ type: 'call_ended', lane });
      return result;
    } catch (err) {
      cleanup();
      const isChapterAbort = Boolean(chapterSignal?.aborted);
      const isUserSwitch = Boolean(!isChapterAbort && activeCall?.switchedByUser && attemptController.signal.aborted);

      if (isUserSwitch && switchCount < MAX_SWITCHES_PER_CALL) {
        // Lượt bị ngắt tính +1 call, 0 token — chỉ khi đã thực sự gửi fetch
        if (fetchDispatched && currentKey) {
          try {
            await incrementBudget(null);
          } catch {
            // Không để lỗi ghi budget chặn luồng đổi API
          }
        }
        chapterSwitched = true;
        if (currentSourceKey && !chapterDeprioritized.includes(currentSourceKey)) {
          chapterDeprioritized.push(currentSourceKey);
        }
        switchCount++;
        continue;
      }

      activeCall = null;
      notifyStatus({ type: 'call_ended', lane });
      throw err;
    }
  }
}

function enqueue(requestParams) {
  const run = queueChain.then(() => enqueueWithSwitch(requestParams));
  queueChain = run.catch(() => {});
  return run;
}

window.RequestQueue = {
  enqueue,
  getBudgetState,
  setStatusListener,
  getActiveCallState,
  requestSwitch,
  resetChapterOverrides
};
