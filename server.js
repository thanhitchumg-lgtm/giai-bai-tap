// Server giải bài tập bằng Gemini API (Google). Không cần cài thêm thư viện nào.
// Yêu cầu: Node.js 18 trở lên.

const http = require('http');
const fs = require('fs');
const path = require('path');

// ---- Đọc file .env (nếu có) ----
function loadEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    const val = m[2].replace(/^['"]|['"]$/g, '');
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
}
loadEnv();
const env = process.env;

const PORT = Number(env.PORT) || 3000;
const API_KEY = env.GEMINI_API_KEY || '';
const BASE_URL = (env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
const RATE_LIMIT_PER_MIN = Number(env.RATE_LIMIT_PER_MIN) || 15;
const ATTEMPT_TIMEOUT_MS = (Number(env.TIMEOUT_SECONDS) || 60) * 1000; // chờ tối đa cho mỗi lần gọi Google
const TOTAL_BUDGET_MS = ATTEMPT_TIMEOUT_MS * 2 + 5000; // tổng thời gian tối đa cho một lần giải
const MAX_BODY = 12 * 1024 * 1024; // 12MB

// ---- 3 chế độ giải ----
// thinking: mức "suy nghĩ" của model. Thấp = nhanh hơn. Đặt "default" để dùng mặc định của Google.
// Lưu ý: gemini-3.8-flash KHÔNG nhận mức "minimal" (chỉ low/medium/high).
const MODES = {
  fast: {
    label: 'Nhanh',
    desc: 'Nhanh nhất, hợp với bài đơn giản.',
    model: env.MODEL_FAST || 'gemini-3.1-flash-lite',
    thinking: env.THINKING_FAST || 'minimal',
  },
  balanced: {
    label: 'Cân bằng',
    desc: 'Cân bằng giữa tốc độ và độ chính xác.',
    model: env.MODEL_BALANCED || 'gemini-3.7-flash',
    thinking: env.THINKING_BALANCED || 'low',
  },
  accurate: {
    label: 'Chính xác',
    desc: 'Chính xác nhất cho bài khó, nhưng chậm hơn.',
    model: env.MODEL_ACCURATE || 'gemini-3.8-flash',
    thinking: env.THINKING_ACCURATE || 'medium',
  },
};
const MODE_IDS = Object.keys(MODES);
const DEFAULT_MODE = MODES[env.DEFAULT_MODE] ? env.DEFAULT_MODE : 'fast';
// Thứ tự thử khi một model bị lỗi / quá tải
const FALLBACK_ORDER = {
  fast: ['fast', 'balanced', 'accurate'],
  balanced: ['balanced', 'fast', 'accurate'],
  accurate: ['accurate', 'balanced', 'fast'],
};

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Giới hạn số lượt gọi theo IP ----
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60000);
  list.push(now);
  hits.set(ip, list);
  return list.length > RATE_LIMIT_PER_MIN;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of hits) {
    if (!list.some((t) => now - t < 60000)) hits.delete(ip);
  }
}, 60000).unref();

