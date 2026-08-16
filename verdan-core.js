/*! verdan-core.js v1.0.0 — 버던 사내 웹앱 공통 코어
 *
 *  이 파일은 공개 저장소에 올라갑니다. 비밀번호 · Apps Script URL 등
 *  비밀에 해당하는 값은 절대 여기에 두지 마세요. 전부 앱 쪽 cfg 로 넘깁니다.
 *
 *  교체 방법 : 이 파일을 고치고 각 앱의 <script src="...?v=1.0.1"> 숫자만 올립니다.
 */
(function (global) {
'use strict';

var CORE_VERSION = '1.0.0';

/* ── 내부 상태 ─────────────────────────────────────── */
var CFG = null;
var PW = '', USER = '', ROLE = '', DATA = null;
var BUSY = false, LAST = 0, LOGS = [], accessLoaded = false;
var IDEM = {};          /* 멱등키 캐시 — 같은 작업의 재시도를 서버가 알아보게 함 */
var CURPAGE = '';
var booted = false;

/* ── 작은 도구 ─────────────────────────────────────── */
function $(id){ return document.getElementById(id); }

/* HTML 본문 · 속성값용 이스케이프 */
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c];
  });
}
/* onclick="fn('...')" 안에 들어가는 문자열용.
   esc 로 작은따옴표를 &#39; 로 바꾸는 방법은 통하지 않습니다 —
   브라우저가 속성값을 먼저 디코딩한 뒤 JS 로 파싱하기 때문에 다시 ' 로 돌아옵니다. */
function jsq(s){
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '&quot;')
    .replace(/</g, '\\x3C')
    .replace(/\r?\n/g, ' ');
}
function n(v){
  return (v === null || v === '' || v === undefined || isNaN(v))
    ? '—' : Number(v).toLocaleString('ko-KR');
}
function nr(v){   /* 반올림해서 표시 */
  return (v === null || v === '' || v === undefined || isNaN(v))
    ? '—' : Math.round(Number(v)).toLocaleString('ko-KR');
}
function num(v){ var x = Number(v); return isNaN(x) ? null : x; }
function pc(v){ return (v === null || v === undefined) ? '—' : (Number(v) * 100).toFixed(1) + '%'; }
function dayGap(from, to){
  var a = new Date(from + 'T00:00:00'), b = new Date(to + 'T00:00:00');
  if (isNaN(a) || isNaN(b)) return 9999;
  return Math.round((b - a) / 86400000);
}
function linkify(t){
  return esc(t).replace(/(https?:\/\/[^\s<]+)/g, function (u) {
    return '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>';
  });
}
/* 글자를 칠 때마다 목록을 다시 그리면 느립니다. 잠시 모아서 한 번만 그립니다. */
var debT = null;
function debounce(fn, ms){ clearTimeout(debT); debT = setTimeout(fn, ms || 250); }

/* 접었다 펴는 공통 동작 */
function toggleBox(id){
  var e = $(id); if (!e) return;
  var hidden = (e.style.display === 'none');
  /* 표 안의 행은 block 으로 펴면 레이아웃이 깨지므로 table-row 로 되돌립니다 */
  e.style.display = hidden ? (e.tagName === 'TR' ? 'table-row' : 'block') : 'none';
}

/* null 안전 헬퍼 — HTML 에서 요소를 지워도 코드가 멈추지 않게 합니다.
   기존 앱이 logout() 에서 멈췄던 원인이 바로 이 방어가 없어서였습니다. */
function setHTML(id, v){ var e = $(id); if (e) e.innerHTML = v; }
function setVal(id, v){ var e = $(id); if (e) e.value = (v || ''); }
function setDisp(id, v){ var e = $(id); if (e) e.style.display = v; }
function setText(id, v){ var e = $(id); if (e) e.textContent = v; }

/* ── 통신 ───────────────────────────────────────────
   Apps Script 는 CORS preflight 를 처리하지 못하므로 전부 GET 으로 보냅니다.
   fetch 에는 기본 제한 시간이 없습니다. 이게 없으면 서버가 답하지 않을 때
   영원히 기다리며 앱이 통째로 먹통이 됩니다. */
