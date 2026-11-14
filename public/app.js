(() => {
  const $ = (id) => document.getElementById(id);

  const els = {
    subject: $('subject'), level: $('level'), mode: $('mode'), modeHint: $('modeHint'), info: $('info'),
    btnCamera: $('btnCamera'), btnUpload: $('btnUpload'),
    fileCamera: $('fileCamera'), fileUpload: $('fileUpload'),
    pickCard: $('pickCard'), cropCard: $('cropCard'), resultCard: $('resultCard'),
    view: $('view'), crop: $('crop'), stage: $('stage'),
    btnRotateL: $('btnRotateL'), btnRotateR: $('btnRotateR'),
    btnFull: $('btnFull'), btnRetake: $('btnRetake'),
    note: $('note'), btnSolve: $('btnSolve'),
    sentImg: $('sentImg'), loading: $('loading'), error: $('error'),
    answer: $('answer'), warn: $('warn'),
  };

  let src = null; // canvas chứa ảnh gốc (đã xoay nếu có)
  let crop = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 }; // khung cắt, tính theo tỉ lệ 0..1

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // ---------- Chế độ giải (server tự báo model nào dùng được) ----------
  const MODE_DESC = {
    fast: 'Nhanh nhất, hợp với bài đơn giản.',
    balanced: 'Cân bằng giữa tốc độ và độ chính xác.',
    accurate: 'Chính xác nhất cho bài khó, nhưng chậm hơn.',
  };
  const serverDesc = {};
  function updateModeHint() {
    els.modeHint.textContent = serverDesc[els.mode.value] || MODE_DESC[els.mode.value] || '';
  }
  els.mode.addEventListener('change', updateModeHint);

  async function loadModes() {
    try {
      const res = await fetch('/api/modes');
      const data = await res.json();
      els.mode.innerHTML = '';
      data.modes.forEach((m) => {
        const o = document.createElement('option');
        o.value = m.id;
        o.textContent = m.label + (m.available ? '' : ' (không khả dụng)');
        o.disabled = !m.available;
        serverDesc[m.id] = m.desc;
        els.mode.appendChild(o);
      });
      els.mode.value = data.default;
    } catch (e) {
      els.mode.value = 'fast';
    }
    updateModeHint();
  }
  loadModes();

  // ---------- Nạp ảnh ----------
  els.btnCamera.onclick = () => els.fileCamera.click();
  els.btnUpload.onclick = () => els.fileUpload.click();
  els.fileCamera.onchange = () => loadFile(els.fileCamera.files[0]);
  els.fileUpload.onchange = () => loadFile(els.fileUpload.files[0]);

  function loadFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { alert('Vui lòng chọn một file ảnh.'); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const MAX = 2400;
      const s = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      src = document.createElement('canvas');
      src.width = Math.max(1, Math.round(img.naturalWidth * s));
      src.height = Math.max(1, Math.round(img.naturalHeight * s));
      const ctx = src.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, src.width, src.height);
      ctx.drawImage(img, 0, 0, src.width, src.height);
      URL.revokeObjectURL(url);
      crop = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
      els.cropCard.hidden = false;
      els.resultCard.hidden = true;
      render();
      els.cropCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    img.onerror = () => { URL.revokeObjectURL(url); alert('Không đọc được ảnh này. Hãy thử ảnh khác.'); };
    img.src = url;
    els.fileCamera.value = '';
    els.fileUpload.value = '';
  }

  // ---------- Vẽ ảnh + khung cắt ----------
  function render() {
    if (!src) return;
    const avail = Math.max(120, els.stage.parentElement.clientWidth - 32);
    const maxH = Math.max(240, window.innerHeight * 0.7);
    const scale = Math.min(avail / src.width, maxH / src.height, 1);
    const w = Math.round(src.width * scale);
    const h = Math.round(src.height * scale);
    els.view.width = w;
    els.view.height = h;
    els.view.style.width = w + 'px';
    els.view.style.height = h + 'px';
    els.view.getContext('2d').drawImage(src, 0, 0, w, h);
    placeCrop();
  }

  function placeCrop() {
    const W = els.view.clientWidth, H = els.view.clientHeight;
    const s = els.crop.style;
    s.left = crop.x * W + 'px';
    s.top = crop.y * H + 'px';
    s.width = crop.w * W + 'px';
    s.height = crop.h * H + 'px';
  }

  window.addEventListener('resize', () => { if (!els.cropCard.hidden) render(); });

  // ---------- Kéo khung / đổi kích thước ----------
  let drag = null;
  els.crop.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    els.crop.setPointerCapture(e.pointerId);
    drag = { mode: e.target.dataset.h || 'move', sx: e.clientX, sy: e.clientY, start: { ...crop } };
  });
  els.crop.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const W = els.view.clientWidth, H = els.view.clientHeight;
    const dx = (e.clientX - drag.sx) / W;
    const dy = (e.clientY - drag.sy) / H;
    const minW = 40 / W, minH = 40 / H;
    let { x, y, w, h } = drag.start;
    if (drag.mode === 'move') {
      x = clamp(x + dx, 0, 1 - w);
      y = clamp(y + dy, 0, 1 - h);
    } else {
      let l = x, t = y, r = x + w, b = y + h;
      const m = drag.mode;
      if (m.includes('w')) l = clamp(l + dx, 0, r - minW);
      if (m.includes('e')) r = clamp(r + dx, l + minW, 1);
      if (m.includes('n')) t = clamp(t + dy, 0, b - minH);
      if (m.includes('s')) b = clamp(b + dy, t + minH, 1);
      x = l; y = t; w = r - l; h = b - t;
    }
    crop = { x, y, w, h };
    placeCrop();
  });
  const endDrag = () => { drag = null; };
  els.crop.addEventListener('pointerup', endDrag);
  els.crop.addEventListener('pointercancel', endDrag);

  // ---------- Các nút công cụ ----------
  function rotate(dir) {
    if (!src) return;
    const c = document.createElement('canvas');
    c.width = src.height;
    c.height = src.width;
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((dir * Math.PI) / 2);
    ctx.drawImage(src, -src.width / 2, -src.height / 2);
    src = c;
    crop = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
    render();
  }
  els.btnRotateL.onclick = () => rotate(-1);
  els.btnRotateR.onclick = () => rotate(1);
  els.btnFull.onclick = () => { crop = { x: 0, y: 0, w: 1, h: 1 }; placeCrop(); };
  els.btnRetake.onclick = () => {
    src = null;
    els.cropCard.hidden = true;
    els.resultCard.hidden = true;
    els.pickCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ---------- Lấy phần ảnh trong khung ----------
  function getCroppedDataUrl() {
    const sx = Math.round(crop.x * src.width);
    const sy = Math.round(crop.y * src.height);
    const sw = Math.max(1, Math.round(crop.w * src.width));
    const sh = Math.max(1, Math.round(crop.h * src.height));
    const OUT_MAX = 1600;
    const k = Math.min(1, OUT_MAX / Math.max(sw, sh));
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(sw * k));
    out.height = Math.max(1, Math.round(sh * k));
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', 0.9);
  }

  // ---------- Hiển thị Markdown + công thức ----------
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderMarkdown(text) {
    if (typeof marked === 'undefined' || typeof katex === 'undefined') {
      return '<pre style="white-space:pre-wrap">' + escapeHtml(text) + '</pre>';
    }
    const store = [];
    const stash = (tex, display) => {
      let html;
      try { html = katex.renderToString(tex.trim(), { displayMode: display, throwOnError: false }); }
      catch (e) { html = escapeHtml(tex); }
      store.push(html);
      return `@@MATH${store.length - 1}@@`;
    };
    let t = text
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => stash(m, true))
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => stash(m, true))
      .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => stash(m, false))
      .replace(/\$(?!\s)([^$\n]+?)(?<!\s)\$/g, (_, m) => stash(m, false));
    t = t.replace(/</g, '&lt;'); // chặn HTML lạ chèn vào trang
    let html = marked.parse(t, { breaks: true });
    html = html.replace(/@@MATH(\d+)@@/g, (_, i) => store[Number(i)] || '');
    return html;
  }

  // ---------- Gửi đi giải ----------
  els.btnSolve.onclick = async () => {
    if (!src) return;
    const image = getCroppedDataUrl();
    els.sentImg.src = image;
    els.resultCard.hidden = false;
    els.loading.hidden = false;
    els.error.hidden = true;
    els.info.hidden = true;
    els.warn.hidden = true;
    els.answer.innerHTML = '';
    els.btnSolve.disabled = true;
    els.resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
      const res = await fetch('/api/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image,
          subject: els.subject.value,
          level: els.level.value,
          mode: els.mode.value,
          note: els.note.value.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Có lỗi xảy ra, vui lòng thử lại.');
      if (data.note) {
        els.info.textContent = data.note;
        els.info.hidden = false;
      }
      els.answer.innerHTML = renderMarkdown(data.answer);
      els.warn.hidden = false;
    } catch (e) {
      els.error.textContent = e.message || 'Không kết nối được tới server.';
      els.error.hidden = false;
    } finally {
      els.loading.hidden = true;
      els.btnSolve.disabled = false;
    }
  };
})();