// ---- Tự nhận diện các model mà API key này dùng được (ListModels) ----
let modelCache = { at: 0, set: null };
async function getAvailableModels() {
  if (!API_KEY) return null;
  if (modelCache.set && Date.now() - modelCache.at < 10 * 60 * 1000) return modelCache.set;
  try {
    const set = new Set();
    let token = '';
    for (let i = 0; i < 5; i++) {
      const url = `${BASE_URL}/models?pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`;
      const res = await fetch(url, { headers: { 'x-goog-api-key': API_KEY }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`ListModels ${res.status}`);
      const data = await res.json();
      for (const m of data.models || []) {
        const methods = m.supportedGenerationMethods || [];
        if (methods.includes('generateContent')) set.add(String(m.name).replace(/^models\//, ''));
      }
      token = data.nextPageToken;
      if (!token) break;
    }
    modelCache = { at: Date.now(), set };
    return set;
  } catch (e) {
    console.error('Không lấy được danh sách model:', e.message);
    return null; // không biết -> coi như tất cả đều có thể dùng
  }
}

// ---- Tạo lời nhắc cho Gemini ----
const SUBJECTS = [
  'Tự động nhận diện', 'Toán', 'Vật lý', 'Hóa học', 'Sinh học', 'Tiếng Anh',
  'Ngữ văn', 'Lịch sử', 'Địa lý', 'GDCD', 'Tin học', 'Môn khác',
];
const LEVELS = [
  'Tự động nhận diện', 'Tiểu học (lớp 1-5)', 'THCS (lớp 6-9)',
  'THPT (lớp 10-12)', 'Đại học',
];

function buildSystemPrompt(subject, level) {
  return [
    'Bạn là một giáo viên giỏi, kiên nhẫn, giải bài tập cho học sinh Việt Nam.',
    `Môn học: ${subject}. Cấp học: ${level}.`,
    'Nếu môn hoặc cấp là "Tự động nhận diện" thì tự xác định từ nội dung ảnh.',
    'Quy tắc trả lời:',
    '- Đọc kỹ đề bài trong ảnh. Nếu ảnh có nhiều câu, giải lần lượt từng câu; nếu ảnh mờ hoặc thiếu dữ kiện, nói rõ phần nào không đọc được thay vì đoán bừa.',
    '- Trình bày bằng tiếng Việt, đúng trình độ và cách giải của cấp học đã chọn (ví dụ tiểu học không dùng phương trình nếu chương trình chưa học).',
    '- Mở đầu bằng một dòng chép lại ngắn gọn đề bài bạn đọc được để người dùng kiểm tra.',
    '- Giải từng bước, có giải thích ngắn gọn, rồi ghi **Đáp án** in đậm ở cuối mỗi câu.',
    '- Công thức toán, lý, hóa viết bằng LaTeX: dùng $...$ cho công thức trong dòng và $$...$$ cho công thức riêng một dòng.',
    '- Môn Tiếng Anh: giải thích bằng tiếng Việt, đáp án và ví dụ giữ bằng tiếng Anh.',
    '- Môn Ngữ văn, Lịch sử, Địa lý, GDCD: trả lời đúng trọng tâm câu hỏi, có ý rõ ràng, ngắn gọn.',
    '- Trình bày bằng Markdown, không dùng bảng quá phức tạp.',
  ].join('\n');
}

// ---- Một lần gọi Gemini tới một model cụ thể ----
async function callGemini({ model, thinking, system, userText, mimeType, base64 }) {
  const url = `${BASE_URL}/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [
      {
        role: 'user',
        parts: [{ text: userText }, { inline_data: { mime_type: mimeType, data: base64 } }],
      },
    ],
  };
  if (thinking && thinking !== 'default') {
    body.generationConfig = { thinkingConfig: { thinkingLevel: thinking } };
  }

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw Object.assign(new Error(timedOut ? 'timeout' : 'network'), { code: timedOut ? 'timeout' : 'network' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.error && data.error.message) || `Lỗi từ Google (${res.status})`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  if (data.promptFeedback && data.promptFeedback.blockReason) {
    throw Object.assign(new Error('Google từ chối xử lý ảnh này. Hãy thử ảnh khác.'), { status: 422, fatal: true });
  }
  const parts =
    (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  // bỏ phần "suy nghĩ" nếu model có trả về
  const text = parts.filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
  if (!text) throw Object.assign(new Error('Không nhận được lời giải. Hãy thử chụp lại rõ hơn.'), { status: 502 });
  return text;
}

// Lỗi nào thì nên chuyển sang model khác?
function shouldFallback(e) {
  if (e.fatal) return false;
  if (e.code === 'timeout') return true;
  if ([404, 429, 500, 502, 503, 504].includes(e.status)) return true;
  return /no longer available|not found|not supported|is not available/i.test(e.message || '');
}

// ---- Giải bài: thử model của chế độ đã chọn, lỗi thì thử model khác ----
async function solve({ modeId, subject, level, note, mimeType, base64 }) {
  const system = buildSystemPrompt(subject, level);
  const userText = 'Hãy giải bài tập trong ảnh này.' + (note ? `\nGhi chú thêm của người dùng: ${note}` : '');
  const avail = await getAvailableModels();

  let order = FALLBACK_ORDER[modeId].filter((id) => !avail || avail.has(MODES[id].model));
  if (order.length === 0) order = FALLBACK_ORDER[modeId]; // không chắc thì cứ thử hết
  const startedAt = Date.now();
  let lastErr = null;

  for (const id of order) {
    const { model, thinking } = MODES[id];
    let thinkingNow = thinking;
    let triedNoThinking = false;
    let attempts = 0;
    while (attempts < 3) {
      if (Date.now() - startedAt > TOTAL_BUDGET_MS) {
        throw lastErr || Object.assign(new Error('timeout'), { code: 'timeout' });
      }
      attempts++;
      try {
        const answer = await callGemini({ model, thinking: thinkingNow, system, userText, mimeType, base64 });
        console.log(`Giải xong bằng ${model} (chế độ ${MODES[id].label}) sau ${Date.now() - startedAt}ms`);
        return { answer, usedMode: id, model, fellBack: id !== modeId };
      } catch (e) {
        lastErr = e;
        console.error(`Lỗi ${model}:`, e.status || e.code || '', e.message);
        // Mức suy nghĩ không được model này chấp nhận -> thử lại không đặt mức
        if (e.status === 400 && /thinking/i.test(e.message) && thinkingNow && !triedNoThinking) {
          triedNoThinking = true;
          thinkingNow = 'default';
          attempts--;
          continue;
        }
        // Quá tải tạm thời -> đợi một chút rồi thử lại cùng model
        if (e.status === 503 && attempts < 2) {
          await sleep(1500);
          continue;
        }
        if (!shouldFallback(e)) throw e;
        break; // sang model kế tiếp
      }
    }
  }
  throw lastErr || new Error('Không giải được bài này.');
}

function friendlyError(e) {
  if (e.code === 'timeout') return 'Google trả lời quá lâu. Hãy thử lại, hoặc chọn chế độ "Nhanh".';
  if (e.code === 'network' || (!e.status && !e.code)) return 'Server không kết nối được tới Google. Hãy kiểm tra mạng internet rồi thử lại.';
  if (e.status === 429) return 'Đã hết lượt gọi Google trong thời gian này. Hãy thử lại sau ít phút.';
  if (e.status === 503) return 'Google đang quá tải. Hãy thử lại sau vài giây.';
  if ((e.status === 400 || e.status === 403) && /API key/i.test(e.message)) return 'API key không hợp lệ. Hãy kiểm tra lại file .env.';
  return e.message;
}

// ---- Tiện ích HTTP ----
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Ảnh quá lớn.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleModes(req, res) {
  const avail = await getAvailableModels();
  const modes = MODE_IDS.map((id) => ({
    id,
    label: MODES[id].label,
    desc: MODES[id].desc,
    available: avail ? avail.has(MODES[id].model) : true,
  }));
  let def = DEFAULT_MODE;
  if (!modes.find((m) => m.id === def && m.available)) {
    const first = modes.find((m) => m.available);
    if (first) def = first.id;
  }
  sendJson(res, 200, { modes, default: def, detected: !!avail });
}

async function handleSolve(req, res) {
  if (!API_KEY) {
    return sendJson(res, 500, { error: 'Server chưa có GEMINI_API_KEY. Hãy tạo file .env theo hướng dẫn trong README.' });
  }
  const ip = req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip)) {
    return sendJson(res, 429, { error: 'Bạn gửi quá nhanh, vui lòng đợi một chút rồi thử lại.' });
  }
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (e) {
    return sendJson(res, e.status || 400, { error: e.status === 413 ? e.message : 'Dữ liệu gửi lên không hợp lệ.' });
  }
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(payload.image || '');
  if (!m) return sendJson(res, 400, { error: 'Ảnh không hợp lệ (chỉ nhận JPEG, PNG, WebP).' });

  const subject = SUBJECTS.includes(payload.subject) ? payload.subject : SUBJECTS[0];
  const level = LEVELS.includes(payload.level) ? payload.level : LEVELS[0];
  const modeId = MODES[payload.mode] ? payload.mode : DEFAULT_MODE;
  const note = String(payload.note || '').slice(0, 500);

  try {
    const r = await solve({ modeId, subject, level, note, mimeType: m[1], base64: m[2] });
    const out = { answer: r.answer, mode: r.usedMode };
    if (r.fellBack) {
      out.note = `Chế độ "${MODES[modeId].label}" đang không dùng được nên website đã tự chuyển sang chế độ "${MODES[r.usedMode].label}".`;
    }
    sendJson(res, 200, out);
  } catch (e) {
    sendJson(res, 502, { error: friendlyError(e) });
  }
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Không tìm thấy trang.');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const pathname = req.url.split('?')[0];
  if (req.method === 'POST' && pathname === '/api/solve') return handleSolve(req, res);
  if (req.method === 'GET' && pathname === '/api/modes') return handleModes(req, res);
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
  res.writeHead(405);
  res.end();
});

server.listen(PORT, async () => {
  console.log(`Website giải bài tập đang chạy: http://localhost:${PORT}`);
  console.log(`API key: ${API_KEY ? 'đã có' : 'CHƯA CÓ (xem README)'}`);
  const avail = await getAvailableModels();
  for (const id of MODE_IDS) {
    const m = MODES[id];
    const status = avail ? (avail.has(m.model) ? 'dùng được' : 'KHÔNG thấy trong danh sách của Google') : 'chưa kiểm tra được';
    console.log(`  Chế độ ${m.label}: ${m.model} (suy nghĩ: ${m.thinking}) - ${status}`);
  }
});