function tmo(mode){
  var t = (CFG && CFG.timeout) || {};
  if (mode === 'write') return t.write || 30000;
  if (mode === 'ai')    return t.ai    || 45000;
  return t.read || 12000;
}
function newReqId(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function isTimeout(e){ return e && (e.name === 'AbortError' || e.name === 'TimeoutError'); }

/* opt = { mode:'read'|'write'|'ai', idem:'upload:123' }
   idem 을 주면 같은 작업을 다시 보낼 때 같은 reqId 가 실려 나갑니다.
   서버가 reqId 를 기억해 두면 중복 저장이 원천 차단됩니다.
   (서버가 아직 대응하지 않았다면 그냥 무시되는 여분 파라미터일 뿐입니다) */
async function api(params, opt){
  opt = opt || {};
  var mode = opt.mode || 'read';
  var p = Object.assign({ key: PW, user: USER }, params || {});

  if (mode === 'write') {
    var k = opt.idem;
    if (k) {
      if (!IDEM[k] || Date.now() - IDEM[k].t > 600000) IDEM[k] = { id: newReqId(), t: Date.now() };
      p.reqId = IDEM[k].id;
    } else {
      p.reqId = newReqId();
    }
  }

  var q = new URLSearchParams(p);
  var ctl = new AbortController();
  var timer = setTimeout(function () { ctl.abort(); }, tmo(mode));
  try {
    var res = await fetch(CFG.scriptUrl + '?' + q.toString(), { signal: ctl.signal });
    var json = await res.json();
    /* 저장이 성공했으면 그 멱등키는 더 쓰지 않습니다 (다음 저장은 새 건이므로) */
    if (mode === 'write' && opt.idem && json && json.ok) delete IDEM[opt.idem];
    return json;
  } finally { clearTimeout(timer); }
}

/* 시간 초과는 '실패'가 아니라 '모름'입니다.
   브라우저 연결만 끊겼을 뿐 서버는 계속 실행 중일 수 있습니다.
   그래서 "다시 시도"가 아니라 "먼저 확인"을 안내합니다. */
function failMsg(e, what){
  if (isTimeout(e)) {
    return '응답이 없습니다. ' + (what || '새로고침으로 반영 여부를 먼저 확인하세요.');
  }
  return '오류: ' + e.message;
}

/* ── 화면 표시 ─────────────────────────────────────── */
function busy(on){
  BUSY = on;
  var b = $('loginBtn');
  if (b) { b.disabled = on; b.textContent = on ? '확인 중...' : '확인'; }
}
/* 헤더의 갱신 시각. 실패하면 붉게 경고합니다 —
   예전 숫자를 최신인 줄 알고 발주·정산하는 사고를 막기 위해서입니다. */
function stamp(text, stale){
  var e = $('updated');
  if (!e) return;
  e.textContent = text;
  e.className = 'sub' + (stale ? ' stale' : '');
}
function gm(t){ setText('gateMsg', t || ''); }

/* ── 워터마크 ───────────────────────────────────────
   화면을 덮는 격자로 '이름 · 접속시각'을 반복해 깔아 둡니다. */
function watermark(on){
  var e = $('wm');
  if (!e) return;
  if (!on || !USER) { e.style.display = 'none'; e.innerHTML = ''; return; }
  var d = new Date(), p2 = function (x) { return String(x).padStart(2, '0'); };
  var txt = USER + ' · ' + d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
            ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  var h = '';
  for (var y = -120; y < window.innerHeight + 200; y += 130)
    for (var x = -180; x < window.innerWidth + 240; x += 210)
      h += '<span style="left:' + x + 'px;top:' + y + 'px">' + esc(txt) + '</span>';
  e.style.setProperty('--wm-op', (CFG && CFG.wmOpacity) || 0.05);
  e.innerHTML = h;
  e.style.display = 'block';
}
var wmT = null;
window.addEventListener('resize', function () {
  if (!PW) return;
  clearTimeout(wmT);
  wmT = setTimeout(function () { watermark(true); }, 200);
});

/* ── 권한 ───────────────────────────────────────────
   서버가 모르는 role 을 보내도 권한이 열리지 않고 닫히는 쪽으로 떨어집니다. */
function perm(){
  return (CFG.perm && CFG.perm[ROLE]) || CFG.noperm || { label: '—' };
}
function can(k){ return !!perm()[k]; }

/* ── 게이트 · 헤더 생성 ────────────────────────────── */
function buildChrome(){
  if ($('gate')) return;

  var iconHtml = CFG.iconUrl
    ? '<img src="' + esc(CFG.iconUrl) + '" alt="">'
    : esc(CFG.icon || '📁');

  var gate = document.createElement('div');
  gate.id = 'gate';
  gate.innerHTML =
    '<div class="box">' +
      '<div class="logo">' + (CFG.icon || '📁') + '</div>' +
      '<h1>' + esc(CFG.title) + '</h1>' +
      '<input type="text" id="nm" placeholder="이름" autocomplete="name" maxlength="20">' +
      '<input type="password" id="pw" placeholder="비밀번호" autocomplete="current-password">' +
      '<button id="loginBtn">확인</button>' +
      '<div id="gateMsg"></div>' +
      '<div class="hint">' + esc(CFG.hint || '본인 이름을 입력하세요. 접근로그에 기록됩니다.') +
        '<br>' + esc(CFG.appVersion || '') + ' · core ' + CORE_VERSION + '</div>' +
    '</div>';

  var appEl = $('app');
  appEl.parentNode.insertBefore(gate, appEl);

  var wm = document.createElement('div');
  wm.id = 'wm'; wm.setAttribute('aria-hidden', 'true');
  document.body.appendChild(wm);

  setHTML('header',
    '<div class="icon">' + iconHtml + '</div>' +
    '<div><div class="title">' + esc(CFG.title) + '</div>' +
      '<div class="sub" id="updated"></div></div>' +
    '<span class="role" id="roleBadge"></span>' +
    '<button class="logoutBtn" id="logoutBtn">로그아웃</button>');

  $('nm').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('pw').focus(); });
  $('pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') login(); });
  $('loginBtn').addEventListener('click', function () { login(); });
  $('logoutBtn').addEventListener('click', function () {
    if (confirm('로그아웃할까요?')) logout();
  });
}

