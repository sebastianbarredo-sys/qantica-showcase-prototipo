/* Qantica Showcase · prototipo navegable
   - Contenido inyectado por build.py en window.QSC (sin fetch en tiempo de ejecución: anda en file:// y en Pages).
   - Estado en localStorage (una sola clave). Votos y follows pertenecen a la CUENTA; las reacciones, al VISITANTE anónimo.
   - Log de eventos append-only, mismo patrón que el Pulse: se guarda siempre local y, si METRICS_ENDPOINT
     tiene una URL, cada evento viaja por sendBeacon. El log nunca lleva emails. */
(function () {
'use strict';

const D = window.QSC;
const ROOT = D.root;
const ENDPOINT = D.endpoint || '';
const SITE = D.site;
const OBRAS = D.obras.slice().sort((a, b) => a.orden - b.orden);
const OBRA = D.page === 'obra' ? OBRAS.find(o => o.id === D.obra_id) : null;
const KEY = 'qsc_state_v1';
const LANG_KEY = 'qsc_lang';
const GAP = 30 * 60 * 1000;
const PARAMS = new URLSearchParams(location.search);
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const now = () => Date.now();

/* ================= utilidades ================= */
function rid(p) {
  let r = '';
  try { const a = new Uint32Array(2); crypto.getRandomValues(a); r = a[0].toString(36) + a[1].toString(36).slice(0, 3); }
  catch (_) { r = Math.random().toString(36).slice(2, 10); }
  return p + '_' + r;
}
function hash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, LANG === 'es' ? '.' : ','); }
function pct(a, b) { return b ? Math.round(a * 100 / b) + '%' : 's/d'; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function fecha(ts) { try { return new Date(ts).toLocaleString(LANG === 'es' ? 'es-ES' : 'en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (_) { return String(ts); } }
function obraById(id) { return OBRAS.find(o => o.id === id); }
function obraUrl(id, extra) { return ROOT + 'obra/' + id + '/index.html?lang=' + LANG + (extra || ''); }
function catalogoUrl(frag) { return ROOT + 'index.html?lang=' + LANG + (frag || ''); }
function asset(f) { return ROOT + 'assets/' + f; }
const REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const SMOOTH = REDUCED ? 'auto' : 'smooth';
const DEVICE = (() => {
  const coarse = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  const small = Math.min(screen.width || 9999, screen.height || 9999) < 768;
  return coarse ? (small ? 'movil' : 'tablet') : 'escritorio';
})();
if (PARAMS.get('tema') === 'marca') document.documentElement.dataset.tema = 'marca';

/* ================= idioma ================= */
let LANG = (() => {
  const q = PARAMS.get('lang');
  if (q === 'es' || q === 'en') return q;
  try { const s = localStorage.getItem(LANG_KEY); if (s === 'es' || s === 'en') return s; } catch (_) {}
  return (navigator.language || 'es').toLowerCase().startsWith('en') ? 'en' : 'es';
})();
document.documentElement.lang = LANG;
function t(o, vars) {
  if (o == null) return '';
  let s = typeof o === 'string' ? o : (o[LANG] != null ? o[LANG] : (o.es != null ? o.es : ''));
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
  return s;
}

/* ================= estado ================= */
function blank() {
  return { v: 1, visitante: rid('v'), sesion: null, visitas: {}, cuenta: null, cuentas: {}, vinculos: {},
    reacciones: {}, pulse: {}, comentarios: [], solicitudes: [], pendiente: null, ultimas: {}, desfase: 0, log: [] };
}
function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) { const s = JSON.parse(raw); if (s && s.v === 1) return s; } } catch (_) {}
  return blank();
}
let STORAGE_OK = true;
function save() {
  if (!STORAGE_OK) return;
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) {
    if (S.log.length > 500) { S.log.splice(0, Math.floor(S.log.length * 0.2)); try { localStorage.setItem(KEY, JSON.stringify(S)); return; } catch (_) {} }
    STORAGE_OK = false;
  }
}
let S = load();
const clock = () => now() + (S.desfase || 0);

/* cuenta, banderas por obra y reacciones */
function acct() { return S.cuenta ? S.cuentas[S.cuenta] : null; }
function nivel() { const a = acct(); return a ? a.nivel : 'anonimo'; }
function acctObra(id) { const a = acct(); if (!a) return null; if (!a.obras[id]) a.obras[id] = { voto: null, follow: null, mails: false }; return a.obras[id]; }
function flags(id) { const a = acct(); return (a && a.obras[id]) || { voto: null, follow: null, mails: false }; }
function isVoted(id) { const v = flags(id).voto; return !!(v && v.estado === 'confirmado'); }
function isFollowing(id) { const f = flags(id).follow; return !!(f && f.estado === 'siguiendo'); }
function wantsMails(id) { return !!flags(id).mails; }
function pendingFor(motivo, id) { const p = S.pendiente; return !!(p && p.motivo === motivo && p.obra === id && p.expira > now()); }
function qkey(q) { return q.id + '@' + q.version; }
function myRx(oid) { const v = S.reacciones[S.visitante] || (S.reacciones[S.visitante] = {}); return v[oid] || (v[oid] = {}); }
function myReaction(o, q) { const v = S.reacciones[S.visitante]; return v && v[o.id] ? v[o.id][qkey(q)] : null; }
function pulseCount(oid) { const p = S.pulse[S.visitante]; return p && p[oid] ? p[oid].veces : 0; }
function countReactions(vis) { let n = 0; const v = S.reacciones[vis] || {}; Object.values(v).forEach(o => Object.values(o).forEach(r => { if (r && r.opcion) n++; })); return n; }

/* cifras: base de ejemplo (crece un voto cada 15 min desde el build) + lo real de este navegador */
const T0 = D.build_ts || now();
function growth() { return clamp(Math.floor((clock() - T0) / (15 * 60 * 1000)), 0, 400); }
function totals(o) {
  let com = o.votos.comunidad + growth(), esp = o.votos.especialistas;
  Object.values(S.cuentas).forEach(c => { const v = c.obras[o.id] && c.obras[o.id].voto; if (v && v.estado === 'confirmado') { if (c.nivel === 'profesional') esp++; else com++; } });
  return { com, esp, meta: o.votos.meta, ratio: clamp(com / o.votos.meta, 0, 1) };
}
function reactionTotals(o, q) {
  const r = Object.assign({}, q.base || {});
  Object.values(S.reacciones).forEach(v => { const x = v[o.id] && v[o.id][qkey(q)]; if (x && x.opcion) r[x.opcion] = (r[x.opcion] || 0) + 1; });
  return r;
}

/* sesión: la visita se renueva tras 30 min sin actividad; el visitante (ticket anónimo) persiste */
function ensureSession(motivo) {
  const s = S.sesion;
  if (s && s.visitante === S.visitante && clock() - s.ultimo < GAP) { s.ultimo = clock(); return null; }
  let origen = 'directo';
  if (PARAMS.get('ref') === 'share') origen = 'compartido';
  else if (PARAMS.get('utm_source')) origen = 'campaña:' + PARAMS.get('utm_source');
  else if (motivo === 'simulado') origen = 'simulado';
  else if (document.referrer) { try { const h = new URL(document.referrer).hostname; if (h && h !== location.hostname) origen = h; } catch (_) {} }
  S.visitas[S.visitante] = (S.visitas[S.visitante] || 0) + 1;
  S.sesion = { id: rid('s'), visitante: S.visitante, inicio: clock(), ultimo: clock(), origen, de: PARAMS.get('from') || null,
    visita: S.visitas[S.visitante], vistos: {}, visto_ts: {}, orden: {} };
  save();
  return S.visitas[S.visitante] > 1 ? 'visita' : 'nueva';
}

/* ================= eventos ================= */
function track(ev, data) {
  data = data || {};
  if (S.sesion) S.sesion.ultimo = clock();
  const e = Object.assign({
    id: rid('e'), ev, ts: now(), pagina: D.page, obra: OBRA ? OBRA.id : null,
    sesion: S.sesion ? S.sesion.id : null, visitante: S.visitante, visita: S.sesion ? S.sesion.visita : null,
    cuenta: S.cuenta, nivel: nivel(), origen: S.sesion ? S.sesion.origen : null,
    dispositivo: DEVICE, idioma: LANG, version: D.build, entorno: 'prototipo'
  }, data);
  S.log.push(e);
  if (S.log.length > 3000) S.log.splice(0, S.log.length - 3000);
  save();
  if (ENDPOINT) {
    const payload = JSON.stringify(e);
    try { if (!navigator.sendBeacon || !navigator.sendBeacon(ENDPOINT, payload)) fetch(ENDPOINT, { method: 'POST', body: payload, keepalive: true }).catch(() => {}); } catch (_) {}
  }
  return e;
}
function once(key, fn) {
  if (!S.sesion) return false;
  if (S.sesion.vistos[key]) return false;
  S.sesion.vistos[key] = now(); fn(); return true;
}
window.addEventListener('error', e => { try { track('error_js', { mensaje: String(e.message).slice(0, 160), fuente: (e.filename || '').split('/').pop(), linea: e.lineno }); } catch (_) {} });
window.addEventListener('unhandledrejection', e => { try { track('error_js', { mensaje: String(e.reason).slice(0, 160) }); } catch (_) {} });

/* ================= iconos ================= */
const I = {
  heart: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
  heartF: '<svg class="ico" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
  check: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  lock: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  left: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>',
  right: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>',
  ext: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>',
  x: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  share: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v14"/></svg>',
  play: '<svg class="ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  vote: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 11v9H4v-9zM7 11l4-8a2.5 2.5 0 0 1 2.5 2.5V9h5.2a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.5 20H7"/></svg>',
  list: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  down: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12l7 7 7-7"/></svg>'
};

/* ================= piezas compartidas ================= */
function langToggle() {
  return `<div class="lang" role="group" aria-label="Idioma / Language">
    <button type="button" data-act="lang" data-lang="es" aria-pressed="${LANG === 'es'}">ES</button>
    <button type="button" data-act="lang" data-lang="en" aria-pressed="${LANG === 'en'}">EN</button></div>`;
}
function listaBtn() {
  const n = OBRAS.filter(o => isFollowing(o.id)).length;
  return `<button type="button" class="iconbtn" data-act="sheet" data-sheet="lista" aria-label="${esc(t(SITE.nav.lista))}">
    ${n ? I.heartF : I.heart}<span class="hide-sm">${esc(t(SITE.nav.lista))}</span>${n ? `<span class="badge">${n}</span>` : ''}</button>`;
}
function protoChip() { return `<button type="button" class="proto" data-act="sheet" data-sheet="proto">${esc(t(SITE.proto.chip))}</button>`; }
function posterHTML(o, opts) {
  opts = opts || {};
  const ov = o.poster_overlay ? `<span class="ov"><span class="k">${esc(t(o.poster_overlay.kicker))}</span>
      <span><span class="t">${esc(o.title)}</span><span class="s">${esc(t(o.poster_overlay.sub))}</span></span></span>` : '';
  const flags = [];
  if (isFollowing(o.id)) flags.push(`<span class="flag gold">♥ ${esc(t(SITE.ficha.sigues))}</span>`);
  if (isVoted(o.id)) flags.push(`<span class="flag">✓ ${esc(t(SITE.ficha.votaste))}</span>`);
  return `<span class="poster ${flags.length ? 'has-flags' : ''}" ${opts.vt ? `style="view-transition-name:${opts.vt}"` : ''}>
    <img src="${asset(o.poster)}" alt="${o.poster_overlay ? '' : esc(o.title)}" style="object-position:${o.poster_pos || '50% 50%'}" ${opts.eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" width="600" height="900">
    ${ov}${flags.length ? `<span class="flags">${flags.join('')}</span>` : ''}</span>`;
}
function meterHTML(o, cls) {
  const x = totals(o);
  return `<div class="meter ${cls || ''}" role="progressbar" aria-valuemin="0" aria-valuemax="${x.meta}" aria-valuenow="${x.com}" aria-label="${esc(t(SITE.ficha.meta, { n: fmt(x.com), meta: fmt(x.meta) }))}"><i style="width:${(x.ratio * 100).toFixed(1)}%"></i></div>`;
}

/* ================= catálogo ================= */
let CAR_IDX = Math.max(0, OBRAS.findIndex(o => o.id === 'mantis'));
let FILTRO = 'todas';

function renderCatalogo() {
  const n = SITE.nav;
  return `
  <header class="hdr" id="hdr"><div class="wrap">
    <a class="brand" href="#top" data-act="logo" aria-label="Qantica Showcase"><img src="${asset('logo-qantica.webp')}" alt="QANTICA" width="480" height="77"></a>
    ${protoChip()}
    <nav class="nav" aria-label="Showcase">
      <a href="#obras" data-act="goto-id" data-target="obras" data-cta="nav_historias">${esc(t(n.historias))}</a>
      <a href="#como" data-act="goto-id" data-target="como" data-cta="nav_como">${esc(t(n.como))}</a>
      <button type="button" data-act="sheet" data-sheet="industria" data-cta="nav_industria">${esc(t(n.industria))}</button>
    </nav>
    <div class="hdr-actions">${listaBtn()}${langToggle()}</div>
  </div></header>
  <nav class="mobnav" aria-label="Showcase">
    <a href="#obras" data-act="goto-id" data-target="obras" data-cta="nav_historias">${esc(t(n.historias))}</a>
    <a href="#como" data-act="goto-id" data-target="como" data-cta="nav_como">${esc(t(n.como))}</a>
    <button type="button" data-act="sheet" data-sheet="industria" data-cta="nav_industria">${esc(t(n.industria))}</button>
  </nav>
  <main id="main">
    <section class="c-hero" id="top" data-section="carrusel">
      <div class="wrap c-hero-head">
        <div><p class="eyebrow">${esc(t(SITE.hero.eyebrow))}</p>
          <h1>${esc(t(SITE.hero.title))}<span class="dot">.</span></h1>
          <p class="lead">${esc(t(SITE.hero.sub))}</p></div>
        <span class="c-hero-label">${esc(t(SITE.hero.label))}</span>
      </div>
      <div class="car" id="car">
        <div class="car-track" id="car-track" tabindex="0" aria-roledescription="carousel" aria-label="${esc(t(SITE.hero.title))}">
          ${OBRAS.map((o, i) => `<div class="car-slide" data-idx="${i}"><button type="button" class="poster-btn" data-act="slide" data-idx="${i}" data-card="carrusel:${o.id}" data-pos="${i}" aria-label="${esc(o.title)}">${posterHTML(o, { eager: i === CAR_IDX, vt: i === CAR_IDX ? 'poster-' + o.id : '' })}</button></div>`).join('')}
        </div>
        <div class="wrap car-ctrl">
          <div class="car-prog" id="car-prog" aria-hidden="true">${OBRAS.map(() => '<i></i>').join('')}</div>
          <span class="car-count" id="car-count" aria-live="polite"></span>
          <div class="car-arrows">
            <button type="button" class="round" data-act="car-prev" aria-label="${esc(t(SITE.hero.prev))}">${I.left}</button>
            <button type="button" class="round" data-act="car-next" aria-label="${esc(t(SITE.hero.next))}">${I.right}</button>
          </div>
        </div>
      </div>
      <div class="wrap">
        <div class="ficha" id="ficha" aria-live="polite" data-section="ficha">${fichaHTML(OBRAS[CAR_IDX])}</div>
        <div id="mine">${mineHTML()}</div>
      </div>
    </section>

    <section class="sec" id="qantica" data-section="intro"><div class="wrap q-block rv">
      <div><p class="eyebrow">${esc(t(SITE.qantica.eyebrow))}</p><h2>${esc(t(SITE.qantica.title))}</h2></div>
      <div><p class="lead">${esc(t(SITE.qantica.text))}</p>
        <div class="row">
          <a class="btn light" href="https://qantica.com" target="_blank" rel="noopener" data-ext="qantica" data-cta="explorar_qantica">${esc(t(SITE.qantica.cta))} ${I.ext}</a>
          <a class="btn ghost" href="#obras" data-act="goto-id" data-target="obras" data-cta="ver_todas">${esc(t(SITE.qantica.cta2))} ${I.down}</a>
        </div></div>
    </div></section>

    <section class="sec tight" id="obras" data-section="grilla"><div class="wrap">
      <div class="sec-head rv">
        <div><p class="eyebrow">${esc(t(SITE.grilla.eyebrow))}</p><h2>${esc(t(SITE.grilla.title))}</h2></div>
        <div class="seg" role="group" aria-label="${esc(t(SITE.grilla.title))}" id="seg">${segHTML()}</div>
      </div>
      <div class="grid" id="grid">${gridHTML()}</div>
    </div></section>

    <section class="sec" id="como" data-section="como"><div class="wrap">
      <div class="sec-head rv"><div><p class="eyebrow">${esc(t(SITE.como.eyebrow))}</p><h2>${esc(t(SITE.como.title))}</h2></div></div>
      <div class="steps rv">${SITE.como.pasos.map(p => `<div class="step"><h3>${esc(t(p.t))}</h3><p>${esc(t(p.d))}</p></div>`).join('')}</div>
      <p class="note rv">${esc(t(SITE.como.nota))}</p>
    </div></section>

    <section class="sec tight" id="invitacion" data-section="invitacion"><div class="wrap"><div class="invite rv">
      <p class="eyebrow">${esc(t(SITE.invitacion.eyebrow))}</p><h2>${esc(t(SITE.invitacion.title))}</h2>
      <p class="lead">${esc(t(SITE.invitacion.text))}</p>
      <a class="btn primary" href="#obras" data-act="goto-id" data-target="obras" data-cta="encontrar_historia">${esc(t(SITE.invitacion.cta))} ${I.right}</a>
    </div></div></section>

    <section class="sec tight" id="rutas" data-section="rutas"><div class="wrap">
      <p class="eyebrow rv">${esc(t(SITE.rutas.eyebrow))}</p>
      <div class="routes rv">${['creadores', 'talento', 'industria'].map(k => `
        <div class="route"><h3>${esc(t(SITE.rutas[k].t))}</h3><p>${esc(t(SITE.rutas[k].d))}</p>
          <button type="button" class="btn sm" data-act="sheet" data-sheet="${k}" data-cta="pie_${k}">${esc(t(SITE.rutas[k].cta))} ${I.right}</button></div>`).join('')}
      </div>
    </div></section>
  </main>
  <footer class="foot" data-section="pie"><div class="wrap">
    <div><img src="${asset('logo-qantica.webp')}" alt="QANTICA" width="480" height="77"><p class="muted small" style="margin-top:10px">${esc(t(SITE.pie.linea))}</p></div>
    <nav aria-label="Pie">
      <a href="https://qantica.com" target="_blank" rel="noopener" data-ext="qantica">${esc(t(SITE.pie.qantica))}</a>
      <button type="button" data-act="sheet" data-sheet="privacidad">${esc(t(SITE.pie.privacidad))}</button>
      <button type="button" data-act="sheet" data-sheet="proto">${esc(t(SITE.proto.chip))}</button>
    </nav>
  </div></footer>`;
}

