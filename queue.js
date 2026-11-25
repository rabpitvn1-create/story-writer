const MIN_GAP_MS = 5500; // Khoảng nghỉ 5.5 giây giữa các lần gọi
const BACKOFF_STEPS_SEC = [15, 30, 60, 120];

const lastCallByBucket = new Map();
const TRANSIENT_RETRY_SEC = [5, 10];
const PROXY_429_BACKOFF_SEC = [15, 30, 60];

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

async function executeWithPool({ lane, systemPrompt, messages, maxTokens, temperature, reasoningEffort, stream, onToken, onUsage, signal }) {
  const apiConfig = await window.StoryDB.getSetting('apiConfig', {});
  const freeOnly = Boolean(apiConfig.freeOnlyMode);

  // Kiểm tra ngân sách ngày
  const budget = await getBudgetState();
  if (budget.used >= budget.cap) {
    notifyStatus({ type: 'budget_reached', used: budget.used, cap: budget.cap });
    throw new Error(`Đã đạt giới hạn ngày (${budget.used}/${budget.cap} calls).`);
  }

  let transientRetries = 0;
  let proxy429Retries = 0;
  let rpmRetriedForKeyId = null;
  let backoffIndex = 0;

  while (true) {
    const keyObj = await window.KeyPoolManager.selectKey(lane, freeOnly);
    if (!keyObj) {
      const earliest = await window.KeyPoolManager.getEarliestReadyTime(lane, freeOnly);
      await window.StoryDB.setSetting('checkpoint', {
        lane,
        pausedAt: Date.now(),
        resumeAt: earliest
      });
      notifyStatus({ type: 'all_cooldown', resumeAt: earliest });
      throw new Error(
        earliest
          ? 'Tất cả API key đều đang nghỉ 24h. Đã lưu checkpoint.'
          : 'Chưa có API key phù hợp trong pool.'
      );
    }

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
    try {
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
        signal
      });
      lastCallByBucket.set(bucketKey, Date.now());
      await window.KeyPoolManager.recordKeySuccess(keyObj.id);
      await incrementBudget(callUsage);
      return result;
    } catch (err) {
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

        // 429: Proxy dùng chung (baseUrl) chỉ backoff ngắn 15s→30s→60s, KHÔNG khóa 24h
        if (keyObj.baseUrl) {
          if (proxy429Retries < PROXY_429_BACKOFF_SEC.length) {
            const waitSec = Math.max(PROXY_429_BACKOFF_SEC[proxy429Retries++], err.retryAfterSec || 0);
            notifyStatus({ type: 'waiting', reason: 'Máy chủ chung đang đông, tự thử lại', waitSec });
            await sleep(waitSec * 1000, signal);
            continue;
          }
          throw new Error('Máy chủ miễn phí đang quá tải tạm thời. Vui lòng thử lại sau ít phút.');
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

        await window.KeyPoolManager.markCooldown24h(keyObj.id);
        notifyStatus({ type: 'key_rotated', label: keyObj.label });
        continue;
      }

      // Proxy hết key ở server (401/403): khóa proxy này 24h rồi xoay sang proxy/key còn lại
      if (keyObj.baseUrl && (err.status === 401 || err.status === 403)) {
        await window.KeyPoolManager.markCooldown24h(keyObj.id);
        notifyStatus({ type: 'key_rotated', label: keyObj.label });
        continue;
      }

      throw err;
    }
  }
}

function enqueue(requestParams) {
  const run = queueChain.then(() => executeWithPool(requestParams));
  queueChain = run.catch(() => {});
  return run;
}

window.RequestQueue = {
  enqueue,
  getBudgetState,
  setStatusListener
};