/* ── 탭 ─────────────────────────────────────────────
   <div id="tabs"><button data-page="p1" data-perm="access">…</button></div> */
function bindTabs(){
  var box = $('tabs');
  if (!box) return;
  box.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-page]');
    if (b) tab(b.dataset.page);
  });
}
function tab(pageId){
  CURPAGE = pageId;
  var btns = document.querySelectorAll('#tabs button[data-page]');
  Array.prototype.forEach.call(btns, function (b) {
    b.className = (b.dataset.page === pageId) ? 'on' : '';
  });
  Array.prototype.forEach.call(document.querySelectorAll('.page'), function (p) {
    var on = (p.id === pageId);
    p.className = p.className.replace(/\bon\b/g, '').trim() + (on ? ' on' : '');
  });
  if (CFG.chatPage && pageId === CFG.chatPage) setTimeout(fitChat, 50);
  else fitChat();
  if (CFG.onTab) CFG.onTab(pageId);
}
function firstPage(){
  var b = document.querySelector('#tabs button[data-page]');
  return b ? b.dataset.page : 'p1';
}
function applyTabPerm(){
  Array.prototype.forEach.call(document.querySelectorAll('#tabs button[data-page]'), function (b) {
    var need = b.dataset.perm;
    b.style.display = (!need || can(need)) ? 'block' : 'none';
  });
}

/* ── 채팅 높이 ──────────────────────────────────────
   visualViewport 는 키보드가 올라온 뒤의 실제 보이는 높이를 알려줍니다.
   innerHeight 를 쓰면 입력창이 키보드 뒤로 숨습니다. */
function fitChat(){
  if (!CFG || !CFG.chatPage) return;
  var p = $(CFG.chatPage);
  if (!p || p.className.indexOf('on') === -1) {
    document.body.classList.remove('chatmode');
    if (p) p.style.height = '';       /* p 가 null 일 수 있으므로 반드시 확인 */
    return;
  }
  document.body.classList.add('chatmode');
  var vv = window.visualViewport;
  var vh = vv ? vv.height : window.innerHeight;
  var hd = $('header'), tb = $('tabs');
  var top = (hd ? hd.offsetHeight : 0) + (tb ? tb.offsetHeight : 0);
  var h = Math.max(vh - top, 240) + 'px';
  if (p.style.height !== h) p.style.height = h;   /* 값이 같으면 건드리지 않습니다 */
}
/* 키보드가 오르내릴 때마다 다시 계산하면 입력이 버벅입니다.
   scroll 은 듣지 않고, resize 도 잠시 모아서 한 번만 처리합니다. */