function fichaHTML(o) {
  const x = totals(o);
  const estado = [];
  if (isFollowing(o.id)) estado.push(`<span class="tag gold">♥ ${esc(t(SITE.ficha.sigues))}</span>`);
  if (isVoted(o.id)) estado.push(`<span class="tag ok">✓ ${esc(t(SITE.ficha.votaste))}</span>`);
  return `<div>
      <p class="fmt">${esc(t(o.format))}</p>
      <h2>${esc(o.title)}</h2>
      <p class="sum">${esc(t(o.summary))}</p>
      ${estado.length ? `<div class="tags" style="margin-top:14px">${estado.join('')}</div>` : ''}
    </div>
    <div>
      <dl><dt>${esc(t(SITE.ficha.etapa))}</dt><dd>${esc(t(o.etapa))}</dd>
          <dt>${esc(t(SITE.ficha.proximo))}</dt><dd>${esc(fmt(x.meta))} ${LANG === 'es' ? 'votos' : 'votes'} · ${esc(t(o.hito))}</dd></dl>
      ${meterHTML(o)}
      <div class="meter-txt"><span><b>${fmt(x.com)}</b> / ${fmt(x.meta)}</span><span class="sample">${esc(t(SITE.ficha.ejemplo))}</span></div>
      <div class="row"><a class="btn primary" href="${obraUrl(o.id)}" data-act="open-obra" data-obra="${o.id}" data-origen="ficha" data-cta="explorar_obra">${esc(t(SITE.ficha.explorar))} ${I.right}</a></div>
    </div>`;
}
function mineHTML() {
  const mine = OBRAS.filter(o => isFollowing(o.id) || isVoted(o.id));
  if (!mine.length) return '';
  return `<div class="mine" aria-label="${esc(t(SITE.tulista.title))}"><span class="lbl">${esc(t(SITE.tulista.title))}</span>
    ${mine.map(o => `<a href="${obraUrl(o.id)}" data-act="open-obra" data-obra="${o.id}" data-origen="tu_lista"><img src="${asset(o.poster)}" alt="" loading="lazy" style="object-position:${o.poster_pos}">${esc(o.title)}${isFollowing(o.id) ? ' <span class="dot">♥</span>' : ''}</a>`).join('')}</div>`;
}
function segHTML() {
  return ['todas', 'cine', 'serie'].map(v => `<button type="button" data-act="filtro" data-v="${v}" aria-pressed="${FILTRO === v}">${esc(t(SITE.grilla.filtros[v]))}</button>`).join('');
}
function gridHTML() {
  const list = OBRAS.filter(o => FILTRO === 'todas' || o.tipo === FILTRO);
  if (!list.length) return `<p class="muted">${esc(t(SITE.grilla.vacio))}</p>`;
  return list.map((o, i) => {
    const x = totals(o);
    return `<a class="gcard" href="${obraUrl(o.id)}" data-act="open-obra" data-obra="${o.id}" data-origen="grilla" data-card="grilla:${o.id}" data-pos="${i}">
      ${posterHTML(o)}
      <span class="gt">${esc(o.title)}</span><span class="gf">${esc(t(o.format))}</span>
      ${meterHTML(o)}<span class="gm">${fmt(x.com)} / ${fmt(x.meta)}</span></a>`;
  }).join('');
}

/* ================= página de obra ================= */
function navOf(o) { return o.nav; }
function followBtnHdr(o) {
  const on = isFollowing(o.id), pend = pendingFor('seguir', o.id);
  const label = on ? t(SITE.obra.siguiendo) : pend ? t(SITE.obra.pendiente) : t(SITE.obra.seguir);
  return `<button type="button" class="iconbtn" data-act="follow" data-via="header" data-cta="seguir_header" aria-pressed="${on}" id="hdr-follow">${on ? I.heartF : I.heart}<span class="hide-sm">${esc(label)}</span></button>`;
}
function renderObra() {
  const o = OBRA;
  const secs = o.modo === 'completa'
    ? ['portada', 'creadora', 'pelicula', 'musica', 'juego', 'experiencia', 'voto', 'seguir', 'hasta', 'conversacion', 'creditos', 'finales']
    : ['portada', 'historia', 'voto', 'seguir', 'hasta', 'conversacion', 'finales'];
  return `
  <header class="hdr" id="hdr"><div class="wrap">
    <a class="back" href="${catalogoUrl()}" data-act="volver" data-cta="volver_showcase">${I.left}<span>${esc(t(SITE.nav.volver))}</span></a>
    <span class="hdr-title" data-act="logo">${o.logo ? `<img src="${asset(o.logo)}" alt="${esc(o.title)}" width="90" height="73">` : esc(o.title)}</span>
    <div class="hdr-actions">${followBtnHdr(o)}${langToggle()}</div>
  </div></header>
  ${railHTML(o)}
  <main id="main">${secs.map(id => SECTIONS[id](o)).join('')}</main>
  ${pieObraHTML(o)}
  ${pillHTML(o)}`;
}
function railHTML(o) {
  return `<nav class="rail" id="rail" aria-label="${esc(t(SITE.obra.capitulos))}">${o.nav.map(n => `<button type="button" data-act="goto-nav" data-nav="${n.id}" data-cta="rail"><i></i>${esc(t(n.label))}</button>`).join('')}</nav>`;
}
function sec(o, id, nav, inner, cls) {
  return `<section class="o-sec ${cls || ''}" id="sec-${id}" data-section="${id}" data-nav="${nav}">${inner}</section>`;
}
/* preguntas: las de un mismo capítulo se muestran en una tarjeta que avanza de a una */
function sectionQs(o, sec) {
  if (sec === 'experiencia') return o.experiencia ? [o.experiencia.pregunta] : [];
  if (sec === 'historia') return o.preguntas || (o.pregunta ? [o.pregunta] : []);
  const c = (o.capitulos || []).find(x => x.id === sec);
  return c ? (c.preguntas || (c.pregunta ? [c.pregunta] : [])) : [];
}
function allQs(o) {
  const all = [];
  (o.capitulos || []).forEach(c => sectionQs(o, c.id).forEach(q => all.push(q)));
  if (o.experiencia && o.experiencia.pregunta) all.push(o.experiencia.pregunta);
  sectionQs(o, 'historia').forEach(q => all.push(q));
  return all;
}
function findQ(o, qid) { return allQs(o).find(q => q.id === qid); }
function stackIdx(o, qs, sec) {
  const st = S.sesion.stack || (S.sesion.stack = {}), key = o.id + ':' + sec;
  if (st[key] == null) { const i = qs.findIndex(q => !myReaction(o, q)); st[key] = i < 0 ? qs.length - 1 : i; }
  return clamp(st[key], 0, qs.length - 1);
}
function ordenOpciones(q) {
  const k = qkey(q);
  if (S.sesion.orden[k]) return S.sesion.orden[k];
  const libres = q.opciones.filter(x => !x.fija).map(x => x.v), fijas = q.opciones.filter(x => x.fija).map(x => x.v);
  S.sesion.orden[k] = (q.barajar === false ? libres : shuffle(libres)).concat(fijas);
  return S.sesion.orden[k];
}
function reactHTML(o, qs, secId) {
  if (!Array.isArray(qs)) qs = [qs];
  const n = qs.length, i = stackIdx(o, qs, secId), q = qs[i];
  const r = myReaction(o, q), k = qkey(q);
  const hechas = qs.filter(x => { const y = myReaction(o, x); return y && y.opcion; }).length;
  const paso = n > 1 ? `<span class="paso">${LANG === 'es' ? 'Pregunta' : 'Question'} ${i + 1} ${LANG === 'es' ? 'de' : 'of'} ${n}</span>` : '';
  const head = `<div class="react-top"><p class="eyebrow work">${esc(t(q.eyebrow))}</p>${paso}</div><h3>${esc(t(q.title))}</h3>${q.sub ? `<p class="sub">${esc(t(q.sub))}</p>` : ''}`;
  const sig = i < n - 1
    ? `<button type="button" class="btn sm" data-act="stack-next" data-sec="${secId}" data-cta="siguiente_pregunta">${LANG === 'es' ? 'Siguiente pregunta' : 'Next question'} ${I.right}</button>`
    : (n > 1 ? `<span class="small muted">${LANG === 'es' ? 'Respondiste' : 'You answered'} ${hechas} ${LANG === 'es' ? 'de' : 'of'} ${n}</span>` : '');
  const attrs = `id="rx-${o.id}-${secId}" data-react="${o.id}|${k}" data-seccion="${secId}"`;
  if (r && r.opcion) {
    const tot = reactionTotals(o, q);
    const sum = Object.values(tot).reduce((a, b) => a + b, 0) || 1;
    return `<div class="react" ${attrs}>${head}
      <p class="saved">${I.check} ${esc(t(SITE.obra.guardado))}</p>
      <div class="results" aria-label="${esc(t(SITE.obra.resultados))}"><p class="small muted">${esc(t(SITE.obra.resultados))} · <span class="sample">${esc(t(SITE.ficha.ejemplo))}</span></p>
        ${q.opciones.map(op => { const c = tot[op.v] || 0; const mine = r.opcion === op.v;
          return `<div class="res ${mine ? 'mine' : ''}"><span class="rl">${esc(t(op))}${mine ? `<span class="yo">${esc(t(SITE.obra.tu_respuesta))}</span>` : ''}</span><span class="rp">${pct(c, sum)}</span><span class="bar"><i data-w="${(c * 100 / sum).toFixed(1)}"></i></span></div>`; }).join('')}
        <p class="small muted">${esc(t(SITE.obra.respuestas, { n: fmt(sum) }))}</p></div>
      ${sig ? `<div class="foot-row">${sig}</div>` : ''}</div>`;
  }
  if (r && r.saltada) {
    return `<div class="react" ${attrs}>${head}
      <div class="foot-row"><span class="small muted">${LANG === 'es' ? 'La saltaste.' : 'You skipped it.'}</span>
      <button type="button" class="textbtn" data-act="unskip" data-q="${q.id}" data-sec="${secId}">${LANG === 'es' ? 'Responder ahora' : 'Answer now'}</button>${sig}</div></div>`;
  }
  const orden = ordenOpciones(q);
  const tarjetas = q.estilo === 'tarjetas';
  return `<div class="react" ${attrs}>${head}
    <div class="opts ${tarjetas ? 'cards' : ''}" role="group" aria-label="${esc(t(q.title))}">${orden.map((v, pos) => { const op = q.opciones.find(x => x.v === v);
      return `<button type="button" class="opt ${tarjetas ? 'card' : ''}" data-act="react" data-q="${q.id}" data-sec="${secId}" data-opt="${v}" data-pos="${pos}" aria-pressed="false">${tarjetas ? `<b>${esc(t(op))}</b><span>${esc(t(op.d))}</span>` : esc(t(op))}</button>`; }).join('')}</div>
    <div class="foot-row"><button type="button" class="textbtn" data-act="skip" data-q="${q.id}" data-sec="${secId}">${esc(t(SITE.obra.saltar))}</button></div></div>`;
}

