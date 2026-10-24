// ── DTV Sender Web · app.js ──────────────────────────────────────────────────
// Corre en GitHub Pages — sin extensión, sin servidor

const DEFAULT_TEMPLATE =
`{¡Hola!|¡Buenas!|¡Qué tal!} {👋|✨|🚀}

{Te contacto porque te había interesado el servicio|Te escribo por la consulta que nos hiciste|Te separé este beneficio porque habías consultado} en {DIRECTV®️|DTV}.

{🚨 Se liberaron cupos con descuento|🔥 Tengo una promoción exclusiva para vos|🎁 Logré rescatar esta oferta para tu domicilio}:

💸 Precio regular: ~*$50.500*~
🔥 *PRECIO HOY: $29.900* {descuento por 1 año|descuento por 12 meses}.

🎁 {¡Octubre de regalo, pagás en NOVIEMBRE!|¡Empezás a abonar recién en NOVIEMBRE!}
📺 {Instalación GRATIS + 2 Decos|2 Decos incluidos + Instalación 100% bonificada}.
📱 {Incluye DGO, Disney+ y Amazon Prime|Con acceso a DGO, Amazon Prime y Disney+}.

💳 {Beneficio exclusivo con tarjeta de crédito|Solo válido con tarjeta de crédito|Único requisito: tarjeta de crédito}.

{⏳ ¿Te reservo un lugar? Son los últimos cupos.|🚨 ¿Avanzamos con el alta así te congelo el precio?|⏰ ¿Te guardo esta promo antes de que se agote?}

[firma] [emoji]`;

// ── Estado ────────────────────────────────────────────────────────────────────
let contacts  = [];
let queue     = [];
let idx       = 0;
let sent      = 0;
let errors    = 0;
let running   = false;
let paused    = false;
let sendTimer = null;
let wppWindow = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
const $   = id => document.getElementById(id);
const val = id => $(id)?.value ?? '';
const esc = s  => String(s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

let _at = {};
function showAlert(id, type, msg) {
  const el = $(id); if (!el) return;
  el.className = 'alert show ' + type;
  el.textContent = msg;
  clearTimeout(_at[id]);
  _at[id] = setTimeout(() => { el.className = 'alert'; }, 5000);
}

function addLog(level, msg) {
  const box = $('logBox');
  const d   = document.createElement('div');
  d.className = 'log-line';
  const now = new Date().toLocaleTimeString('es-AR',
    {hour:'2-digit',minute:'2-digit',second:'2-digit'});
  d.innerHTML =
    `<span class="log-t">${now}</span>` +
    `<span class="log-m ${level}">${esc(msg)}</span>`;
  box.appendChild(d);
  if (box.children.length > 300) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}

// ── SpinTax ───────────────────────────────────────────────────────────────────
function spin(tmpl) {
  let prev, text = tmpl;
  do {
    prev = text;
    text = text.replace(/\{([^{}]+)\}/g, m => {
      const opts = m.slice(1,-1).split('|');
      return opts[Math.floor(Math.random() * opts.length)];
    });
  } while (prev !== text);
  return text;
}

function buildMsg(tmpl) {
  const signs  = val('signPool').split('|').map(s=>s.trim()).filter(Boolean);
  const emojis = [...val('emojiPool')];
  const sign   = signs.length  ? signs[Math.floor(Math.random()*signs.length)]   : '';
  const emoji  = emojis.length ? emojis[Math.floor(Math.random()*emojis.length)] : '';
  return spin(tmpl)
    .replace(/\[firma\]/g, sign)
    .replace(/\[emoji\]/g, emoji)
    .trim();
}

// ── Contactos ─────────────────────────────────────────────────────────────────
function normPhone(raw) {
  const d = raw.replace(/\D/g,'');
  if (d.length < 8) return null;
  if (d.startsWith('54') && d.length >= 12) return d;
  if (d.startsWith('0'))  return '54' + d.slice(1);
  if (d.length <= 11)     return '54' + d;
  return '54' + d;
}

function parseAndLoad() {
  const lines = val('rawContacts').trim().split('\n')
    .map(l=>l.trim()).filter(l=>l && !l.startsWith('#'));
  let added = 0;
  for (const l of lines) {
    let name='', raw=l;
    if (l.includes(',')) { const p=l.split(',',2); name=p[0].trim(); raw=p[1].trim(); }
    const phone = normPhone(raw);
    if (phone && !contacts.find(c=>c.phone===phone)) {
      contacts.push({name, phone, status:'pending'});
      added++;
    }
  }
  if (!added) { showAlert('alertContacts','err','No encontré números válidos.'); return; }
  renderGrid();
  showAlert('alertContacts','ok',`✓ ${added} contacto(s) cargado(s).`);
}

function clearContacts() {
  contacts = [];
  $('rawContacts').value = '';
  $('contactWrap').style.display = 'none';
  updateSel();
}

function renderGrid() {
  $('contactGrid').innerHTML = contacts.map((c,i) => `
    <div class="ci ${c.status}" id="ci${i}">
      <input type="checkbox" class="c-chk" id="chk${i}" checked>
      <div class="c-dot ${c.status}" id="cd${i}"></div>
      <span class="c-name">${esc(c.name||'Sin nombre')}</span>
      <span class="c-phone">${esc(c.phone)}</span>
    </div>`).join('');
  $('contactWrap').style.display = '';
  $('chkAll').checked = true;
  updateSel();
  contacts.forEach((_,i) => $(`chk${i}`)?.addEventListener('change', updateSel));
}

function toggleAll() {
  const v = $('chkAll').checked;
  contacts.forEach((_,i) => { const el=$(`chk${i}`); if(el) el.checked=v; });
  updateSel();
}

function updateSel() {
  $('selCount').textContent = getSel().length + ' sel.';
}

function getSel() {
  return contacts.filter((_,i) => $(`chk${i}`)?.checked);
}

// ── IA — Reformular con Claude ────────────────────────────────────────────────
async function reformularConIA() {
  const apiKey = val('apiKey').trim();
  const tmpl   = val('template').trim();
  const prompt = val('aiPrompt').trim();

  if (!apiKey) { showAlert('alertAI','err','Ingresá tu API Key de Claude primero.'); return; }
  if (!tmpl)   { showAlert('alertAI','err','El template está vacío.'); return; }

  $('aiSpinner').style.display = 'block';
  $('btnAI').disabled = true;
  $('aiResult').style.display = 'none';

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'x-api-key':            apiKey,
        'anthropic-version':    '2023-06-01',
        'anthropic-dangerous-allow-browser': 'true',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{
          role:    'user',
          content: `${prompt}\n\nMensaje original:\n${tmpl}\n\nResponde SOLO con el mensaje reformulado, sin explicaciones ni comillas. Mantené el formato SpinTax {opción A|opción B} y las variables [firma] [emoji] exactamente como están.`,
        }],
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(()=>({}));
      throw new Error(err?.error?.message || `Error ${resp.status}`);
    }

    const data      = await resp.json();
    const resultado = data.content?.[0]?.text?.trim() || '';

    if (!resultado) throw new Error('Respuesta vacía de la IA');

    // Mostrar resultado con botón para aplicar
    $('aiResult').style.display = 'block';
    $('aiResult').innerHTML = `
      <div style="color:var(--text);white-space:pre-wrap;margin-bottom:8px">${esc(resultado)}</div>
      <button class="btn btn-teal btn-sm" id="btnApplyAI" style="margin-top:6px">✓ Usar este mensaje</button>`;
    $('btnApplyAI').addEventListener('click', () => {
      $('template').value = resultado;
      $('aiResult').style.display = 'none';
      showAlert('alertAI','ok','Mensaje actualizado.');
    });

  } catch(e) {
    showAlert('alertAI','err','Error de IA: ' + e.message);
  } finally {
    $('aiSpinner').style.display = 'none';
    $('btnAI').disabled = false;
  }
}