var fitT = null;
function fitChatSoon(){ clearTimeout(fitT); fitT = setTimeout(fitChat, 120); }
if (window.visualViewport) window.visualViewport.addEventListener('resize', fitChatSoon);
window.addEventListener('resize', fitChatSoon);

/* ── 로그인 ─────────────────────────────────────── */
async function login(){
  if (BUSY) return;
  var nm = ($('nm').value || '').trim();
  var pw = ($('pw').value || '').trim();
  if (!nm) { gm('이름을 입력하세요.'); return; }
  if (!pw) { gm('비밀번호를 입력하세요.'); return; }
  gm('접속 중입니다. 잠시만 기다려주세요.');
  busy(true);
  PW = pw; USER = nm;
  try {
    var r = await api();
    if (!r.ok) { PW = ''; USER = ''; gm(r.msg || '비밀번호가 올바르지 않습니다.'); return; }
    try {
      localStorage.setItem(CFG.store.pw, pw);
      localStorage.setItem(CFG.store.user, nm);
    } catch (e) {}
    LAST = Date.now();
    start(r);
  } catch (e) {
    PW = ''; USER = '';
    gm(isTimeout(e) ? '서버 응답이 없습니다. [확인]을 다시 눌러주세요.' : '연결 실패: ' + e.message);
  } finally { busy(false); }
}

function start(r){
  DATA = r; ROLE = r.role;
  setDisp('gate', 'none');
  setDisp('app', 'flex');
  setText('roleBadge', perm().label || '—');
  stamp('갱신 ' + r.updated, false);
  watermark(true);
  applyTabPerm();
  accessLoaded = false;
  LOGS = [];
  if (CFG.onStart) CFG.onStart(r);
  tab(firstPage());
}

/* ── 로그아웃 ───────────────────────────────────────
   보안에 직결되는 상태 초기화를 DOM 조작보다 앞에 둡니다.
   화면 쪽에서 무슨 일이 나도 값은 반드시 지워지게 하기 위해서입니다. */
function logout(){
  try {
    localStorage.removeItem(CFG.store.pw);
    (CFG.legacyKeys || []).forEach(function (k) { localStorage.removeItem(k); });
  } catch (e) {}                       /* 이름은 남겨 재입력을 줄입니다 */

  PW = ''; USER = ''; ROLE = ''; DATA = null;
  BUSY = false; LAST = 0; LOGS = []; accessLoaded = false; IDEM = {};
  document.body.classList.remove('chatmode');
  if (CFG.onLogout) { try { CFG.onLogout(); } catch (e) {} }

  watermark(false);
  busy(false);
  setDisp('app', 'none');
  setDisp('gate', 'flex');
  setVal('pw', '');
  setText('roleBadge', '');

  /* data-clear · data-reset 이 붙은 요소를 비웁니다.
     새 화면을 만들 때 속성만 붙이면 자동으로 함께 지워집니다. */
  Array.prototype.forEach.call(document.querySelectorAll('[data-clear]'), function (e) {
    e.innerHTML = '';
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-reset]'), function (e) {
    e.value = '';
  });

  tab(firstPage());
  gm('');
}

/* ── 새로고침 ─────────────────────────────────────── */
async function reload(manual){
  if (BUSY || !PW) return;
  BUSY = true;
  try {
    var r = await api();
    LAST = Date.now();
    if (!r.ok) { logout(); gm('다시 로그인해 주세요.'); return; }
    if (r.role !== ROLE) { start(r); return; }   /* 권한이 바뀌었으면 화면을 다시 짭니다 */
    DATA = r;
    stamp('갱신 ' + r.updated, false);
    if (CFG.onData) CFG.onData(r);
  } catch (e) {
    /* 끊긴 요청으로 로그아웃시키지는 않되, 화면 숫자가 예전 것임은 반드시 보이게 합니다. */
    stamp('연결 실패 · 새로고침 필요', true);
    if (manual) alert('서버 응답이 없습니다.\n잠시 후 새로고침을 다시 눌러주세요.');
  } finally { BUSY = false; }
}

