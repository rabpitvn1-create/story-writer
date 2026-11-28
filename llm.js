// Cấu hình reasoning_effort tập trung (sửa 1 dòng là đổi được):
// Ghi chú audit: có thể A/B thử scene: 'medium' nếu cần tăng độ sâu văn chương.
const REASONING_EFFORT = {
  outline: 'low',
  scene: 'low',
  digest: 'minimal'
};

class RateLimitError extends Error {
  constructor(status, message, retryAfterSec = null) {
    super(message);
    this.name = 'RateLimitError';
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const promptTokens = Number(raw.prompt_tokens ?? raw.input_tokens ?? raw.promptTokenCount ?? 0) || 0;
  const completionTokens = Number(raw.completion_tokens ?? raw.output_tokens ?? raw.candidatesTokenCount ?? 0) || 0;
  const thinkingTokens = Number(
    raw.completion_tokens_details?.reasoning_tokens ?? raw.thoughtsTokenCount ?? raw.thinking_tokens ?? 0
  ) || 0;
  const totalTokens = Number(raw.total_tokens ?? raw.totalTokenCount ?? (promptTokens + completionTokens + thinkingTokens)) || 0;
  if (totalTokens === 0 && promptTokens === 0 && completionTokens === 0) return null;
  return { promptTokens, completionTokens, thinkingTokens, totalTokens };
}

function parseRetryAfter(headers) {
  const raw = headers.get('retry-after');
  if (!raw) return null;
  const sec = Number(raw);
  if (!Number.isNaN(sec)) return sec;
  const dateMs = Date.parse(raw);
  return Number.isNaN(dateMs) ? null : Math.max(0, Math.ceil((dateMs - Date.now()) / 1000));
}

async function readSSE(response, onLine) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) onLine(trimmed);
    }
  }
  if (buffer.trim()) onLine(buffer.trim());
}

async function callGeminiOpenAI({ apiKey, model, systemPrompt, messages, maxTokens = 4096, temperature = 0.85, stream = true, reasoningEffort, onToken, onUsage, onResponseMeta, signal }) {
  const fullMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  const payload = {
    model,
    messages: fullMessages,
    max_tokens: maxTokens,
    temperature,
    stream,
    // chỉ gửi stream_options khi stream thật — có endpoint 400 khi stream:false kèm nó
    ...(stream ? { stream_options: { include_usage: true } } : {})
  };
  if (reasoningEffort) payload.reasoning_effort = reasoningEffort;

  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 429 || res.status === 503) {
      throw new RateLimitError(res.status, errText || `HTTP ${res.status}`, parseRetryAfter(res.headers));
    }
    throw new Error(`Gemini API lỗi ${res.status}: ${errText}`);
  }

  if (!stream) {
    const data = await res.json();
    if (onResponseMeta) onResponseMeta({ provider: 'gemini', model: data.modelVersion || data.model || null });
    if (onUsage && data.usage) onUsage(normalizeUsage(data.usage));
    return data.choices?.[0]?.message?.content || '';
  }

  let fullText = '';
  await readSSE(res, (line) => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') return;
    try {
      const parsed = JSON.parse(payload);
      if ((parsed.modelVersion || parsed.model) && onResponseMeta) onResponseMeta({ provider: 'gemini', model: parsed.modelVersion || parsed.model });
      if (onUsage && parsed.usage) onUsage(normalizeUsage(parsed.usage));
      const chunk = parsed.choices?.[0]?.delta?.content || '';
      if (chunk) {
        fullText += chunk;
        if (onToken) onToken(chunk, fullText);
      }
    } catch {
      // Bỏ qua chunk chưa hoàn chỉnh
    }
  });
  return fullText;
}

async function callClaude({ apiKey, model, systemPrompt, messages, maxTokens = 4096, temperature = 0.85, stream = true, onToken, onUsage, onResponseMeta, signal }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model,
      system: systemPrompt || undefined,
      messages,
      max_tokens: maxTokens,
      stream
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 429 || res.status === 503 || res.status === 529) {
      throw new RateLimitError(res.status, errText || `HTTP ${res.status}`, parseRetryAfter(res.headers));
    }
    throw new Error(`Claude API lỗi ${res.status}: ${errText}`);
  }

  if (!stream) {
    const data = await res.json();
    if (onResponseMeta) onResponseMeta({ provider: 'claude', model: data.model || null });
    if (onUsage && data.usage) onUsage(normalizeUsage(data.usage));
    return data.content?.[0]?.text || '';
  }

  let fullText = '';
  let claudeIn = 0;
  await readSSE(res, (line) => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    try {
      const parsed = JSON.parse(payload);
      if (parsed.type === 'message_start' && parsed.message) {
        if (onResponseMeta) onResponseMeta({ provider: 'claude', model: parsed.message.model || null });
        if (parsed.message.usage) claudeIn = parsed.message.usage.input_tokens || 0;
      }
      if (parsed.type === 'message_delta' && parsed.usage && onUsage) {
        onUsage(normalizeUsage({ input_tokens: claudeIn, output_tokens: parsed.usage.output_tokens || 0 }));
      }
      if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
        const chunk = parsed.delta.text || '';
        if (chunk) {
          fullText += chunk;
          if (onToken) onToken(chunk, fullText);
        }
      }
    } catch {
      // Bỏ qua sự kiện không phải JSON delta
    }
  });
  return fullText;
}

// Gọi qua proxy có sẵn của anh (Render): proxy giữ key ở server nên app không cần key.
// Proxy không hỗ trợ streaming — luôn gọi không-stream và đọc full JSON trả về.
async function callProxy({ baseUrl, provider, model, systemPrompt, messages, maxTokens = 4096, temperature = 0.85, reasoningEffort, signal, onToken, onUsage, onResponseMeta }) {
  const fullMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  const body = {
    model,
    messages: fullMessages,
    max_tokens: maxTokens,
    temperature
  };
  // shortcut: chỉ gửi reasoning_effort sang proxy Gemini (đã xác minh forward server.js:37-38); phản ứng của proxy Haiku chưa kiểm chứng nên không gửi.
  if (reasoningEffort && provider === 'gemini') body.reasoning_effort = reasoningEffort;

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 429 || res.status === 503) {
      throw new RateLimitError(res.status, errText || `HTTP ${res.status}`, parseRetryAfter(res.headers));
    }
    const proxyErr = new Error(`Proxy lỗi ${res.status}: ${errText}`);
    proxyErr.status = res.status;
    throw proxyErr;
  }

  const data = await res.json();
  if (onResponseMeta) onResponseMeta({ provider: data.provider || null, model: data.model || null });
  if (onUsage && data.usage) onUsage(normalizeUsage(data.usage));
  const content = data.choices?.[0]?.message?.content || '';
  // Proxy không stream: trả cả cục một lần, nhưng vẫn bắn onToken 1 lần để
  // luồng đọc dần (typewriter) chạy được như với key trực tiếp.
  if (onToken) onToken(content, content);
  return content;
}

async function callLLM(params) {
  if (params.baseUrl) return callProxy(params);
  if (params.provider === 'claude') return callClaude(params);
  return callGeminiOpenAI(params);
}

window.UnifiedAdapter = {
  RateLimitError,
  callLLM,
  REASONING_EFFORT
};