const SECTIONS = {
  portada(o) {
    if (o.modo === 'completa') {
      const h = o.hero;
      return `<section class="o-hero" id="sec-portada" data-section="portada" data-nav="obra">
        <div class="bg"><img src="${asset(o.poster)}" alt="" fetchpriority="high" style="object-position:${o.poster_pos}; view-transition-name:poster-${o.id}"></div>
        <div class="wrap">
          <h1 style="margin:0">${o.logo ? `<img class="logo" src="${asset(o.logo)}" alt="${esc(o.title)}" width="900" height="732">` : esc(o.title)}</h1>
          <p class="pre">${esc(t(h.pre))}</p>
          <p class="lines">${h.lineas.map(l => `<span>${esc(t(l))}</span>`).join('')}</p>
          <p class="cierre">${esc(t(h.cierre))}</p>
          <p class="sum">${esc(t(o.summary))}</p>
          <a class="scrollcue" href="#sec-creadora" data-act="goto-id" data-target="sec-creadora"><i></i>${LANG === 'es' ? 'Empieza el recorrido' : 'Start exploring'}</a>
        </div></section>`;
    }
    return `<section class="o-hero poster-mode" id="sec-portada" data-section="portada" data-nav="obra">
      <div class="bg"><img src="${asset(o.poster)}" alt="" style="object-position:${o.poster_pos}"></div>
      <div class="wrap">
        <div>${posterHTML(o, { eager: true, vt: 'poster-' + o.id })}</div>
        <div><p class="eyebrow work">${esc(t(o.format))}</p><h1>${esc(o.title)}</h1>
          <p class="sum">${esc(t(o.summary))}</p>
          <div class="tags">${(o.tags || []).map(x => `<span class="tag">${esc(t(x))}</span>`).join('')}</div>
          <a class="scrollcue" href="#sec-historia" data-act="goto-id" data-target="sec-historia"><i></i>${LANG === 'es' ? 'Empieza el recorrido' : 'Start exploring'}</a></div>
      </div></section>`;
  },
  creadora(o) {
    const c = o.creadora;
    return sec(o, 'creadora', 'obra', `<div class="wrap split creator">
      <figure class="figure rv" style="margin:0"><img src="${asset(c.img)}" alt="${esc(c.nombre)}" loading="lazy" width="700" height="869"></figure>
      <div class="rv"><p class="eyebrow work">${esc(t(c.eyebrow))}</p><h2>${esc(c.nombre)}.</h2><p class="role">${esc(t(c.rol))}</p>
        <h3>${esc(t(c.title))}</h3><p class="cap-text">${esc(t(c.text))}</p>
        <div class="links">${c.links.map(l => `<a class="btn sm" href="${esc(l.url)}" target="_blank" rel="noopener" data-ext="creadora_${l.id}" data-cta="creadora_${l.id}">${esc(t(l.label))} ${I.ext}</a>`).join('')}</div></div>
    </div>`);
  },
  pelicula(o) { return capHTML(o, o.capitulos.find(c => c.id === 'pelicula'), 'pelicula'); },
  musica(o) { return capHTML(o, o.capitulos.find(c => c.id === 'musica'), 'musica'); },
  juego(o) {
    const j = o.juego;
    return sec(o, 'juego', 'juego', `<div class="wrap">
      <div class="bleed rv"><img src="${asset(j.img)}" alt="" loading="lazy" width="1400" height="933"></div>
      <div class="cap-body">
        <div class="rv"><p class="eyebrow work">${esc(t(j.eyebrow))}</p><h2 class="cap-lines">${esc(t(j.title))}</h2>
          <p class="lbl-line">${esc(t(j.label))}</p><p class="cap-text">${esc(t(j.text))}</p>
          <div class="tags" style="margin-top:18px"><span class="tag work">${esc(t(j.estado))}</span></div></div>
        <dl class="qdd rv">${j.qdd.map(x => `<div><dt>${esc(t(x.k))}</dt><dd>${esc(t(x.v))}</dd></div>`).join('')}</dl>
      </div></div>`);
  },
  experiencia(o) {
    const x = o.experiencia;
    const jugado = pulseCount(o.id) > 0;
    return sec(o, 'experiencia', 'juego', `<div class="wrap">
      <div class="exp rv">
        <div class="shot"><img src="${asset(x.img)}" alt="" loading="lazy" width="633" height="1126"></div>
        <div class="body"><p class="eyebrow work">${esc(t(x.eyebrow))}</p><h2 style="font-size:clamp(1.7rem,4.5vw,2.6rem)">${esc(t(x.title))}</h2>
          <p class="cap-text" style="margin-top:0">${esc(t(x.text))}</p>
          ${t(SITE.pulse.idioma) ? `<p class="small muted">${esc(t(SITE.pulse.idioma))}</p>` : ''}
          <button type="button" class="btn primary" data-act="pulse" data-cta="jugar">${I.play} ${esc(t(x.cta))}</button></div>
      </div>
      <div id="exp-q">${jugado ? reactHTML(o, x.pregunta, 'experiencia') : `<div class="react waiting"><p class="eyebrow">${esc(t(x.pregunta.eyebrow))}</p><p class="muted">${esc(t(x.antes))}</p></div>`}</div>
    </div>`);
  },
  historia(o) {
    return sec(o, 'historia', 'obra', `<div class="wrap"><div class="cap-body" style="margin-top:0">
      <div class="rv"><p class="eyebrow work">${esc(t(SITE.obra.historia))}</p><p class="lead" style="color:var(--fg)">${esc(t(o.story))}</p>
        <p class="incompleta">${esc(t(SITE.obra.incompleta))}</p></div>
      <div class="rv">${reactHTML(o, sectionQs(o, 'historia'), 'historia')}</div>
    </div></div>`);
  },
  voto(o) { return sec(o, 'voto', 'votar', `<div class="wrap rv" id="vote-box">${voteInner(o)}</div>`); },
  seguir(o) { return sec(o, 'seguir', 'votar', `<div class="wrap follow" id="follow-box">${followInner(o)}</div>`); },
  hasta(o) {
    const x = totals(o);
    return sec(o, 'hasta', 'comunidad', `<div class="wrap">
      <div class="rv"><p class="eyebrow work">${esc(t(SITE.hasta.eyebrow))}</p><h2>${esc(t(SITE.hasta.title))}</h2></div>
      <ol class="tl rv">${o.hasta.map(h => {
        const k = { hecho: SITE.hasta.hecho, ahora: SITE.hasta.ahora, proximo: SITE.hasta.proximo, despues: SITE.hasta.despues }[h.estado];
        const extra = h.estado === 'proximo' ? `${meterHTML(o, 'work')}<div class="meter-txt"><span><b>${fmt(x.com)}</b> / ${fmt(x.meta)}</span><span class="sample">${esc(t(SITE.ficha.ejemplo))}</span></div>` : '';
        return `<li class="${h.estado}"><div class="k">${esc(t(k))}</div><div class="t">${esc(t(h.t))}</div><div class="d">${esc(t(h.d))}</div>${extra}</li>`; }).join('')}</ol>
      <div class="devol rv"><p class="eyebrow">${esc(t(SITE.hasta.devolucion))}</p><p>${esc(t(SITE.hasta.devolucion_txt))}</p>
        ${isFollowing(o.id) ? '' : `<button type="button" class="btn sm" style="margin-top:14px" data-act="follow" data-via="hasta_ahora" data-cta="seguir_hasta_ahora">${I.heart} ${esc(t(SITE.hasta.seguir_cta))}</button>`}</div>
    </div>`);
  },
  conversacion(o) { return sec(o, 'conversacion', 'comunidad', `<div class="wrap" id="conv-box">${convInner(o)}</div>`); },
  creditos(o) {
    return sec(o, 'creditos', 'comunidad', `<div class="wrap"><p class="eyebrow work rv">${esc(t(SITE.creditos.eyebrow))}</p>
      <ul class="cred rv">${o.creditos.map(c => `<li><div><b>${esc(c.nombre)}</b><span>${esc(t(c.rol))}</span></div>${c.imdb ? `<a href="${esc(c.imdb)}" target="_blank" rel="noopener" data-ext="imdb_equipo" aria-label="IMDb ${esc(c.nombre)}">IMDb</a>` : ''}</li>`).join('')}</ul></div>`, 'tight');
  },
  finales(o) {
    const ic = SITE.industria_card, cc = SITE.creadores_card;
    return sec(o, 'finales', 'comunidad', `<div class="wrap endcards">
      <div class="endcard rv" data-section="industria_card"><h3>${esc(t(ic.title, { obra: o.title }))}</h3><p>${esc(t(ic.text))}</p>
        <div class="row"><button type="button" class="btn sm" data-act="sheet" data-sheet="industria" data-cta="industria_card">${esc(t(ic.cta))} ${I.right}</button></div></div>
      <div class="endcard rv" data-section="creadores_card"><h3>${esc(t(cc.title))}</h3><p>${esc(t(cc.text, { obra: o.title }))}</p>
        <div class="row"><button type="button" class="btn sm" data-act="sheet" data-sheet="creadores" data-proposito="invitacion" data-cta="creadores_card">${esc(t(cc.cta))} ${I.right}</button>
          ${o.modo === 'completa' ? `<button type="button" class="textbtn" data-act="sheet" data-sheet="creadores" data-proposito="proceso" data-cta="proceso_card">${esc(t(cc.cta2))}</button>` : ''}</div></div>
    </div>`, 'tight');
  }
};
function capHTML(o, c, id) {
  const sp = c.spotify ? `<div class="spotify" id="spot-${id}">
      <button type="button" class="btn sm" data-act="spotify" data-cta="spotify_cargar">${I.play} ${esc(t(c.spotify.cargar))}</button>
      <a class="btn sm ghost" href="${esc(c.spotify.url)}" target="_blank" rel="noopener" data-ext="spotify" data-cta="spotify_abrir">${esc(t(c.spotify.abrir))} ${I.ext}</a>
      <p class="small muted" style="flex-basis:100%">${esc(t(c.spotify.nota))}</p></div>` : '';
  const media = id === 'musica'
    ? `<figure class="figure rv" style="margin:0;aspect-ratio:1/1"><img src="${asset(c.img)}" alt="${esc(t(c.img_alt))}" loading="lazy" width="900" height="900"></figure>${c.img_caption ? `<p class="figcap">${esc(t(c.img_caption))}</p>` : ''}`
    : `<div class="bleed rv"><img src="${asset(c.img)}" alt="${esc(t(c.img_alt))}" loading="lazy" width="1376" height="768"></div>`;
  const text = `<div class="rv"><p class="eyebrow work">${esc(t(c.eyebrow))}</p>
      <h2 class="cap-lines">${c.lineas.map(l => `<span>${esc(t(l))}</span>`).join('')}</h2>
      <p class="cap-text">${esc(t(c.text))}</p>
      <div class="tags">${c.chips.map(x => `<span class="tag">${esc(t(x))}</span>`).join('')}</div>${sp}</div>`;
  const body = id === 'musica'
    ? `<div class="wrap split rev"><div>${media}</div><div>${text}${reactHTML(o, sectionQs(o, id), id)}</div></div>`
    : `<div class="wrap">${media}<div class="cap-body">${text}<div class="rv">${reactHTML(o, sectionQs(o, id), id)}</div></div></div>`;
  return sec(o, id, id, body, 'cap');
}
function voteInner(o) {
  const x = totals(o), V = SITE.voto;
  const voted = isVoted(o.id), pend = pendingFor('voto', o.id);
  const v = flags(o.id).voto;
  let action;
  if (voted) {
    action = `<div class="done">${I.check} ${esc(t(nivel() === 'profesional' ? V.hecho_esp : V.hecho))}</div>
      ${v.comentario ? `<p class="mycomment">“${esc(v.comentario)}”</p>` : ''}
      <div class="after">
        <button type="button" class="btn sm" data-act="share" data-cta="compartir">${I.share} ${esc(t(V.compartir, { obra: o.title }))}</button>
        ${isFollowing(o.id) ? '' : `<button type="button" class="btn sm" data-act="follow" data-via="post_voto" data-cta="seguir_post_voto">${I.heart} ${esc(t(SITE.seguir.cta, { obra: o.title }))}</button>`}
        <button type="button" class="textbtn" data-act="withdraw">${esc(t(V.retirar))}</button></div>`;
  } else if (pend) {
    action = `<p class="note" style="margin:22px auto 0;text-align:left">${LANG === 'es' ? 'Falta confirmar tu email para que tu voto cuente.' : 'Confirm your email so your vote counts.'}</p>
      <button type="button" class="btn primary" data-act="sheet" data-sheet="code" data-cta="ingresar_codigo">${LANG === 'es' ? 'Ingresar el código' : 'Enter the code'}</button>`;
  } else {
    action = `<button type="button" class="btn primary" data-act="vote" data-via="bloque" data-cta="votar_bloque">${I.vote} ${esc(t(V.cta))}</button>`;
  }
  return `<div class="vote" id="vote-card">
    <p class="eyebrow work">${esc(t(V.eyebrow))}</p>
    <h2>${esc(t(V.title, { obra: o.title }))}</h2>
    <p class="sub">${esc(t(V.sub))}</p>
    ${action}
    <div class="counts"><div class="count"><b>${fmt(x.com)}</b><span>${esc(t(V.comunidad))}</span></div><div class="count"><b>${fmt(x.esp)}</b><span>${esc(t(V.especialistas))}</span></div></div>
    <div class="meter-wrap">${meterHTML(o, 'work')}<div class="meter-txt"><span>${esc(t(V.meta, { n: fmt(x.com), meta: fmt(x.meta), hito: t(o.hito) }))}</span></div>
      <p class="note2">${esc(t(V.nota))} <span class="sample">· ${esc(t(SITE.ficha.ejemplo))}</span></p></div>
  </div>`;
}
function followInner(o) {
  const F = SITE.seguir, on = isFollowing(o.id), pend = pendingFor('seguir', o.id);
  const b = o.backstage;
  const btn = on
    ? `<button type="button" class="btn" data-act="follow" data-via="bloque" data-cta="seguir_bloque" aria-pressed="true">${I.heartF} ${esc(t(SITE.obra.siguiendo))}</button>`
    : pend ? `<button type="button" class="btn primary" data-act="sheet" data-sheet="code">${esc(t(SITE.obra.pendiente))}</button>`
    : `<button type="button" class="btn primary" data-act="follow" data-via="bloque" data-cta="seguir_bloque" aria-pressed="false">${I.heart} ${esc(t(F.cta, { obra: o.title }))}</button>`;
  return `<div class="rv"><p class="eyebrow work">${esc(t(F.eyebrow))}</p><h2>${esc(t(F.title, { obra: o.title }))}</h2>
      <p class="cap-text">${esc(t(F.text))}</p>
      <div class="row">${btn}${on ? `<button type="button" class="textbtn" data-act="unfollow">${esc(t(F.dejar))}</button>` : ''}</div>
      ${on ? `<label class="switch"><input type="checkbox" data-act="mails" ${wantsMails(o.id) ? 'checked' : ''}> ${esc(t(F.mails, { obra: o.title }))}</label>
        <p class="small muted">${esc(t(wantsMails(o.id) ? F.mails_on : F.mails_off))}</p>` : ''}</div>
    <div class="locked ${on ? '' : 'is-locked'} rv" data-lock="${o.id}">
      <div class="img"><img src="${asset(b.img)}" alt="" loading="lazy" width="1000" height="558"></div>
      <div class="lock">${I.lock}<span class="eyebrow" style="margin:0">${esc(t(F.bloqueado))}</span>
        <button type="button" class="btn sm primary" data-act="follow" data-via="premio" data-cta="premio_bloqueado">${esc(t(F.bloqueado_cta))}</button></div>
      <div class="cap"><p class="eyebrow" style="margin:0">${esc(t(on ? F.desbloqueado : F.bloqueado))}</p><h3 style="margin-top:6px">${esc(t(b.t))}</h3>${on ? `<p>${esc(t(b.d))}</p>` : ''}</div>
    </div>`;
}
function convInner(o) {
  const C = SITE.conversacion;
  const seeds = (o.comentarios || []).map(c => ({ nombre: c.nombre, texto: t(c.texto), seed: true }));
  const mine = S.comentarios.filter(c => c.obra === o.id && (c.estado === 'publicado' || c.cuenta === S.cuenta) && c.estado !== 'rechazado');
  const items = seeds.map(c => `<li class="cmt"><span class="av">${esc(c.nombre[0])}</span><div><div class="by"><b>${esc(c.nombre)}</b><span>${esc(t(C.ejemplo))}</span></div><p>${esc(c.texto)}</p></div></li>`)
    .concat(mine.map(c => { const yo = c.cuenta && c.cuenta === S.cuenta; const who = yo ? t(C.tu) : (LANG === 'es' ? 'Participante' : 'Member');
      return `<li class="cmt ${yo ? 'me' : ''}"><span class="av">${esc(who[0].toUpperCase())}</span><div><div class="by"><b>${esc(who)}</b>${c.voto ? `<span class="vt">✓ ${esc(t(C.voto))}</span>` : ''}${c.estado === 'pendiente' ? `<span>${esc(t(C.revision))}</span>` : ''}</div><p>${esc(c.texto)}</p></div></li>`; }));
  return `<div class="rv"><p class="eyebrow work">${esc(t(C.eyebrow))}</p><h2>${esc(t(C.title))}</h2><p class="cap-text">${esc(t(C.text))}</p></div>
    <ul class="clist" data-cmts="${o.id}">${items.join('')}</ul>
    <form class="composer" data-form="comentar" novalidate>
      <label class="sr" for="cmp">${esc(t(C.ph))}</label>
      <textarea id="cmp" name="texto" maxlength="144" placeholder="${esc(t(C.ph))}" data-act="compose"></textarea>
      <div class="cfoot"><span class="small muted">${esc(t(C.nota))}</span><span class="counter" id="cmp-n">0 / 144</span>
        <button type="submit" class="btn sm primary" data-cta="comentar">${esc(t(C.publicar))}</button></div>
    </form>`;
}
function pieObraHTML(o) {
  return `<footer class="o-foot" data-section="pie"><div class="wrap">
    <div><div class="part"><img src="${asset('logo-qantica.webp')}" alt="QANTICA" width="480" height="77"><span class="eyebrow" style="margin:0">${esc(t(SITE.obra.parte))}</span></div>
      <p style="margin-top:12px">${esc(LANG === 'es' ? `Qantica acompaña el desarrollo de ${o.title} con su proceso de curaduría de historias. Aquí puedes entrar en ese mundo: descubrir la historia, participar y seguir su próximo capítulo.` : `Qantica supports the development of ${o.title} through its story curation process. Here, you can step into that world: discover the story, take part and follow its next chapter.`)}</p></div>
    <nav aria-label="Pie">
      <a class="btn sm ghost" href="${catalogoUrl()}" data-act="volver" data-cta="volver_pie">${I.left} ${esc(t(SITE.obra.volver))}</a>
      <a class="btn sm ghost" href="https://qantica.com" target="_blank" rel="noopener" data-ext="qantica" data-cta="explorar_qantica">${esc(t(SITE.qantica.cta))} ${I.ext}</a>
      <button type="button" class="textbtn" data-act="sheet" data-sheet="talento">${esc(t(SITE.rutas.talento.t))}</button>
      <button type="button" class="textbtn" data-act="sheet" data-sheet="privacidad">${esc(t(SITE.pie.privacidad))}</button>
      <button type="button" class="textbtn" data-act="sheet" data-sheet="proto">${esc(t(SITE.proto.chip))}</button>
    </nav></div></footer>`;
}
function pillHTML(o) {
  const voted = isVoted(o.id), on = isFollowing(o.id);
  return `<div class="pill is-away" id="pill" role="toolbar" aria-label="${esc(o.title)}">
    <button type="button" class="pill-chap" data-act="sheet" data-sheet="capitulos" data-cta="pill_capitulos" aria-label="${esc(t(SITE.obra.capitulos))}">
      <svg class="ring" viewBox="0 0 36 36" aria-hidden="true"><circle class="trk" cx="18" cy="18" r="15"/><circle class="val" id="ring-val" cx="18" cy="18" r="15" stroke-dasharray="94.25" stroke-dashoffset="94.25"/><text id="ring-n" x="18" y="22" text-anchor="middle">1</text></svg>
      <span class="pill-lbl" id="pill-lbl">${esc(t(o.nav[0].label))}</span></button>
    <button type="button" class="pill-btn follow" data-act="follow" data-via="pill" data-cta="seguir_pill" aria-pressed="${on}" aria-label="${esc(t(on ? SITE.obra.siguiendo : SITE.obra.seguir))}" id="pill-follow">${on ? I.heartF : I.heart}</button>
    <button type="button" class="pill-btn vote ${voted ? 'is-done' : ''}" data-act="${voted ? 'goto-id' : 'vote'}" data-target="sec-voto" data-via="pill" data-cta="votar_pill" aria-label="${esc(t(voted ? SITE.obra.votaste : SITE.obra.votar))}" id="pill-vote" ${voted || S.sesion.vistos['pillvote:' + o.id] ? '' : 'hidden'}>${voted ? I.check : I.vote}<span class="pill-lbl">${esc(t(voted ? SITE.obra.votaste : SITE.obra.votar))}</span></button>
  </div>`;
}