/* 앱이 쓰기 응답을 받았을 때 화면을 갱신하는 통로 */
function setData(r){
  DATA = r; LAST = Date.now();
  if (r && r.updated) stamp('갱신 ' + r.updated, false);
  if (CFG.onData) CFG.onData(r);
}

/* ── 접근로그 ─────────────────────────────────────── */
async function fetchLogs(force){
  if (accessLoaded && !force) return LOGS;
  var r = await api({ action: 'access' });
  if (!r.ok) throw new Error(r.msg || '불러오지 못했습니다.');
  accessLoaded = true;
  LOGS = r.logs || [];
  return LOGS;
}

/* ── 세션 감시 ─────────────────────────────────────
   ① 다른 창에서 로그아웃하면 이쪽도 따라 나갑니다
   ② 앱으로 되돌아올 때 서버에 다시 물어봅니다 (비번이 바뀌었으면 튕겨냅니다)
   복귀할 때마다 두드리면 요청이 겹쳐 화면이 멈추므로 최소 간격을 둡니다. */
window.addEventListener('storage', function (e) {
  if (CFG && e.key === CFG.store.pw && !e.newValue && PW) logout();
});
function onResume(){
  if (!PW || BUSY) return;
  var saved = null;
  try { saved = localStorage.getItem(CFG.store.pw); } catch (e) {}
  if (saved !== PW) { logout(); return; }
  if (Date.now() - LAST < ((CFG && CFG.recheckMs) || 60000)) return;
  reload(false);
}
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') onResume();
});
window.addEventListener('pageshow', function () { onResume(); });

/* ── 시작 ─────────────────────────────────────────── */
async function init(cfg){
  if (booted) return;
  booted = true;
  CFG = cfg;
  CFG.store = CFG.store || { pw: 'verdan_' + cfg.appId + '_pw', user: 'verdan_' + cfg.appId + '_user' };
  CFG.noperm = CFG.noperm || { label: '—' };

  buildChrome();
  bindTabs();

  /* 자동 로그인 */
  var sp = null, sn = null;
  try {
    sp = localStorage.getItem(CFG.store.pw);
    sn = localStorage.getItem(CFG.store.user);
    (CFG.legacyKeys || []).forEach(function (k) { localStorage.removeItem(k); });
  } catch (e) {}
  if (sn) $('nm').value = sn;
  if (!sp || !sn) return;

  PW = sp; USER = sn;
  gm('접속 중입니다. 잠시만 기다려주세요.');
  busy(true);
  try {
    var r = await api();
    if (r.ok) { LAST = Date.now(); start(r); }
    else {
      PW = ''; USER = '';
      try { localStorage.removeItem(CFG.store.pw); } catch (e) {}
      gm('비밀번호가 변경되었습니다. 다시 입력해 주세요.');
    }
  } catch (e) {
    PW = ''; USER = '';
    gm(isTimeout(e) ? '서버 응답이 없습니다. [확인]을 눌러 다시 시도하세요.' : '');
  } finally { busy(false); }
}

/* ── 밖으로 내보내는 것 ────────────────────────────── */
global.VERDAN = {
  version: CORE_VERSION,
  init: init,
  api: api,
  isTimeout: isTimeout,
  failMsg: failMsg,

  esc: esc, js: jsq, n: n, nr: nr, num: num, pc: pc,
  dayGap: dayGap, linkify: linkify, debounce: debounce, toggleBox: toggleBox,
  setHTML: setHTML, setVal: setVal, setDisp: setDisp, setText: setText,

  can: can,
  role: function () { return ROLE; },
  user: function () { return USER; },
  data: function () { return DATA; },
  setData: setData,

  stamp: stamp, gm: gm,
  busy: function (on) { busy(on); },
  isBusy: function () { return BUSY; },
  loggedIn: function () { return !!PW; },

  tab: tab,
  page: function () { return CURPAGE; },
  fitChat: fitChat,
  watermark: watermark,
  reload: reload,
  logout: logout,
  fetchLogs: fetchLogs
};

})(window);