// ── Preview ───────────────────────────────────────────────────────────────────
function showPreview() {
  const tmpl = val('template'); if (!tmpl.trim()) return;
  $('previewBox').innerHTML = [1,2,3].map(i =>
    `<div class="preview-bbl">
       <span class="preview-n">v${i}</span>
       ${esc(buildMsg(tmpl))}
     </div>`
  ).join('');
}

// ── WhatsApp Web — abre wa.me y espera Enter del usuario ─────────────────────
function openWA() {
  wppWindow = window.open('https://web.whatsapp.com', '_blank',
    'width=1100,height=750,left=100,top=80');
  if (!wppWindow) {
    showAlert('alertSend','err',
      'El popup fue bloqueado. Permitilo en la barra de direcciones y volvé a intentar.');
  }
}

// ── Envío — abre wa.me links en la ventana de WA ─────────────────────────────
async function startSend() {
  const sel  = getSel();
  const tmpl = val('template').trim();
  if (!sel.length) { showAlert('alertSend','err','Seleccioná contactos primero.'); return; }
  if (!tmpl)       { showAlert('alertSend','err','El mensaje está vacío.'); return; }

  // Construir queue
  queue  = sel.map(c => ({ ...c, msg: buildMsg(tmpl), status:'pending' }));
  idx    = 0; sent = 0; errors = 0;
  running = true; paused = false;

  $('chipTotal').textContent  = queue.length;
  $('chipSent').textContent   = '0';
  $('chipErr').textContent    = '0';
  $('progressWrap').style.display = '';
  $('ctrlStart').style.display    = 'none';
  $('ctrlRunning').style.display  = '';
  $('logBox').innerHTML = '';

  $('sendList').innerHTML = queue.map((c,i) => `
    <div class="ci pending" id="sq${i}">
      <div class="c-dot pending" id="sd${i}"></div>
      <span class="c-name">${esc(c.name||'Sin nombre')}</span>
      <span class="c-phone">${esc(c.phone)}</span>
    </div>`).join('');

  addLog('info', `▶ Iniciando — ${queue.length} contactos`);
  addLog('info', '⚠️ Cada mensaje abre WhatsApp — presioná Enter para enviar');
  runNext();
}