/* ================= refresco parcial ================= */
function rerender(id) {
  if (!OBRA) return;
  const el = document.getElementById('sec-' + id);
  if (!el || !SECTIONS[id]) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = SECTIONS[id](OBRA);
  const nuevo = tmp.firstElementChild;
  $$('.rv', nuevo).forEach(x => x.classList.add('in'));
  el.replaceWith(nuevo);
  animateBars(nuevo);
  observeAll(nuevo);
}
function refreshChrome() {
  if (OBRA) {
    const h = $('#hdr-follow'); if (h) h.outerHTML = followBtnHdr(OBRA);
    const p = $('#pill'); if (p) { const away = p.classList.contains('is-away'); const tmp = document.createElement('div'); tmp.innerHTML = pillHTML(OBRA); const np = tmp.firstElementChild; if (!away) np.classList.remove('is-away'); p.replaceWith(np); updatePill(true); }
  } else {
    const a = $('.hdr-actions'); if (a) a.innerHTML = listaBtn() + langToggle();
    const f = $('#ficha'); if (f) f.innerHTML = fichaHTML(OBRAS[CAR_IDX]);
    const m = $('#mine'); if (m) m.innerHTML = mineHTML();
    const g = $('#grid'); if (g) { g.innerHTML = gridHTML(); observeAll(g); }
    $$('.car-slide').forEach((s, i) => { const b = $('.poster-btn', s); if (b) { b.innerHTML = posterHTML(OBRAS[i], { vt: i === CAR_IDX ? 'poster-' + OBRAS[i].id : '' }); } });
  }
}
function animateBars(root) {
  requestAnimationFrame(() => $$('.res .bar i', root || document).forEach(i => { i.style.width = i.dataset.w + '%'; }));
}
function flash(el) { if (!el) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
function scrollToEl(el, block) { if (el) el.scrollIntoView({ behavior: SMOOTH, block: block || 'start' }); }

/* ================= reacciones ================= */
function answer(qid, opt, pos, sec) {
  const o = OBRA, q = findQ(o, qid); if (!q) return;
  const k = qkey(q);
  markViewed('pregunta', o.id + '|' + k, () => track('pregunta_vista', { pregunta: k, seccion: sec, forzada: true }));
  const t0 = S.sesion.visto_ts[o.id + '|' + k];
  myRx(o.id)[k] = { opcion: opt, posicion: +pos, ts: now() };
  track('reaccion', { pregunta: k, seccion: sec, opcion: opt, posicion: +pos, mostradas: S.sesion.orden[k] || null, t_resp_ms: t0 ? now() - t0 : null });
  save(); rerender(sec);
  const box = $('#rx-' + o.id + '-' + sec); if (box) flash(box);
}
function setStack(sec, i) { const st = S.sesion.stack || (S.sesion.stack = {}); st[OBRA.id + ':' + sec] = i; }
function skip(qid, sec) {
  const o = OBRA, q = findQ(o, qid); if (!q) return;
  myRx(o.id)[qkey(q)] = { saltada: true, ts: now() };
  track('reaccion_saltada', { pregunta: qkey(q), seccion: sec });
  const qs = sectionQs(o, sec), i = qs.findIndex(x => x.id === qid);
  if (i >= 0 && i < qs.length - 1) setStack(sec, i + 1);
  save(); rerender(sec);
}
function unskip(qid, sec) {
  const o = OBRA, q = findQ(o, qid); if (!q) return;
  delete myRx(o.id)[qkey(q)];
  const i = sectionQs(o, sec).findIndex(x => x.id === qid); if (i >= 0) setStack(sec, i);
  save(); rerender(sec);
}
function stackNext(sec) {
  const qs = sectionQs(OBRA, sec), st = S.sesion.stack || (S.sesion.stack = {}), key = OBRA.id + ':' + sec;
  st[key] = Math.min((st[key] || 0) + 1, qs.length - 1);
  save(); rerender(sec);
  const box = $('#rx-' + OBRA.id + '-' + sec); if (box) { box.scrollIntoView({ block: 'nearest', behavior: SMOOTH }); flash(box); }
}

/* ================= voto ================= */
function openVote(via) {
  const o = OBRA;
  if (isVoted(o.id)) { scrollToEl($('#sec-voto'), 'center'); return; }
  track('voto_inicio', { via });
  if (pendingFor('voto', o.id)) { openSheet('code'); return; }
  openSheet('voto', { via });
}
function confirmVote(o, comentario, via) {
  const a = acctObra(o.id);
  if (!a) return 'sin_cuenta';
  if (a.voto && a.voto.estado === 'confirmado') { track('voto_rechazado', { motivo: 'ya_voto', via }); return 'ya_voto'; }
  a.voto = { estado: 'confirmado', comentario: comentario || '', ts: now(), via };
  if (comentario) S.comentarios.push({ id: rid('m'), obra: o.id, cuenta: S.cuenta, texto: comentario, ts: now(), estado: 'pendiente', voto: true });
  track('voto_confirmado', { via, con_comentario: !!comentario, largo: (comentario || '').length });
  if (comentario) track('comentario_enviado', { largo: comentario.length, con_voto: true });
  save();
  rerender('voto'); rerender('conversacion'); rerender('hasta'); refreshChrome();
  return 'ok';
}
function withdrawVote() {
  const o = OBRA, a = acctObra(o.id); if (!a || !a.voto) return;
  const prev = a.voto;
  a.voto = { estado: 'retirado', ts: now() };
  track('voto_retirado', {});
  save(); rerender('voto'); rerender('hasta'); refreshChrome();
  toast(t(SITE.voto.retirado), { label: t(SITE.toast.deshacer), fn: () => { a.voto = prev; track('voto_restaurado', {}); save(); rerender('voto'); rerender('hasta'); refreshChrome(); } });
}

/* ================= seguir ================= */
function followAction(via) {
  const o = OBRA;
  if (isFollowing(o.id)) { if (via === 'bloque' || via === 'premio') return; unfollow(via); return; }
  track('follow_inicio', { via });
  if (acct()) { doFollow(o, via, null); toast(t(SITE.seguir.hecho, { obra: o.title })); return; }
  if (pendingFor('seguir', o.id)) { openSheet('code'); return; }
  openSheet('seguir', { via });
}
function doFollow(o, via, mails) {
  const a = acctObra(o.id); if (!a) return;
  a.follow = { estado: 'siguiendo', ts: now(), via };
  if (mails != null) { a.mails = !!mails; track(mails ? 'mails_alta' : 'mails_baja', { via }); }
  track('follow_confirmado', { via, mails: !!a.mails });
  if (S.sesion.vistos['premio:' + o.id]) track('premio_desbloqueado', {});
  save(); rerender('seguir'); rerender('hasta'); rerender('voto'); refreshChrome();
}
function unfollow(via) {
  const o = OBRA, a = acctObra(o.id); if (!a) return;
  const prev = a.follow;
  a.follow = { estado: 'baja', ts: now(), via };
  track('follow_baja', { via });
  save(); rerender('seguir'); rerender('hasta'); rerender('voto'); refreshChrome();
  toast(t(SITE.seguir.dejaste, { obra: o.title }), { label: t(SITE.toast.deshacer), fn: () => { a.follow = prev; track('follow_confirmado', { via: 'deshacer', mails: !!a.mails }); save(); rerender('seguir'); rerender('hasta'); rerender('voto'); refreshChrome(); } });
}
function setMails(on) {
  const o = OBRA, a = acctObra(o.id); if (!a) return;
  a.mails = !!on; track(on ? 'mails_alta' : 'mails_baja', { via: 'bloque' }); save(); rerender('seguir');
}

/* ================= comentarios ================= */
function postComment(texto) {
  const o = OBRA;
  texto = (texto || '').trim().slice(0, 144);
  if (!texto) { const ta = $('#cmp'); if (ta) ta.focus(); return; }
  if (!acct()) { openSheet('comentario', { texto }); return; }
  S.comentarios.push({ id: rid('m'), obra: o.id, cuenta: S.cuenta, texto, ts: now(), estado: 'pendiente', voto: isVoted(o.id) });
  track('comentario_enviado', { largo: texto.length, con_voto: isVoted(o.id) });
  save(); rerender('conversacion'); toast(t(SITE.conversacion.hecho));
}

/* ================= compartir, Spotify, avisos ================= */
async function share() {
  const o = OBRA;
  let url;
  try { const u = new URL(obraUrl(o.id), location.href); u.searchParams.set('ref', 'share'); u.searchParams.set('from', S.visitante); url = u.href; } catch (_) { url = location.href; }
  const data = { title: o.title + ' · Qantica Showcase', text: t(SITE.voto.compartir_txt), url };
  if (navigator.share) {
    try { await navigator.share(data); track('compartir', { canal: 'nativo', ok: true }); }
    catch (e) { track('compartir', { canal: 'nativo', ok: false }); }
    return;
  }
  try { await navigator.clipboard.writeText(url); toast(t(SITE.toast.copiado)); track('compartir', { canal: 'copiar', ok: true }); }
  catch (_) { toast(url); track('compartir', { canal: 'copiar', ok: false }); }
}
function loadSpotify() {
  const c = OBRA.capitulos.find(x => x.spotify); if (!c) return;
  const box = $('#spot-' + c.id); if (!box) return;
  box.outerHTML = `<div class="spotify-frame"><iframe title="Spotify · Xina Mora" src="${esc(c.spotify.embed)}" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe></div>`;
  track('media_cargar', { proveedor: 'spotify' });
}
function toast(msg, action) {
  const box = $('#toasts'); if (!box) return;
  const el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button type="button">${esc(action.label)}</button>` : '');
  if (action) el.querySelector('button').addEventListener('click', () => { action.fn(); el.remove(); });
  box.appendChild(el);
  setTimeout(() => el.remove(), action ? 6500 : 3800);
}

/* ================= hojas (dialog) e historial ================= */
let SHEET = null;
let HIST = 0, SKIP_POP = 0;
function pushHist() { try { history.pushState({ qsc: 1 }, ''); HIST++; } catch (_) {} }
function popHistIfNeeded() { if (HIST > 0 && history.state && history.state.qsc) { HIST--; SKIP_POP++; try { history.back(); } catch (_) { SKIP_POP--; } } }
window.addEventListener('popstate', () => {
  if (SKIP_POP) { SKIP_POP--; return; }
  const d = ['#pulse', '#panel', '#sheet'].map(s => $(s)).find(x => x && x.open);
  if (d) { HIST = Math.max(0, HIST - 1); d.dataset.viaPop = '1'; d.close(); }
});
function wireDialog(d, onClose) {
  d.addEventListener('close', () => { if (d.dataset.viaPop) delete d.dataset.viaPop; else popHistIfNeeded(); onClose && onClose(); });
  d.addEventListener('click', e => { if (e.target === d) d.close(); });
}
function openModal(d) { if (!d.open) { d.showModal(); pushHist(); } }

const DISPOSABLE = ['mailinator.com', '10minutemail.com', 'guerrillamail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com', 'getnada.com', 'sharklasers.com', 'dispostable.com', 'maildrop.cc', 'fakeinbox.com', 'throwawaymail.com', 'mintemail.com', 'emailondeck.com'];
function checkEmail(v) {
  v = (v || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return 'err_email';
  const dom = v.split('@')[1];
  if (DISPOSABLE.some(d => dom === d || dom.endsWith('.' + d))) return 'err_desechable';
  return null;
}
const RUTAS = { industria: 1, creadores: 1, talento: 1 };
function rutaDe(kind, ctx) { return kind === 'creadores' && ctx && ctx.proposito === 'proceso' ? 'proceso' : kind; }

function openSheet(kind, ctx) {
  ctx = ctx || {};
  const d = $('#sheet');
  SHEET = { kind, ctx, step: kind === 'code' ? 'code' : 'form', err: {}, vals: {}, started: false };
  if (kind === 'code' && S.pendiente) SHEET.kind = S.pendiente.motivo;
  renderSheet();
  openModal(d);
  track('hoja_abierta', { hoja: kind });
  if (RUTAS[kind]) track('form_abierto', { ruta: rutaDe(kind, ctx) });
  focusFirst();
}
function focusFirst() {
  if (DEVICE !== 'escritorio') return;
  const el = $('#sheet .codein') || $('#sheet .sheet-bd input:not([type=checkbox]):not([type=radio]), #sheet .sheet-bd textarea, #sheet .sheet-bd select');
  if (el) setTimeout(() => el.focus({ preventScroll: true }), 60);
}
function closeSheet() { const d = $('#sheet'); if (d && d.open) d.close(); }
function sheetShell(title, body, foot, formName) {
  const inner = `<div class="sheet-bd">${body}</div>${foot ? `<div class="sheet-ft">${foot}</div>` : ''}`;
  return `<div class="grab" aria-hidden="true"></div>
    <div class="sheet-hd"><h2 id="sheet-title">${title}</h2><button type="button" class="x" data-act="sheet-close" aria-label="${LANG === 'es' ? 'Cerrar' : 'Close'}">${I.x}</button></div>
    ${formName ? `<form class="sheet-form" data-form="${formName}" novalidate>${inner}</form>` : inner}`;
}
function fieldHTML(name, label, opts) {
  opts = opts || {};
  const err = SHEET.err[name] ? `<p class="errmsg" id="err-${name}">${esc(SHEET.err[name])}</p>` : '';
  const val = SHEET.vals[name] != null ? SHEET.vals[name] : (opts.value || '');
  const aria = SHEET.err[name] ? `aria-invalid="true" aria-describedby="err-${name}"` : '';
  let ctrl;
  if (opts.type === 'textarea') ctrl = `<textarea class="textarea" id="f-${name}" name="${name}" ${opts.max ? `maxlength="${opts.max}"` : ''} placeholder="${esc(opts.ph || '')}" ${aria} ${opts.counter ? 'data-counter="1"' : ''}>${esc(val)}</textarea>${opts.counter ? `<span class="counter" data-for="f-${name}">${val.length} / ${opts.max}</span>` : ''}`;
  else if (opts.type === 'select') ctrl = `<select class="select" id="f-${name}" name="${name}" ${aria}><option value="">${LANG === 'es' ? 'Elige una opción' : 'Choose an option'}</option>${opts.options.map(x => `<option value="${esc(x.v)}" ${val === x.v ? 'selected' : ''}>${esc(t(x))}</option>`).join('')}</select>`;
  else ctrl = `<input class="input ${opts.cls || ''}" id="f-${name}" name="${name}" type="${opts.type || 'text'}" value="${esc(val)}" placeholder="${esc(opts.ph || '')}" ${opts.auto ? `autocomplete="${opts.auto}"` : ''} ${opts.inputmode ? `inputmode="${opts.inputmode}"` : ''} ${opts.max ? `maxlength="${opts.max}"` : ''} ${aria}>`;
  return `<div class="field ${SHEET.err[name] ? 'err' : ''}"><label for="f-${name}">${esc(label)}${opts.optional ? `<small>${esc(t(SITE.forms.opcional))}</small>` : ''}</label>${ctrl}${opts.help ? `<p class="help">${esc(opts.help)}</p>` : ''}${err}</div>`;
}
function checksHTML(name, label, options, selected, err) {
  return `<fieldset class="fieldset ${err ? 'err' : ''}"><legend>${esc(label)}</legend><div class="checks">${options.map(x => `<label class="check"><input type="checkbox" name="${name}" value="${esc(x.v)}" ${selected.includes(x.v) ? 'checked' : ''}> ${esc(t(x))}</label>`).join('')}</div>${err ? `<p class="errmsg">${esc(err)}</p>` : ''}</fieldset>`;
}
function consentHTML() {
  const err = SHEET.err.consent ? `<p class="errmsg">${esc(SHEET.err.consent)}</p>` : '';
  return `<label class="consent"><input type="checkbox" name="consent" ${SHEET.vals.consent ? 'checked' : ''}> <span>${esc(t(SITE.verif.consent))} <button type="button" class="link" data-act="privacy-inline" style="font-size:inherit">${esc(t(SITE.pie.privacidad))}</button></span></label>${err}<p class="small muted privacy-inline" hidden>${esc(t(SITE.pie.privacidad_txt))}</p>`;
}
function emailBlock() {
  return fieldHTML('email', t(SITE.verif.email), { type: 'email', ph: t(SITE.verif.email_ph), auto: 'email', inputmode: 'email', help: t(SITE.verif.email_ayuda) }) + consentHTML();
}

function renderSheet() {
  const d = $('#sheet'); if (!d || !SHEET) return;
  d.classList.toggle('wide', SHEET.kind === 'industria');
  const o = OBRA;
  const V = SITE.voto, F = SITE.seguir, C = SITE.conversacion, VF = SITE.verif, FM = SITE.forms;
  let html = '';
  const k = SHEET.kind, st = SHEET.step;
  if (st === 'code') html = codeStep();
  else if (k === 'voto' && st === 'form') {
    html = sheetShell(esc(t(V.sheet_title, { obra: o.title })),
      `<p class="muted">${esc(t(V.sub))}</p>
       ${fieldHTML('comentario', t(V.comentario), { type: 'textarea', max: 144, ph: t(V.comentario_ph), counter: true, optional: false })}
       ${acct() ? `<p class="acct">${esc(t(SITE.tulista.niveles[nivel()]))}: <b>${esc(acct().email)}</b></p>` : emailBlock()}`,
      `<button type="submit" class="btn primary block">${I.vote} ${esc(acct() ? t(V.confirmar) : t(VF.enviar))}</button>`, 'voto');
  } else if (k === 'voto' && st === 'ok') {
    html = sheetShell('', `<div class="success"><div class="big">${I.check}</div><h2>${esc(t(nivel() === 'profesional' ? V.hecho_esp : V.hecho))}</h2>
        <p>${esc(t(V.meta, { n: fmt(totals(o).com), meta: fmt(o.votos.meta), hito: t(o.hito) }))}</p></div>
        ${isFollowing(o.id) ? '' : `<div class="acct"><b>${esc(t(V.seguir_tambien, { obra: o.title }))}</b><p class="small muted" style="margin-top:6px">${esc(t(F.text))}</p>
          <button type="button" class="btn primary" style="margin-top:12px" data-act="follow" data-via="post_voto" data-cta="seguir_post_voto">${I.heart} ${esc(t(F.cta, { obra: o.title }))}</button></div>`}`,
      `<button type="button" class="btn" data-act="share" data-cta="compartir_post_voto">${I.share} ${esc(t(V.compartir, { obra: o.title }))}</button><button type="button" class="btn ghost" data-act="sheet-close">${esc(t(FM.cerrar))}</button>`);
  } else if (k === 'voto' && st === 'ya_voto') {
    html = sheetShell(esc(t(V.sheet_title, { obra: o.title })), `<p class="lead">${LANG === 'es' ? `Este email ya votó por ${esc(o.title)}. Un voto por persona y por obra.` : `This email has already voted for ${esc(o.title)}. One vote per person per story.`}</p>`,
      `<button type="button" class="btn ghost block" data-act="sheet-close">${esc(t(FM.cerrar))}</button>`);
  } else if (k === 'seguir' && st === 'form') {
    html = sheetShell(esc(t(F.sheet_title, { obra: o.title })),
      `<p class="muted">${esc(t(F.text))}</p>${emailBlock()}
       <label class="consent"><input type="checkbox" name="mails" ${SHEET.vals.mails ? 'checked' : ''}> <span>${esc(t(F.mails, { obra: o.title }))}</span></label>`,
      `<button type="submit" class="btn primary block">${esc(t(VF.enviar))}</button>`, 'seguir');
  } else if (k === 'seguir' && st === 'ok') {
    html = sheetShell('', `<div class="success"><div class="big">${I.heartF}</div><h2>${esc(t(F.hecho, { obra: o.title }))}</h2><p>${esc(t(F.text))}</p></div>`,
      `<button type="button" class="btn primary block" data-act="goto-premio">${LANG === 'es' ? 'Ver lo que está para seguidores' : 'See the followers-only piece'}</button>`);
  } else if (k === 'comentario' && st === 'form') {
    html = sheetShell(esc(t(C.title)),
      `${fieldHTML('texto', LANG === 'es' ? 'Tu comentario' : 'Your comment', { type: 'textarea', max: 144, value: SHEET.ctx.texto || '', counter: true })}
       <p class="muted small">${esc(t(C.nota))}</p>${emailBlock()}`,
      `<button type="submit" class="btn primary block">${esc(t(VF.enviar))}</button>`, 'comentario');
  } else if (k === 'comentario' && st === 'ok') {
    html = sheetShell('', `<div class="success"><div class="big">${I.check}</div><h2>${esc(t(C.hecho))}</h2></div>`, `<button type="button" class="btn ghost block" data-act="sheet-close">${esc(t(FM.cerrar))}</button>`);
  } else if (RUTAS[k] && st === 'form') html = rutaForm(k);
  else if (RUTAS[k] && st === 'ok') {
    html = sheetShell('', `<div class="success"><div class="big">${I.check}</div><h2>${esc(t(FM.recibido_title))}</h2><p>${esc(t(FM.recibido_txt))}</p>
        <p class="small muted" style="margin-top:10px">${LANG === 'es' ? 'Referencia' : 'Reference'}: ${esc(SHEET.solId || '')}</p></div>
        ${k === 'industria' ? `<p class="disclaimer">${esc(t(FM.industria.nota_esp))}</p>` : ''}`,
      `<button type="button" class="btn ghost block" data-act="sheet-close">${esc(t(FM.cerrar))}</button>`);
  } else if (k === 'lista') html = listaSheet();
  else if (k === 'capitulos') html = capSheet();
  else if (k === 'proto') html = protoSheet();
  else if (k === 'privacidad') html = sheetShell(esc(t(SITE.pie.privacidad)), `<p class="lead">${esc(t(SITE.pie.privacidad_txt))}</p>`, `<button type="button" class="btn ghost block" data-act="sheet-close">${esc(t(FM.cerrar))}</button>`);
  d.innerHTML = html;
  if (SHEET.err && Object.keys(SHEET.err).length) { const f = $('.field.err, .fieldset.err, .errmsg', d); if (f) f.scrollIntoView({ block: 'center' }); }
  if (!$('#sheet-title', d) || !$('#sheet-title', d).textContent) d.setAttribute('aria-label', 'Qantica Showcase'); else d.removeAttribute('aria-label');
}
function codeStep() {
  const p = S.pendiente, VF = SITE.verif;
  if (!p) return sheetShell('', `<p class="muted">s/d</p>`, '');
  const err = SHEET.err.code ? `<p class="errmsg" id="err-code">${esc(SHEET.err.code)}</p>` : '';
  return sheetShell(esc(t(VF.code_title)),
    `<p>${esc(t(VF.code_txt, { email: p.email }))}</p>
     <div class="codebox">${esc(t(VF.code_proto))} <b>${esc(p.codigo)}</b></div>
     <div class="field ${SHEET.err.code ? 'err' : ''}"><label for="f-code">${esc(t(VF.code_label))}</label>
       <input class="input codein" id="f-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" ${SHEET.err.code ? 'aria-invalid="true" aria-describedby="err-code"' : ''}>${err}</div>
     <div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="textbtn" data-act="code-back">${esc(t(VF.code_otro))}</button><button type="button" class="textbtn" data-act="code-resend">${esc(t(VF.code_reenviar))}</button></div>`,
    `<button type="submit" class="btn primary block">${esc(t(VF.code_ok))}</button>`, 'code');
}
function rutaForm(k) {
  const FM = SITE.forms, e = SHEET.err, ctx = SHEET.ctx;
  const obraOpts = OBRAS.map(o => ({ v: o.id, es: o.title, en: o.title }));
  const sel = SHEET.vals.obras || (OBRA ? [OBRA.id] : []);
  let body = '', title = '';
  if (k === 'industria') {
    const X = FM.industria; title = t(X.title);
    body = `<p class="muted">${esc(t(X.intro))}</p>
      ${fieldHTML('nombre', t(FM.nombre), { auto: 'name' })}${fieldHTML('email', t(FM.email), { type: 'email', auto: 'email', inputmode: 'email' })}
      ${fieldHTML('rol', t(X.rol), { type: 'select', options: X.roles })}${fieldHTML('empresa', t(X.empresa), { auto: 'organization' })}
      ${fieldHTML('territorio', t(X.territorio), { type: 'select', options: X.territorios })}
      ${checksHTML('interes', t(X.interes), X.intereses, SHEET.vals.interes || [], e.interes)}
      ${checksHTML('obras', t(X.obras), obraOpts, sel, e.obras)}
      ${fieldHTML('perfil', t(X.perfil), { type: 'url', ph: t(X.perfil_ph), optional: true, inputmode: 'url' })}
      ${fieldHTML('mensaje', t(X.mensaje), { type: 'textarea', max: 600, optional: true })}
      <p class="disclaimer">${esc(t(X.nota_esp))}</p>${consentHTML()}`;
  } else if (k === 'creadores') {
    const X = FM.creadores; title = t(X.title);
    const prop = SHEET.vals.proposito || ctx.proposito || 'invitacion';
    body = `<fieldset class="fieldset"><legend>${esc(t(X.proposito))}</legend><div class="checks">${X.propositos.map(p => `<label class="check"><input type="radio" name="proposito" value="${p.v}" ${prop === p.v ? 'checked' : ''} data-act="proposito"> ${esc(t(p))}</label>`).join('')}</div></fieldset>
      ${fieldHTML('nombre', t(FM.nombre), { auto: 'name' })}${fieldHTML('email', t(FM.email), { type: 'email', auto: 'email', inputmode: 'email' })}
      ${fieldHTML('proyecto', t(X.proyecto), { ph: t(X.proyecto_ph), optional: prop === 'proceso' })}
      ${fieldHTML('logline', t(X.logline), { type: 'textarea', max: 300, optional: true })}
      ${fieldHTML('perfil', t(X.perfil), { type: 'url', optional: true, inputmode: 'url' })}
      <p class="disclaimer">${esc(t(X.disclaimer))}</p>${consentHTML()}`;
  } else {
    const X = FM.talento; title = t(X.title);
    body = `${fieldHTML('nombre', t(FM.nombre), { auto: 'name' })}${fieldHTML('email', t(FM.email), { type: 'email', auto: 'email', inputmode: 'email' })}
      ${fieldHTML('especialidad', t(X.especialidad), { type: 'select', options: X.especialidades })}
      ${fieldHTML('portfolio', t(X.portfolio), { type: 'url', optional: true, inputmode: 'url' })}
      ${fieldHTML('proyecto', t(X.proyecto), { type: 'select', options: [{ v: 'general', es: X.general.es, en: X.general.en }].concat(obraOpts), value: OBRA ? OBRA.id : 'general' })}
      ${consentHTML()}`;
  }
  return sheetShell(esc(title), body, `<button type="submit" class="btn primary block">${esc(t(FM.enviar))}</button>`, 'ruta-' + k);
}
function listaSheet() {
  const L = SITE.tulista, a = acct();
  const seguidas = OBRAS.filter(o => isFollowing(o.id)), votadas = OBRAS.filter(o => isVoted(o.id));
  const row = o => `<a href="${obraUrl(o.id)}" data-act="open-obra" data-obra="${o.id}" data-origen="tu_lista"><img src="${asset(o.poster)}" alt="" style="object-position:${o.poster_pos}"><div><b>${esc(o.title)}</b><span>${esc(t(wantsMails(o.id) ? L.mails_si : L.mails_no))}</span></div></a>`;
  return sheetShell(esc(t(L.title)),
    `<div class="acct">${a ? `<b>${esc(a.email)}</b><br>${esc(t(L.niveles[a.nivel]))} · ${esc(t(L.cuenta))}` : esc(t(L.anon))}</div>
     <p class="eyebrow" style="margin-top:18px">${esc(t(L.siguiendo))}</p>
     ${seguidas.length ? `<div class="list-rows">${seguidas.map(row).join('')}</div>` : `<p class="muted">${esc(t(L.vacio))}</p>`}
     ${votadas.length ? `<p class="eyebrow" style="margin-top:18px">${esc(t(L.votos))}</p><div class="list-rows">${votadas.map(o => `<a href="${obraUrl(o.id)}" data-act="open-obra" data-obra="${o.id}" data-origen="tu_lista"><img src="${asset(o.poster)}" alt="" style="object-position:${o.poster_pos}"><div><b>${esc(o.title)}</b><span>✓ ${esc(t(SITE.ficha.votaste))}</span></div></a>`).join('')}</div>` : ''}`,
    `<button type="button" class="btn ghost block" data-act="sheet-close">${esc(t(SITE.forms.cerrar))}</button>`);
}
function capSheet() {
  const cur = CUR_NAV;
  const seen = n => S.sesion.vistos['nav:' + OBRA.id + ':' + n];
  return sheetShell(esc(t(SITE.obra.capitulos)), `<div class="chaplist">${OBRA.nav.map((n, i) => `<button type="button" class="${n.id === cur ? 'on' : seen(n.id) ? 'seen' : ''}" data-act="goto-nav" data-nav="${n.id}" data-cta="pill_capitulo"><span>${i + 1}</span>${esc(t(n.label))}</button>`).join('')}</div>`, '');
}
function protoSheet() {
  const P = SITE.proto;
  return sheetShell(esc(t(P.title)), `<ul style="margin:0;padding-left:20px;display:grid;gap:10px;color:var(--fg-2)">${P.items.map(x => `<li>${esc(t(x))}</li>`).join('')}</ul>
    <p class="small muted">${LANG === 'es' ? 'Atajos: tecla S o tres toques en el logo abren el panel de datos. ?tema=marca prueba el dorado de marca.' : 'Shortcuts: the S key or three taps on the logo open the data panel. ?tema=marca tries the brand gold.'}</p>`,
    `<button type="button" class="btn primary" data-act="panel">${esc(t(P.panel))}</button><button type="button" class="btn ghost" data-act="reset" id="btn-reset">${esc(t(P.reset))}</button>`);
}

/* envío de formularios de las hojas */
function onSheetSubmit(form) {
  const name = form.dataset.form;
  const fd = new FormData(form);
  const v = k => (fd.get(k) || '').toString().trim();
  SHEET.vals = { comentario: v('comentario'), texto: v('texto'), email: v('email'), consent: !!fd.get('consent'), mails: !!fd.get('mails'),
    nombre: v('nombre'), rol: v('rol'), empresa: v('empresa'), territorio: v('territorio'), interes: fd.getAll('interes'), obras: fd.getAll('obras'),
    perfil: v('perfil'), mensaje: v('mensaje'), proposito: v('proposito'), proyecto: v('proyecto'), logline: v('logline'), especialidad: v('especialidad'), portfolio: v('portfolio') };
  SHEET.err = {};
  const VF = SITE.verif;
  if (name === 'code') { checkCode(v('code')); return; }
  if (name === 'voto' || name === 'seguir' || name === 'comentario') {
    if (name === 'comentario' && !v('texto')) SHEET.err.texto = t(SITE.forms.requerido);
    if (!(name === 'voto' && acct())) {
      const ce = checkEmail(v('email')); if (ce) SHEET.err.email = t(VF[ce]);
      if (!fd.get('consent')) SHEET.err.consent = t(VF.err_consent);
    }
    if (Object.keys(SHEET.err).length) { track('verif_error', { motivo: SHEET.err.email ? (checkEmail(v('email')) === 'err_desechable' ? 'email_desechable' : 'email_invalido') : 'sin_consentimiento', hoja: name }); renderSheet(); return; }
    if (name === 'voto' && acct()) {
      const r = confirmVote(OBRA, v('comentario'), SHEET.ctx.via || 'bloque');
      SHEET.step = r === 'ya_voto' ? 'ya_voto' : 'ok'; renderSheet(); return;
    }
    startVerify(v('email'), name, name === 'voto' ? { comentario: v('comentario'), via: SHEET.ctx.via } : name === 'seguir' ? { mails: !!fd.get('mails'), via: SHEET.ctx.via } : { texto: v('texto') });
    return;
  }
  if (name.startsWith('ruta-')) submitRuta(name.slice(5), fd);
}
function startVerify(email, motivo, datos) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  S.pendiente = { email: email.trim().toLowerCase(), codigo: code, motivo, obra: OBRA ? OBRA.id : null, datos: datos || {}, creado: now(), expira: now() + 10 * 60 * 1000, intentos: 0 };
  if (motivo === 'voto') track('voto_pendiente', { con_comentario: !!(datos && datos.comentario) });
  if (motivo === 'seguir') track('follow_pendiente', { mails: !!(datos && datos.mails) });
  track('verif_iniciada', { motivo });
  save();
  SHEET.kind = motivo; SHEET.step = 'code'; SHEET.err = {};
  renderSheet(); focusFirst();
  if (OBRA) { rerender('voto'); rerender('seguir'); refreshChrome(); }
}
function linkAccount(email, motivo) {
  const cid = 'c_' + hash(email);
  const nueva = !S.cuentas[cid];
  if (nueva) S.cuentas[cid] = { email, nivel: 'verificado', creada: now(), obras: {} };
  S.cuenta = cid; S.vinculos[S.visitante] = cid;
  const n = countReactions(S.visitante);
  track('verif_ok', { motivo, cuenta_nueva: nueva });
  track('cuenta_vinculada', { reacciones_vinculadas: n });
  save();
  return { cid, nueva, n };
}
function checkCode(code) {
  const p = S.pendiente;
  if (!p || p.expira < now()) { track('verif_error', { motivo: 'codigo_vencido' }); SHEET.err.code = LANG === 'es' ? 'El código venció. Pide otro.' : 'The code expired. Request another one.'; renderSheet(); return; }
  p.intentos++;
  if (String(code).replace(/\D/g, '') !== p.codigo) {
    track('verif_error', { motivo: 'codigo_incorrecto', intentos: p.intentos });
    SHEET.err.code = t(SITE.verif.err_code); save(); renderSheet(); focusFirst(); return;
  }
  const r = linkAccount(p.email, p.motivo);
  const o = obraById(p.obra) || OBRA;
  S.pendiente = null; save();
  let res = 'ok';
  if (p.motivo === 'voto') res = confirmVote(o, p.datos.comentario, p.datos.via || 'bloque');
  else if (p.motivo === 'seguir') doFollow(o, p.datos.via || 'bloque', !!p.datos.mails);
  else if (p.motivo === 'comentario') {
    S.comentarios.push({ id: rid('m'), obra: o.id, cuenta: S.cuenta, texto: p.datos.texto, ts: now(), estado: 'pendiente', voto: isVoted(o.id) });
    track('comentario_enviado', { largo: (p.datos.texto || '').length, con_voto: isVoted(o.id) }); save(); rerender('conversacion');
    const ta = $('#cmp'); if (ta) ta.value = '';
  }
  SHEET.kind = p.motivo; SHEET.step = res === 'ya_voto' ? 'ya_voto' : 'ok'; SHEET.err = {};
  renderSheet();
  if (r.n) toast(t(SITE.verif.ligadas, { n: r.n }));
  if (OBRA) { rerender('voto'); rerender('seguir'); }
  refreshChrome();
}
function submitRuta(k, fd) {
  const FM = SITE.forms, e = SHEET.err, V = SHEET.vals, req = t(FM.requerido);
  const ruta = k === 'creadores' ? (V.proposito === 'proceso' ? 'proceso' : 'creadores') : k;
  if (!V.nombre) e.nombre = req;
  const ce = checkEmail(V.email); if (ce) e.email = t(SITE.verif[ce]);
  if (k === 'industria') { if (!V.rol) e.rol = req; if (!V.empresa) e.empresa = req; if (!V.territorio) e.territorio = req; if (!V.interes.length) e.interes = req; if (!V.obras.length) e.obras = req; }
  if (k === 'creadores' && ruta === 'creadores' && !V.proyecto) e.proyecto = req;
  if (k === 'talento' && !V.especialidad) e.especialidad = req;
  ['perfil', 'portfolio'].forEach(f => { if (V[f] && !/^https?:\/\/\S+\.\S+/.test(V[f])) e[f] = LANG === 'es' ? 'Pega un enlace completo, con https://' : 'Paste a full link, with https://'; });
  if (!V.consent) e.consent = t(SITE.verif.err_consent);
  if (Object.keys(e).length) { track('form_error', { ruta, campos: Object.keys(e) }); renderSheet(); return; }
  const campos = { nombre: V.nombre, email: V.email.toLowerCase(), rol: V.rol, empresa: V.empresa, territorio: V.territorio, interes: V.interes, obras: k === 'talento' ? [V.proyecto] : V.obras,
    perfil: V.perfil, mensaje: V.mensaje, proposito: V.proposito, proyecto: V.proyecto, logline: V.logline, especialidad: V.especialidad, portfolio: V.portfolio };
  const huella = hash(JSON.stringify(campos));
  const dup = S.solicitudes.find(s => s.huella === huella && now() - s.ts < 60000);
  if (dup) { SHEET.solId = dup.id; track('form_enviado', { ruta, id: dup.id, reintento: true }); }
  else {
    const id = 'r_' + String(S.solicitudes.length + 1).padStart(3, '0');
    S.solicitudes.push({ id, ruta, obras: campos.obras.filter(Boolean), ts: now(), estado: 'recibida', huella, campos });
    SHEET.solId = id;
    track('form_enviado', { ruta, id, rol: V.rol || null, territorio: V.territorio || null, interes: V.interes, obras: campos.obras.filter(Boolean), especialidad: V.especialidad || null, con_perfil: !!(V.perfil || V.portfolio) });
  }
  save(); SHEET.step = 'ok'; renderSheet();
}

/* ================= Pulse a pantalla completa ================= */
let PULSE = null;
function openPulse() {
  const o = OBRA, x = o.experiencia, d = $('#pulse');
  if (PULSE && PULSE.timer) clearTimeout(PULSE.timer);
  PULSE = { t0: now(), loaded: false };
  d.innerHTML = `<div class="pulse-bar"><span>${esc(o.title)} · ${LANG === 'es' ? 'La experiencia' : 'The experience'}</span>
    <button type="button" class="btn sm" data-act="pulse-close">${I.x} ${esc(t(SITE.pulse.cerrar))}</button></div>
    <div class="pulse-body"><div class="pulse-load" id="pulse-load"><div class="spin"></div><span>${esc(t(SITE.pulse.cargando))}</span></div></div>`;
  const ifr = document.createElement('iframe');
  ifr.title = o.title + ' · QIP Games';
  ifr.setAttribute('allow', 'autoplay; fullscreen');
  ifr.src = x.url;
  ifr.addEventListener('load', () => { if (!PULSE || PULSE.loaded) return; PULSE.loaded = true; setTimeout(() => { const l = $('#pulse-load'); if (l) l.remove(); }, 1200); track('pulse_cargado', { ms: now() - PULSE.t0 }); });
  $('.pulse-body', d).appendChild(ifr);
  openModal(d);
  track('pulse_abrir', {});
  PULSE.timer = setTimeout(() => {
    if (PULSE && !PULSE.loaded) {
      track('pulse_error', { tipo: 'timeout' });
      const l = $('#pulse-load');
      if (l) l.innerHTML = `<span>${LANG === 'es' ? 'La experiencia tarda en cargar.' : 'The experience is taking a while to load.'}</span><button type="button" class="btn sm" data-act="pulse-retry">${LANG === 'es' ? 'Reintentar' : 'Retry'}</button>`;
    }
  }, 20000);
}
function onPulseClose() {
  const d = $('#pulse'); const ifr = $('iframe', d); if (ifr) ifr.remove(); /* quitar el iframe es lo único que corta el audio */
  if (!PULSE) return;
  clearTimeout(PULSE.timer);
  const ms = now() - PULSE.t0, loaded = PULSE.loaded; PULSE = null;
  const p = S.pulse[S.visitante] || (S.pulse[S.visitante] = {});
  const x = p[OBRA.id] || (p[OBRA.id] = { veces: 0 }); x.veces++; x.ultimo = now();
  track('pulse_cerrar', { ms_abierto: ms, cargado: loaded });
  save(); rerender('experiencia');
  setTimeout(() => { const q = $('#exp-q'); if (q) { scrollToEl(q, 'center'); flash(q.firstElementChild); } }, 120);
}
window.addEventListener('message', e => {
  if (!OBRA || !OBRA.experiencia || e.origin !== OBRA.experiencia.origin) return;
  const ifr = $('#pulse iframe'); if (ifr && e.source !== ifr.contentWindow) return;
  const m = e.data; if (!m || m.src !== 'qantica-pulse') return;
  track('pulse_evento', { pev: String(m.ev).slice(0, 40), datos: m.data || null });
});

/* ================= navegación ================= */
let LAST_Y = 0, SCROLL_TICK = false, CUR_NAV = null, PILL_IDLE = null, INPUT_FOCUS = false;
function onScroll() {
  if (SCROLL_TICK) return; SCROLL_TICK = true;
  requestAnimationFrame(() => {
    SCROLL_TICK = false;
    const y = window.scrollY, h = $('#hdr');
    if (h) {
      const busy = !!$('dialog[open]') || h.contains(document.activeElement);
      if (y < 120 || y < LAST_Y - 6) h.classList.remove('is-hidden');
      else if (y > LAST_Y + 6 && !busy) h.classList.add('is-hidden');
    }
    LAST_Y = y;
    if (OBRA) { updatePill(); compactPill(); }
  });
}
function updatePill() {
  const p = $('#pill'); if (!p) return;
  const y = window.scrollY, H = document.documentElement.scrollHeight - innerHeight;
  p.classList.toggle('is-away', y < innerHeight * 0.45 || INPUT_FOCUS);
  const ring = $('#ring-val'); if (ring) ring.style.strokeDashoffset = (94.25 * (1 - (H > 0 ? clamp(y / H, 0, 1) : 0))).toFixed(2);
  if (CUR_NAV) paintNav(CUR_NAV);
}
function compactPill() {
  const p = $('#pill'); if (!p) return;
  p.classList.add('is-compact'); clearTimeout(PILL_IDLE);
  PILL_IDLE = setTimeout(() => { const q = $('#pill'); if (q) q.classList.remove('is-compact'); }, 450);
}
function paintNav(id) {
  const i = OBRA.nav.findIndex(n => n.id === id); if (i < 0) return;
  const lbl = $('#pill-lbl'); if (lbl) lbl.textContent = (i + 1) + '/' + OBRA.nav.length + ' · ' + t(OBRA.nav[i].label);
  const n = $('#ring-n'); if (n) n.textContent = i + 1;
  $$('#rail button').forEach(b => {
    const on = b.dataset.nav === id;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    if (S.sesion.vistos['nav:' + OBRA.id + ':' + b.dataset.nav]) b.classList.add('seen');
  });
}
function setNav(id) {
  if (!OBRA || id === CUR_NAV) return;
  CUR_NAV = id;
  const key = 'nav:' + OBRA.id + ':' + id;
  if (!S.sesion.vistos[key]) S.sesion.vistos[key] = now();
  paintNav(id);
  const i = OBRA.nav.findIndex(n => n.id === id);
  const unlock = OBRA.modo === 'completa' ? OBRA.nav.findIndex(n => n.id === 'juego') : 0;
  if (i >= unlock) {
    const v = $('#pill-vote');
    if (v && v.hidden) { v.hidden = false; v.classList.add('pop'); }
    if (!S.sesion.vistos['pillvote:' + OBRA.id]) S.sesion.vistos['pillvote:' + OBRA.id] = now();
  }
  save();
}
function gotoNav(id) { const el = $('section[data-nav="' + id + '"]'); if (el) scrollToEl(el); }
let IO_NAV = null, IO_RV = null, IO_EXP = null;
const TIMERS = new Map();
function initNavObserver() {
  if (!OBRA || !('IntersectionObserver' in window)) return;
  IO_NAV = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) setNav(en.target.dataset.nav); }), { rootMargin: '-45% 0px -54% 0px' });
  $$('section[data-nav]').forEach(s => IO_NAV.observe(s));
}
function initReveal(root) {
  root = root || document;
  if (REDUCED || !('IntersectionObserver' in window)) { $$('.rv', root).forEach(e => e.classList.add('in')); return; }
  if (!IO_RV) IO_RV = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); IO_RV.unobserve(en.target); } }), { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
  $$('.rv:not(.in)', root).forEach(e => IO_RV.observe(e));
}

/* exposición: visible (50 % del elemento o media pantalla) durante 0,9 s, una vez por sesión */
const DWELL = 900;
function exposures(el) {
  const out = [], ob = OBRA ? OBRA.id : 'cat';
  if (el.dataset.section) out.push({ k: 'sec:' + ob + ':' + el.dataset.section, f: () => track('seccion_vista', { seccion: el.dataset.section }) });
  if (el.dataset.cta) out.push({ k: 'cta:' + ob + ':' + el.dataset.cta, f: () => track('cta_vista', { cta: el.dataset.cta }) });
  if (el.dataset.card) { const [lista, id] = el.dataset.card.split(':'); out.push({ k: 'card:' + lista + ':' + id, f: () => track('poster_visto', { obra: id, lista, posicion: +el.dataset.pos }) }); }
  if (el.dataset.react) { const [oid, qk] = el.dataset.react.split('|'); out.push({ k: 'pregunta:' + oid + '|' + qk, f: () => { S.sesion.visto_ts[oid + '|' + qk] = now(); track('pregunta_vista', { pregunta: qk, seccion: el.dataset.seccion }); } }); }
  if (el.dataset.lock) out.push({ k: 'premio:' + el.dataset.lock, f: () => track('premio_visto', { estado: isFollowing(el.dataset.lock) ? 'desbloqueado' : 'bloqueado' }) });
  if (el.dataset.cmts) out.push({ k: 'cmts:' + el.dataset.cmts, f: () => track('conversacion_vista', {}) });
  return out;
}
function markViewed(type, id, fire) { return once(type + ':' + id, fire); }
function initExposure() {
  if (!('IntersectionObserver' in window)) return;
  IO_EXP = new IntersectionObserver(entries => entries.forEach(en => {
    const el = en.target;
    const ok = en.isIntersecting && (en.intersectionRatio >= 0.5 || en.intersectionRect.height >= innerHeight * 0.5) && document.visibilityState === 'visible';
    if (ok) { if (!TIMERS.has(el)) TIMERS.set(el, setTimeout(() => { TIMERS.delete(el); if (el.isConnected) exposures(el).forEach(x => once(x.k, x.f)); }, DWELL)); }
    else if (TIMERS.has(el)) { clearTimeout(TIMERS.get(el)); TIMERS.delete(el); }
  }), { threshold: [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.75, 1] });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') { TIMERS.forEach(clearTimeout); TIMERS.clear(); }
    else if (IO_EXP) { IO_EXP.disconnect(); observeAll(document); }
  });
}
function observeAll(root) {
  root = root || document;
  const sel = '[data-section],[data-cta],[data-card],[data-react],[data-lock],[data-cmts]';
  if (IO_EXP) { $$(sel, root).forEach(el => IO_EXP.observe(el)); if (root !== document && root.matches && root.matches(sel)) IO_EXP.observe(root); }
  if (IO_NAV && root !== document && root.matches && root.matches('section[data-nav]')) IO_NAV.observe(root);
  initReveal(root);
}

/* carrusel: scroll-snap nativo; el cambio de obra se confirma cuando el scroll se asienta */
let CAR_VIA = null, CAR_SETTLE = null;
function carCenter(i) { const tr = $('#car-track'), s = $$('.car-slide', tr)[i]; return s.offsetLeft - (tr.clientWidth - s.clientWidth) / 2; }
function carVisual(i) {
  $$('.car-slide').forEach((s, k) => { s.classList.toggle('is-active', k === i); s.classList.toggle('is-left', k < i); s.classList.toggle('is-right', k > i); });
  $$('#car-prog i').forEach((b, k) => b.classList.toggle('on', k === i));
  const c = $('#car-count'); if (c) c.innerHTML = `<b>${String(i + 1).padStart(2, '0')}</b> / ${String(OBRAS.length).padStart(2, '0')}`;
}
function carCommit(i, via) {
  const prev = CAR_IDX; CAR_IDX = i; carVisual(i);
  $$('.car-slide .poster').forEach((p, k) => { p.style.viewTransitionName = k === i ? 'poster-' + OBRAS[k].id : 'none'; });
  if (prev === i) return;
  const f = $('#ficha');
  if (f) { f.classList.add('is-swapping'); setTimeout(() => { f.innerHTML = fichaHTML(OBRAS[i]); f.classList.remove('is-swapping'); observeAll(f); }, 140); }
  track('carrusel_cambio', { de: OBRAS[prev].id, a: OBRAS[i].id, via: via || 'swipe' });
}
function carGo(i, via) {
  const n = OBRAS.length; i = (i + n) % n; CAR_VIA = via;
  const tr = $('#car-track'); if (!tr) return;
  tr.scrollTo({ left: carCenter(i), behavior: SMOOTH });
  if (REDUCED) { carCommit(i, via); CAR_VIA = null; }
}
function initCarousel() {
  const tr = $('#car-track'); if (!tr) return;
  tr.scrollLeft = carCenter(CAR_IDX); carVisual(CAR_IDX);
  let tick = false;
  tr.addEventListener('scroll', () => {
    if (tick) return; tick = true;
    requestAnimationFrame(() => {
      tick = false;
      const mid = tr.scrollLeft + tr.clientWidth / 2; let best = 0, bd = 1e9;
      $$('.car-slide', tr).forEach((s, i) => { const d = Math.abs(s.offsetLeft + s.clientWidth / 2 - mid); if (d < bd) { bd = d; best = i; } });
      carVisual(best);
      clearTimeout(CAR_SETTLE);
      CAR_SETTLE = setTimeout(() => { carCommit(best, CAR_VIA || 'swipe'); CAR_VIA = null; }, 140);
    });
  }, { passive: true });
  tr.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') { e.preventDefault(); carGo(CAR_IDX + 1, 'teclado'); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); carGo(CAR_IDX - 1, 'teclado'); }
  });
  if (!CAR_RESIZE) { CAR_RESIZE = true; window.addEventListener('resize', () => { const t2 = $('#car-track'); if (t2) t2.scrollLeft = carCenter(CAR_IDX); }, { passive: true }); }
}

/* ================= panel de datos (tecla S, tres toques en el logo o ?panel=1) ================= */
let PANEL_TAB = 'comunidad';
function openPanel(tab) { if (tab) PANEL_TAB = tab; closeSheet(); renderPanel(); openModal($('#panel')); track('panel_abierto', { pestana: PANEL_TAB }); }
const ph = s => `<p class="panel-h">${esc(s)}</p>`;
const pnote = s => `<p class="panel-note">${esc(s)}</p>`;
const kpis = arr => `<div class="kpis">${arr.map(([v, l]) => `<div class="kpi"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>`;
function tbl(head, rows, raw) {
  if (!rows.length) return pnote('Sin datos todavía.');
  return `<div style="overflow-x:auto"><table class="tbl"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td class="${typeof c === 'number' ? 'n' : ''}">${raw ? c : esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
const rowsOf = o => Object.entries(o).sort((a, b) => b[1] - a[1]);
function report() {
  const L = S.log;
  const sesSet = pred => new Set(L.filter(pred).map(e => e.sesion));
  const pk = e => e.pagina === 'obra' ? 'obra:' + e.obra : 'catalogo';
  const pvs = L.filter(e => e.ev === 'pagina_vista');
  const first = {}; pvs.forEach(e => { if (!first[e.sesion]) first[e.sesion] = e; });
  const tally = (arr, f) => { const m = {}; arr.forEach(e => { const k = f(e); const kk = k == null || k === '' ? 's/d' : k; m[kk] = (m[kk] || 0) + 1; }); return m; };
  return { L, sesSet, pk, pvs, firsts: Object.values(first), tally, sesiones: new Set(L.map(e => e.sesion).filter(Boolean)), visitantes: new Set(L.map(e => e.visitante)) };
}
const PANEL_VIEWS = {
  audiencia(R) {
    const ret = R.firsts.filter(e => e.visita > 1).length;
    return kpis([[R.visitantes.size, 'Visitantes anónimos (tickets)'], [R.sesiones.size, 'Sesiones (visitas)'], [R.pvs.length, 'Vistas de página'], [Object.keys(S.cuentas).length, 'Cuentas verificadas'], [pct(ret, R.firsts.length), 'Sesiones de retorno']])
      + ph('Origen de cada sesión') + tbl(['Origen', 'Sesiones'], rowsOf(R.tally(R.firsts, e => e.origen)))
      + ph('Primera página de la sesión') + tbl(['Entrada', 'Sesiones'], rowsOf(R.tally(R.firsts, e => R.pk(e))))
      + ph('Dispositivo') + tbl(['Dispositivo', 'Sesiones'], rowsOf(R.tally(R.firsts, e => e.dispositivo)))
      + ph('Idioma') + tbl(['Idioma', 'Sesiones'], rowsOf(R.tally(R.firsts, e => e.idioma)))
      + pnote('Una sesión es una visita y se renueva tras 30 minutos sin actividad. Un visitante es el ticket anónimo del navegador: no identifica a una persona.');
  },
  contenido(R) {
    let html = '';
    [...new Set(R.pvs.map(R.pk))].forEach(p => {
      const sp = R.sesSet(e => e.ev === 'pagina_vista' && R.pk(e) === p).size;
      const secs = []; R.L.forEach(e => { if (e.ev === 'seccion_vista' && R.pk(e) === p && !secs.includes(e.seccion)) secs.push(e.seccion); });
      html += ph('Alcance por sección · ' + p) + tbl(['Sección', 'Sesiones que la alcanzaron / de la página', 'Alcance'],
        secs.map(s => { const n = R.sesSet(e => e.ev === 'seccion_vista' && R.pk(e) === p && e.seccion === s).size; return [s, n + ' / ' + sp, pct(n, sp)]; }));
    });
    const ctas = [...new Set(R.L.filter(e => e.ev === 'cta_vista' || e.ev === 'cta_click').map(e => e.cta))];
    html += ph('Uso de cada acción') + tbl(['Acción', 'La vieron', 'La tocaron', 'Uso'], ctas.map(c => { const v = R.sesSet(e => e.ev === 'cta_vista' && e.cta === c).size, k = R.sesSet(e => e.ev === 'cta_click' && e.cta === c).size; return [c, v, k, pct(k, v)]; }));
    const durs = R.L.filter(e => e.ev === 'pulse_cerrar').map(e => e.ms_abierto);
    html += ph('Experiencia (Pulse)') + kpis([[R.L.filter(e => e.ev === 'pulse_abrir').length, 'Aperturas'], [R.L.filter(e => e.ev === 'pulse_cargado').length, 'Cargas completas'], [R.L.filter(e => e.ev === 'pulse_error').length, 'Errores de carga'], [durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length / 1000) + ' s' : 's/d', 'Tiempo medio abierto'], [R.L.filter(e => e.ev === 'pulse_evento').length, 'Eventos del Pulse']])
      + pnote('Las respuestas, finales y rejuegos del Pulse llegan a este log cuando el Pulse publicado emita postMessage: es un cambio chico en su plantilla, pendiente.');
    html += ph('Medios y salidas') + tbl(['Destino', 'Clics'], rowsOf(R.tally(R.L.filter(e => e.ev === 'salida_externa'), e => e.destino)).concat([['Spotify cargado', R.L.filter(e => e.ev === 'media_cargar').length]]));
    return html;
  },
  comunidad(R) {
    const act = OBRAS.filter(o => R.L.some(e => e.obra === o.id && e.pagina === 'obra'));
    let html = pnote('Lo anónimo es contexto; lo verificado cuenta; lo profesional pesa. Las respuestas dadas en menos de 1 s desde que la pregunta se vio se marcan y quedan fuera del conteo.');
    if (!act.length) return html + pnote('Todavía no hay actividad en ninguna obra.');
    act.forEach(o => {
      const x = totals(o);
      let reales = 0, esp = 0; Object.values(S.cuentas).forEach(c => { const v = c.obras[o.id] && c.obras[o.id].voto; if (v && v.estado === 'confirmado') { reales++; if (c.nivel === 'profesional') esp++; } });
      const seg = Object.values(S.cuentas).filter(c => c.obras[o.id] && c.obras[o.id].follow && c.obras[o.id].follow.estado === 'siguiendo').length;
      const mails = Object.values(S.cuentas).filter(c => c.obras[o.id] && c.obras[o.id].mails).length;
      const vio = R.sesSet(e => e.ev === 'cta_vista' && e.obra === o.id && /^votar_/.test(e.cta)).size;
      const voto = R.sesSet(e => e.ev === 'voto_confirmado' && e.obra === o.id).size;
      const sp = R.sesSet(e => e.ev === 'pagina_vista' && e.pagina === 'obra' && e.obra === o.id).size;
      const sr = R.sesSet(e => e.ev === 'reaccion' && e.obra === o.id).size;
      const sf = R.sesSet(e => e.ev === 'follow_confirmado' && e.obra === o.id).size;
      html += `<h3 style="margin-top:26px">${esc(o.title)}</h3>` + kpis([[fmt(x.com), 'Comunidad (ejemplo + real)'], [fmt(x.esp), 'Especialistas (ejemplo + real)'], [reales + ' (' + esp + ' esp.)', 'Votos reales en este navegador'], [voto + ' / ' + vio, 'Votaron / vieron el botón de voto'], [seg, 'Seguidores'], [mails, 'Con novedades por email']]);
      const mx = Math.max(1, sp);
      html += ph('Recorrido del loop (sesiones)') + `<div class="funnel">${[['Vieron la obra', sp], ['Reaccionaron', sr], ['Votaron', voto], ['Siguieron', sf]].map(([k, v]) => `<div><span>${k}</span><i style="width:${(v * 100 / mx).toFixed(0)}%"></i><span class="n">${v}</span></div>`).join('')}</div>`;
      const qs = [...new Set(R.L.filter(e => /^(pregunta_vista|reaccion|reaccion_saltada)$/.test(e.ev) && e.obra === o.id).map(e => e.pregunta))];
      const rows = qs.map(q => {
        const ex = R.sesSet(e => e.ev === 'pregunta_vista' && e.obra === o.id && e.pregunta === q).size;
        const rs = R.L.filter(e => e.ev === 'reaccion' && e.obra === o.id && e.pregunta === q);
        const ok = rs.filter(e => !(e.t_resp_ms != null && e.t_resp_ms < 1000));
        const okS = new Set(ok.map(e => e.sesion)).size;
        const sk = R.L.filter(e => e.ev === 'reaccion_saltada' && e.obra === o.id && e.pregunta === q).length;
        const dist = R.tally(ok, e => e.opcion), pos = R.tally(ok, e => 'pos' + e.posicion);
        return [q, okS + ' / ' + ex, pct(okS, ex), sk, rs.length - ok.length, Object.entries(dist).map(([k, v]) => k + ' ' + v).join(' · ') || 's/d', Object.entries(pos).map(([k, v]) => k + ' ' + v).join(' · ') || 's/d'];
      });
      if (rows.length) html += ph('Preguntas') + tbl(['Pregunta@versión', 'Respondieron / vieron', 'Tasa', 'Saltadas', 'Rápidas (fuera)', 'Opciones', 'Posición en pantalla'], rows);
      const cs = S.comentarios.filter(c => c.obra === o.id);
      if (cs.length) html += ph('Comentarios') + tbl(['Texto', 'Con voto', 'Estado', 'Moderar'], cs.map(c => [esc(c.texto), c.voto ? 'sí' : 'no', esc(c.estado), c.estado === 'pendiente' ? `<button type="button" class="btn sm" data-act="moderar" data-id="${c.id}" data-res="publicado">Aprobar</button> <button type="button" class="btn sm ghost" data-act="moderar" data-id="${c.id}" data-res="rechazado">Rechazar</button>` : 's/d']), true);
    });
    return html;
  },
  solicitudes(R) {
    const rows = ['industria', 'creadores', 'proceso', 'talento'].map(r => {
      const ab = R.L.filter(e => e.ev === 'form_abierto' && e.ruta === r).length, ini = R.L.filter(e => e.ev === 'form_iniciado' && e.ruta === r).length;
      const env = R.L.filter(e => e.ev === 'form_enviado' && e.ruta === r && !e.reintento).length, er = R.L.filter(e => e.ev === 'form_error' && e.ruta === r).length;
      return [r, ab, ini, env, pct(env, ini), er];
    });
    const list = S.solicitudes.slice().reverse().map(s => [s.id, fecha(s.ts), s.ruta, (s.obras || []).join(', ') || 's/d', s.campos.rol || s.campos.proposito || s.campos.especialidad || 's/d', s.campos.territorio || 's/d', s.estado]);
    const campos = rowsOf(R.tally(R.L.filter(e => e.ev === 'form_error').flatMap(e => (e.campos || []).map(c => ({ c: e.ruta + ' · ' + c }))), x => x.c));
    return ph('Por ruta') + tbl(['Ruta', 'Abiertos', 'Iniciados', 'Enviados', 'Enviados / iniciados', 'Envíos con error'], rows)
      + ph('Solicitudes recibidas') + tbl(['Ref.', 'Fecha', 'Ruta', 'Obras', 'Rol o propósito', 'Territorio', 'Estado'], list)
      + ph('Errores por campo') + tbl(['Ruta · campo', 'Veces'], campos)
      + pnote('Una solicitud acredita recepción: no es un cliente, una puja ni una venta. Los emails no entran en el log de eventos.');
  },
  funcionamiento(R) {
    const kb = Math.round(JSON.stringify(S).length / 1024);
    const last = R.L.slice(-30).reverse().map(e => [new Date(e.ts).toLocaleTimeString(), e.ev, e.obra || 's/d', String(e.seccion || e.cta || e.pregunta || e.ruta || e.via || e.motivo || e.hoja || e.destino || '')]);
    return kpis([[R.L.filter(e => e.ev === 'error_js').length, 'Errores de JavaScript'], [R.L.filter(e => e.ev === 'verif_error').length, 'Errores de verificación'], [R.L.filter(e => e.ev === 'pulse_error').length, 'Errores del Pulse'], [R.L.length, 'Eventos en el log'], [kb + ' KB', 'Espacio usado'], [ENDPOINT ? 'sí' : 'no', 'Servidor configurado']])
      + ph('Verificación: motivos de error') + tbl(['Motivo', 'Veces'], rowsOf(R.tally(R.L.filter(e => e.ev === 'verif_error'), e => e.motivo)))
      + ph('Hojas cerradas sin terminar') + tbl(['Hoja · paso', 'Veces'], rowsOf(R.tally(R.L.filter(e => e.ev === 'hoja_cerrada' && !e.completa), e => e.hoja + ' · ' + e.paso)))
      + ph('Últimos eventos') + tbl(['Hora', 'Evento', 'Obra', 'Detalle'], last)
      + pnote(t(SITE.panel.endpoint) + ': ' + (ENDPOINT || t(SITE.panel.sin_endpoint)) + ' · build ' + D.build);
  }
};
function renderPanel() {
  const P = SITE.panel, d = $('#panel'); if (!d) return;
  const tabs = ['audiencia', 'contenido', 'comunidad', 'solicitudes', 'funcionamiento'];
  d.innerHTML = `<div class="sheet-hd"><div><h2 id="panel-title">${esc(t(P.title))}</h2><p class="panel-note" style="margin-top:6px">${esc(t(P.sub))}</p></div>
      <button type="button" class="x" data-act="panel-close" aria-label="Cerrar">${I.x}</button></div>
    <div class="panel-tabs" role="tablist">${tabs.map(k => `<button type="button" role="tab" aria-selected="${PANEL_TAB === k}" data-act="panel-tab" data-tab="${k}">${esc(t(P.tabs[k]))}</button>`).join('')}</div>
    <div class="sheet-bd" style="flex:1">${PANEL_VIEWS[PANEL_TAB](report())}</div>
    <div class="sheet-ft">
      <button type="button" class="btn sm" data-act="export">${esc(t(P.exportar))}</button>
      <button type="button" class="btn sm ghost" data-act="sim-visitante">Simular visitante nuevo</button>
      <button type="button" class="btn sm ghost" data-act="sim-visita">Simular nueva visita (+3 h)</button>
      ${S.cuenta ? `<label class="small muted" style="display:flex;align-items:center;gap:8px">${esc(t(P.nivel))}<select class="select" style="min-height:40px;width:auto;padding:6px 10px" data-act="nivel">${['verificado', 'profesional', 'escritor'].map(n => `<option value="${n}" ${nivel() === n ? 'selected' : ''}>${esc(t(SITE.tulista.niveles[n]))}</option>`).join('')}</select></label>` : ''}
      <button type="button" class="btn sm ghost" data-act="reset">${esc(t(P.borrar))}</button>
    </div>`;
}
function mask(e) { if (!e) return e; const [u, dm] = String(e).split('@'); return (u || '?')[0] + '***@' + (dm || ''); }
function exportJSON() {
  const data = { exportado: new Date().toISOString(), build: D.build, nota: 'Prototipo Qantica Showcase. Los emails van enmascarados.',
    eventos: S.log,
    cuentas: Object.fromEntries(Object.entries(S.cuentas).map(([k, c]) => [k, Object.assign({}, c, { email: mask(c.email) })])),
    solicitudes: S.solicitudes.map(s => Object.assign({}, s, { campos: Object.assign({}, s.campos, { email: mask(s.campos.email), nombre: s.campos.nombre ? s.campos.nombre[0] + '…' : '' }) })),
    comentarios: S.comentarios };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'qantica-showcase-datos-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  track('panel_exportar', { eventos: S.log.length });
}
function pageId() { return D.page === 'obra' ? 'obra:' + OBRA.id : 'catalogo'; }
function simVisitante() {
  S.visitante = rid('v'); S.cuenta = null; S.sesion = null; S.pendiente = null;
  ensureSession('simulado'); track('sesion_inicio', { motivo: 'simulado' });
  track('pagina_vista', { referente: 'simulado', entrada: true }); S.sesion.ultima_pagina = pageId(); save();
  renderPage(); renderPanel();
  toast(LANG === 'es' ? 'Ahora eres un visitante nuevo, sin cuenta.' : 'You are now a new visitor with no account.');
}
function simVisita() {
  S.desfase = (S.desfase || 0) + 3 * 3600 * 1000;
  if (S.sesion) S.sesion.ultimo = clock() - GAP - 1000;
  ensureSession(); track('visita_inicio', { motivo: 'simulado' });
  track('pagina_vista', { referente: 'simulado', entrada: true }); S.sesion.ultima_pagina = pageId(); save();
  renderPage(); renderPanel(); checkRetorno(); rememberTotals();
}
function setNivel(v) { const a = acct(); if (!a) return; a.nivel = v; track('nivel_simulado', { nivel: v }); save(); renderPage(); renderPanel(); }
function moderar(id, res) {
  const c = S.comentarios.find(x => x.id === id); if (!c) return;
  c.estado = res; track('comentario_moderado', { resultado: res, obra: c.obra }); save(); renderPanel();
  if (OBRA && OBRA.id === c.obra) rerender('conversacion');
}

/* volver: "desde tu última visita" */
function checkRetorno() {
  if (!acct()) return;
  let best = null;
  OBRAS.filter(o => isFollowing(o.id) || isVoted(o.id)).forEach(o => {
    const prev = S.ultimas[o.id], cur = totals(o).com;
    if (prev != null && cur > prev && (!best || cur - prev > best.d)) best = { o, d: cur - prev };
  });
  if (!best) return;
  track('retorno_visto', { obra: best.o.id, delta_votos: best.d });
  const f = isFollowing(best.o.id);
  const msg = LANG === 'es' ? `Desde tu última visita, ${best.o.title} sumó ${fmt(best.d)} votos${f ? ' y hay una pieza nueva para seguidores' : ''}.` : `Since your last visit, ${best.o.title} gained ${fmt(best.d)} votes${f ? ' and there is a new piece for followers' : ''}.`;
  toast(msg, { label: LANG === 'es' ? 'Ver' : 'See', fn: () => { if (OBRA && OBRA.id === best.o.id) gotoNav('comunidad'); else location.href = obraUrl(best.o.id); } });
}
function rememberTotals() { OBRAS.forEach(o => { if (isFollowing(o.id) || isVoted(o.id)) S.ultimas[o.id] = totals(o).com; }); save(); }

/* ================= eventos del DOM (delegados) ================= */
let TAPS = 0, TAP_T = 0;
function logoTap() { const n = now(); if (n - TAP_T > 1200) TAPS = 0; TAP_T = n; TAPS++; if (TAPS >= 3) { TAPS = 0; openPanel(); } }
function setLang(l) {
  if (l === LANG) return;
  const prev = LANG; LANG = l;
  try { localStorage.setItem(LANG_KEY, l); } catch (_) {}
  document.documentElement.lang = l;
  try { const u = new URL(location.href); u.searchParams.set('lang', l); history.replaceState(history.state, '', u.href); } catch (_) {}
  track('idioma_cambio', { de: prev, a: l });
  const y = window.scrollY; renderPage(); window.scrollTo(0, y);
  if (SHEET && $('#sheet').open) renderSheet();
  if ($('#panel').open) renderPanel();
}
document.addEventListener('click', e => {
  const a = e.target.closest('[data-act],[data-cta],[data-ext]');
  if (!a) return;
  if (a.dataset.cta) {
    markViewed('cta', (OBRA ? OBRA.id : 'cat') + ':' + a.dataset.cta, () => track('cta_vista', { cta: a.dataset.cta, forzada: true }));
    track('cta_click', { cta: a.dataset.cta });
  }
  if (a.dataset.ext) track('salida_externa', { destino: a.dataset.ext });
  const act = a.dataset.act; if (!act) return;
  switch (act) {
    case 'lang': setLang(a.dataset.lang); break;
    case 'goto-id': { e.preventDefault(); const el = document.getElementById(a.dataset.target); closeSheet(); if (el) { scrollToEl(el, a.dataset.target === 'sec-voto' ? 'center' : 'start'); if (a.dataset.target === 'sec-voto') flash($('#vote-card')); } break; }
    case 'goto-nav': e.preventDefault(); closeSheet(); gotoNav(a.dataset.nav); break;
    case 'logo': e.preventDefault(); logoTap(); if (TAPS === 1) window.scrollTo({ top: 0, behavior: SMOOTH }); break;
    case 'slide': { const i = +a.dataset.idx; if (i !== CAR_IDX) carGo(i, 'click'); else { const o = OBRAS[i]; track('obra_abrir', { obra: o.id, origen: 'carrusel', posicion: i }); location.href = obraUrl(o.id); } break; }
    case 'car-prev': carGo(CAR_IDX - 1, 'flecha'); break;
    case 'car-next': carGo(CAR_IDX + 1, 'flecha'); break;
    case 'filtro': { FILTRO = a.dataset.v; $('#seg').innerHTML = segHTML(); const g = $('#grid'); g.innerHTML = gridHTML(); observeAll(g); track('filtro_uso', { valor: FILTRO, resultados: $$('.gcard', g).length }); break; }
    case 'open-obra': track('obra_abrir', { obra: a.dataset.obra, origen: a.dataset.origen, posicion: a.dataset.pos != null ? +a.dataset.pos : null }); break;
    case 'sheet': e.preventDefault(); if (a.dataset.sheet === 'code' && !S.pendiente) break; openSheet(a.dataset.sheet, { proposito: a.dataset.proposito }); break;
    case 'sheet-close': closeSheet(); break;
    case 'privacy-inline': { e.preventDefault(); const p = a.closest('form') && a.closest('form').querySelector('.privacy-inline'); if (p) p.hidden = !p.hidden; break; }
    case 'react': answer(a.dataset.q, a.dataset.opt, a.dataset.pos, a.dataset.sec); break;
    case 'skip': skip(a.dataset.q, a.dataset.sec); break;
    case 'unskip': unskip(a.dataset.q, a.dataset.sec); break;
    case 'stack-next': stackNext(a.dataset.sec); break;
    case 'vote': openVote(a.dataset.via); break;
    case 'withdraw': withdrawVote(); break;
    case 'follow': {
      const inSheet = !!a.closest('#sheet');
      if (inSheet && acct()) { if (!isFollowing(OBRA.id)) { track('follow_inicio', { via: a.dataset.via }); doFollow(OBRA, a.dataset.via, null); } SHEET.kind = 'seguir'; SHEET.step = 'ok'; renderSheet(); }
      else { if (inSheet) closeSheet(); followAction(a.dataset.via); }
      break;
    }
    case 'unfollow': unfollow('bloque'); break;
    case 'share': share(); break;
    case 'spotify': loadSpotify(); break;
    case 'pulse': openPulse(); break;
    case 'pulse-close': $('#pulse').close(); break;
    case 'pulse-retry': { const ifr = $('#pulse iframe'); if (ifr && PULSE) { PULSE.t0 = now(); PULSE.loaded = false; const l = $('#pulse-load'); if (l) l.innerHTML = `<div class="spin"></div><span>${esc(t(SITE.pulse.cargando))}</span>`; ifr.src = OBRA.experiencia.url; track('pulse_reintento', {}); } break; }
    case 'code-back': { const m = S.pendiente ? S.pendiente.motivo : SHEET.kind; const em = S.pendiente ? S.pendiente.email : ''; S.pendiente = null; save(); SHEET.kind = m; SHEET.step = 'form'; SHEET.err = {}; SHEET.vals = Object.assign({}, SHEET.vals, { email: em }); renderSheet(); if (OBRA) { rerender('voto'); rerender('seguir'); refreshChrome(); } break; }
    case 'code-resend': if (S.pendiente) { S.pendiente.codigo = String(Math.floor(100000 + Math.random() * 900000)); S.pendiente.expira = now() + 600000; S.pendiente.intentos = 0; track('verif_reenvio', {}); save(); SHEET.err = {}; renderSheet(); } break;
    case 'goto-premio': closeSheet(); setTimeout(() => { const l = $('.locked'); if (l) { scrollToEl(l, 'center'); flash(l); } }, 100); break;
    case 'panel': openPanel(); break;
    case 'panel-close': $('#panel').close(); break;
    case 'panel-tab': PANEL_TAB = a.dataset.tab; renderPanel(); break;
    case 'export': exportJSON(); break;
    case 'reset': if (a.dataset.armed) { try { localStorage.removeItem(KEY); } catch (_) {} location.reload(); } else { a.dataset.armed = '1'; a.textContent = LANG === 'es' ? '¿Seguro? Toca de nuevo' : 'Sure? Tap again'; } break;
    case 'sim-visitante': simVisitante(); break;
    case 'sim-visita': simVisita(); break;
    case 'moderar': moderar(a.dataset.id, a.dataset.res); break;
  }
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'cmp' && OBRA) {
    const n = el.value.length, c = $('#cmp-n');
    if (c) { c.textContent = n + ' / 144'; c.classList.toggle('warn', n >= 134); }
    once('cmp:' + OBRA.id, () => track('comentario_iniciado', {}));
  }
  if (el.dataset && el.dataset.counter) { const c = $('.counter[data-for="' + el.id + '"]'); if (c) { c.textContent = el.value.length + ' / ' + el.maxLength; c.classList.toggle('warn', el.value.length >= el.maxLength - 10); } }
  if (SHEET && RUTAS[SHEET.kind] && !SHEET.started && el.closest && el.closest('#sheet form')) { SHEET.started = true; track('form_iniciado', { ruta: rutaDe(SHEET.kind, SHEET.ctx) }); }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.act === 'mails') setMails(el.checked);
  if (el.dataset.act === 'nivel') setNivel(el.value);
  if (el.dataset.act === 'proposito' && SHEET) {
    const f = el.closest('form'), fd = new FormData(f);
    SHEET.vals = Object.assign({}, SHEET.vals, { nombre: fd.get('nombre') || '', email: fd.get('email') || '', proyecto: fd.get('proyecto') || '', logline: fd.get('logline') || '', perfil: fd.get('perfil') || '', consent: !!fd.get('consent'), proposito: el.value });
    SHEET.ctx.proposito = el.value; renderSheet();
  }
});
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  if (f.dataset.form === 'comentar') {
    const txt = new FormData(f).get('texto');
    const had = !!acct(); postComment(txt);
    if (had && txt && txt.trim()) { f.reset(); const c = $('#cmp-n'); if (c) c.textContent = '0 / 144'; }
    return;
  }
  if (SHEET) onSheetSubmit(f);
});
document.addEventListener('keydown', e => {
  if ((e.key === 's' || e.key === 'S') && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const tg = e.target; if (tg && (/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) || tg.isContentEditable)) return;
    const p = $('#panel'); if (p.open) p.close(); else openPanel();
  }
});
document.addEventListener('focusin', e => { if (e.target.matches && e.target.matches('input,textarea,select') && !e.target.closest('dialog')) { INPUT_FOCUS = true; if (OBRA) updatePill(); } });
document.addEventListener('focusout', () => { INPUT_FOCUS = false; if (OBRA) updatePill(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') rememberTotals(); });

/* ================= arranque ================= */
let CAR_RESIZE = false;
function renderPage() {
  $('#app').innerHTML = D.page === 'obra' ? renderObra() : renderCatalogo();
  document.title = D.page === 'obra' ? OBRA.title + ' · Qantica Showcase' : t(SITE.meta.title);
  const sk = $('#skip'); if (sk) sk.textContent = t(SITE.nav.skip);
  TIMERS.forEach(clearTimeout); TIMERS.clear();
  if (IO_EXP) IO_EXP.disconnect(); else initExposure();
  if (IO_NAV) IO_NAV.disconnect(); IO_NAV = null; CUR_NAV = null;
  initNavObserver(); observeAll(document); animateBars(document);
  if (D.page === 'catalogo') initCarousel();
  if (OBRA) updatePill();
}
function boot() {
  const tipo = ensureSession();
  if (tipo) track(tipo === 'visita' ? 'visita_inicio' : 'sesion_inicio', {});
  wireDialog($('#sheet'), () => { if (SHEET) track('hoja_cerrada', { hoja: SHEET.kind, paso: SHEET.step, completa: SHEET.step === 'ok' || SHEET.kind === 'lista' || SHEET.kind === 'capitulos' || SHEET.kind === 'proto' || SHEET.kind === 'privacidad' }); SHEET = null; });
  wireDialog($('#pulse'), onPulseClose);
  wireDialog($('#panel'), () => {});
  renderPage();
  const ref = S.sesion.ultima_pagina || (document.referrer ? 'externo' : 'directo');
  track('pagina_vista', { referente: ref, entrada: !S.sesion.ultima_pagina });
  S.sesion.ultima_pagina = pageId(); save();
  if (tipo === 'visita') checkRetorno();
  rememberTotals();
  window.addEventListener('scroll', onScroll, { passive: true });
  if (PARAMS.get('panel') === '1') openPanel();
  if (tipo === 'nueva' && !S.visto_proto) {
    S.visto_proto = 1; save();
    setTimeout(() => toast(LANG === 'es' ? 'Prototipo con datos de ejemplo: nada se envía.' : 'Prototype with sample data: nothing is sent.', { label: LANG === 'es' ? 'Qué es' : 'About', fn: () => openSheet('proto') }), 1400);
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