function runNext() {
  if (!running || paused) return;
  if (idx >= queue.length) { finish(); return; }

  const c = queue[idx];
  updContact(idx, 'sending');
  addLog('info', `[${idx+1}/${queue.length}] → +${c.phone}`);

  // Abrir wa.me con el mensaje ya formateado
  // El usuario solo necesita presionar Enter en WhatsApp Web
  const waUrl = `https://wa.me/${c.phone}?text=${encodeURIComponent(c.msg)}`;

  // Abrir en la ventana de WA si existe, si no en nueva pestaña
  if (wppWindow && !wppWindow.closed) {
    wppWindow.location.href = waUrl;
  } else {
    wppWindow = window.open(waUrl, 'dtv_wpp',
      'width=1100,height=750,left=100,top=80');
  }

  // Marcar como enviado después del delay
  // (asumimos que el usuario presionó Enter)
  const delay = getDelay();
  addLog('info', `⏱ Próximo en ${Math.round(delay/1000)}s — presioná Enter en WhatsApp`);

  sendTimer = setTimeout(() => {
    updContact(idx, 'sent');
    sent++;
    $('chipSent').textContent = sent;
    idx++;
    updateProgress();

    const longOn    = $('longOn').checked;
    const longEvery = +val('longEvery') || 20;
    if (longOn && sent > 0 && sent % longEvery === 0) {
      const longDelay = +val('longMins') * 60 * 1000;
      addLog('warn', `⏳ Pausa larga: ${Math.round(longDelay/1000)}s`);
      sendTimer = setTimeout(() => runNext(), longDelay);
    } else {
      runNext();
    }
  }, delay);
}

function getDelay() {
  const base = +val('delaySlider') * 1000 || 45000;
  // ±20% variación natural
  return base + (Math.random() - 0.5) * base * 0.4;
}

function updContact(i, status) {
  const row=$(`sq${i}`), dot=$(`sd${i}`);
  if (row) row.className=`ci ${status}`;
  if (dot) dot.className=`c-dot ${status}`;
}

function updateProgress() {
  const total = queue.length;
  const done  = sent + errors;
  const pct   = total ? Math.round((done/total)*100) : 0;
  $('progFill').style.width  = pct+'%';
  $('progPct').textContent   = pct+'%';
  $('progLbl').textContent   = running
    ? `Contacto ${Math.min(idx+1,total)}/${total}` : '✅ Listo';
}

function finish() {
  running = false;
  addLog('ok', `✅ Difusión completa — ${sent} abiertos, ${errors} errores`);
  $('ctrlRunning').style.display = 'none';
  $('ctrlDone').style.display    = '';
  $('progLbl').textContent = '✅ Completado';
}

function togglePause() {
  paused = !paused;
  $('btnPause').textContent = paused ? '▶ Reanudar' : '⏸ Pausar';
  addLog('warn', paused ? '⏸ Pausado' : '▶ Reanudado');
  if (!paused) runNext();
}

function stopSend() {
  running = false; paused = false;
  clearTimeout(sendTimer);
  addLog('warn','⏹ Detenido');
  $('ctrlRunning').style.display = 'none';
  $('ctrlStart').style.display   = '';
}

function resetSend() {
  $('ctrlDone').style.display     = 'none';
  $('ctrlStart').style.display    = '';
  $('progressWrap').style.display = 'none';
  $('logBox').innerHTML = '';
  $('sendList').innerHTML = '';
  idx=0; sent=0; errors=0;
}

// ── Guardar API key en localStorage ──────────────────────────────────────────
function loadSavedKey() {
  const saved = localStorage.getItem('dtv_apikey');
  if (saved) $('apiKey').value = saved;
}
$('apiKey')?.addEventListener('blur', () => {
  const k = val('apiKey').trim();
  if (k) localStorage.setItem('dtv_apikey', k);
});

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
  $('btnClear')    .addEventListener('click', clearContacts);
  $('btnParse')    .addEventListener('click', parseAndLoad);
  $('chkAll')      .addEventListener('change', toggleAll);
  $('btnDefault')  .addEventListener('click', () => { $('template').value = DEFAULT_TEMPLATE; });
  $('btnPreview')  .addEventListener('click', showPreview);
  $('btnAI')       .addEventListener('click', reformularConIA);
  $('btnOpenWA')   .addEventListener('click', openWA);
  $('btnStart')    .addEventListener('click', startSend);
  $('btnPause')    .addEventListener('click', togglePause);
  $('btnStop')     .addEventListener('click', stopSend);
  $('btnReset')    .addEventListener('click', resetSend);
  $('delaySlider') .addEventListener('input', () => {
    $('delayVal').textContent = val('delaySlider') + 's';
  });
  $('longOn').addEventListener('change', () => {
    $('longCfg').style.display = $('longOn').checked ? '' : 'none';
  });

  $('template').value = DEFAULT_TEMPLATE;
  loadSavedKey();
}

document.addEventListener('DOMContentLoaded', init);
