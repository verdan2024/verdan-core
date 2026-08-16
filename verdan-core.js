/*! verdan-core.js v1.1.3 — 버던 사내 웹앱 공통 코어
 *
 *  이 파일은 공개 저장소에 올라갑니다. 비밀번호 · Apps Script URL 등
 *  비밀에 해당하는 값은 절대 여기에 두지 마세요. 전부 앱 쪽 cfg 로 넘깁니다.
 *
 *  교체 방법 : 이 파일을 고치고 각 앱의 <script src="...?v=1.1.0"> 숫자만 올립니다.
 *
 *  v1.0.0 → v1.1.0
 *   [로그인]  이름 → 비밀번호 순서 고정 / 버튼 '로그인' 고정 /
 *             안내·대기 문구를 코어가 소유 (CFG.hint 옵션 폐지)
 *   [헤더]    이름 · 권한 텍스트 + 외곽선 로그아웃 / 헤더·탭 고정(sticky)
 *   [채팅]    코어가 입력줄을 소유 — textarea 자동 높이, 원형 화살표 버튼,
 *             타이핑 점 3개, 토큰 사용량 줄, 되묻기 칩(네/아니오),
 *             키보드 높이 계산 일원화
 *   [접근로그] 접속 / 기록 / 채팅 3분류 표를 코어가 그림.
 *             채팅은 [더보기] → 질문·답변 분리, AI 배지
 *   [권한]    서버가 보낸 features 로 기능이 없는 탭은 감춤

 *  v1.1.0 → v1.1.1  (화면 흔들림 · 키보드)
 *   · body 를 position:fixed 로 화면에 못박아 세로 스크롤·고무줄 반동을 없앰
 *   · 키보드가 밀어 올린 만큼(visualViewport.offsetTop) 도로 내려 제자리 고정
 *     → 입력칸을 탭해도 헤더가 사라지지 않고, 입력줄만 키보드 위에 붙음
 *   · offsetTop 은 resize 가 아니라 scroll 로 바뀌므로 두 이벤트를 함께 들음
 *
 *  v1.1.1 → v1.1.2  (v1.1.1 의 부작용 수정)
 *   · offsetTop 보정을 "키보드가 올라온 상태"에서만 적용.
 *     이 값은 손가락으로 화면을 당길 때도 변해서, 무조건 따라가면
 *     화면이 손가락을 따라다녔음. 키보드가 없으면 아무것도 건드리지 않음.
 *
 *  v1.1.2 → v1.1.3
 *   · "불러오는 중..." · "기록이 없습니다" 를 상자(.box-note) 대신
 *     글자만 가운데 두는 .note 로 바꿈
 */
(function (global) {
'use strict';

var CORE_VERSION = '1.1.3';

/* ── 코어가 소유하는 문구 ───────────────────────────
   앱마다 다르게 쓰던 문구를 여기 한 곳으로 모았습니다.
   앱에서 바꿀 수 없습니다. 바꾸려면 이 파일을 고칩니다. */
var TXT = {
  loginBtn : '로그인',
  waiting  : '접속 중입니다. 잠시만 기다려주세요.',
  hint     : '본인 이름을 입력하세요. 접근로그에 기록됩니다.',
  noName   : '이름을 입력하세요.',
  noPw     : '비밀번호를 입력하세요.',
  timeout  : '서버 응답이 없습니다. [로그인]을 다시 눌러주세요.',
  pwChanged: '비밀번호가 변경되었습니다. 다시 입력해 주세요.',
  yes      : '네, 물어봐 주세요',
  no       : '아니오'
};

/* 접근로그 탭 이름 · 마지막 열 이름 */
var LOGTAB = {
  access: { label: '접속', col: '권한',       empty: '접속 기록이 없습니다.' },
  work  : { label: '기록', col: '작업 내용',  empty: '기록이 없습니다.' },
  chat  : { label: '채팅', col: '질문 · 답변', empty: '채팅 기록이 없습니다.' }
};

/* ── 내부 상태 ─────────────────────────────────────── */
var CFG = null;
var PW = '', USER = '', ROLE = '', DATA = null, FEAT = null;
var BUSY = false, LAST = 0, LOGS = [], accessLoaded = false, LOGVIEW = '';
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

/* null 안전 헬퍼 — HTML 에서 요소를 지워도 코드가 멈추지 않게 합니다. */
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
   서버가 reqId 를 기억해 두면 중복 저장이 원천 차단됩니다. */
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
  /* 버튼 글자는 늘 '로그인' 입니다. 눌린 상태만 비활성으로 보여줍니다. */
  if (b) { b.disabled = on; b.textContent = TXT.loginBtn; }
}
/* 헤더의 갱신 시각. 실패하면 붉게 경고합니다 —
   예전 숫자를 최신인 줄 알고 발주·정산하는 사고를 막기 위해서입니다. */
function stamp(text, stale){
  var e = $('updated');
  if (!e) return;
  e.textContent = text;
  e.className = 'sub' + (stale ? ' stale' : '');
}
function gm(t, wait){
  var e = $('gateMsg');
  if (!e) return;
  e.textContent = t || '';
  e.className = wait ? 'wait' : '';
}

/* ── 화면을 보이는 영역에 못박기 ─────────────────────
   body 를 position:fixed 로 고정해 두고, 키보드가 올라왔을 때만
   높이와 위치를 손봅니다.

   [키보드가 올라올 때 iOS 가 하는 일은 두 가지입니다]
     ① 보이는 높이를 키보드만큼 줄인다   → visualViewport.height
     ② 화면 전체를 위로 밀어 올린다      → visualViewport.offsetTop
   ①만 처리하면 앱은 짧아졌는데 위로도 밀려서 헤더가 화면 밖으로 나갑니다.
   그래서 ② 만큼 도로 내려(translateY) 제자리에 붙여 둡니다.

   ⚠️ 그런데 offsetTop 은 키보드 때문에만 변하는 값이 아닙니다.
      손가락으로 화면을 당길 때도 따라 움직입니다. 그 값을 무조건 따라가면
      화면이 손가락을 따라다니게 됩니다(v1.1.1 에서 실제로 그랬습니다).
      그래서 "키보드가 올라온 상태"일 때만 보정합니다.
      키보드가 없을 때는 아무것도 건드리지 않는 것이 가장 안정적입니다. */
var KB_MIN = 120;   /* 화면이 이만큼(px) 넘게 줄면 키보드가 올라온 것으로 본다 */

function keyboardOpen(){
  var vv = window.visualViewport;
  if (!vv) return false;
  return (window.innerHeight - vv.height) > KB_MIN;
}

function applyViewportHeight(){
  var b = document.body;
  if (!b) return;
  var vv = window.visualViewport;

  if (keyboardOpen()) {
    var h = Math.round(vv.height) + 'px';
    var off = Math.round(vv.offsetTop);
    var tr = off ? ('translateY(' + off + 'px)') : '';
    if (b.style.height !== h) b.style.height = h;
    if (b.style.transform !== tr) b.style.transform = tr;
  } else {
    /* 키보드가 없을 때는 CSS 의 height:100% 로 되돌립니다.
       값을 직접 넣지 않는 편이 화면이 흔들리지 않습니다. */
    if (b.style.height) b.style.height = '';
    if (b.style.transform) b.style.transform = '';
    if (window.pageYOffset) window.scrollTo(0, 0);
  }

  /* 예전 버전이 #app · #gate 에 넣어 둔 높이가 남아 있으면 지웁니다 */
  var a = $('app'), g = $('gate');
  if (a && a.style.height) a.style.height = '';
  if (g && g.style.height) g.style.height = '';
}

/* 키보드가 오르내리는 동안에는 값이 연속으로 바뀝니다.
   그때마다 계산하면 버벅이므로 화면을 그리기 직전에 한 번만 처리합니다. */
var vpT = null;
function applyViewportSoon(){
  if (vpT) return;
  vpT = requestAnimationFrame(function () { vpT = null; applyViewportHeight(); });
}

/* resize 는 키보드가 오르내릴 때 옵니다. 이건 항상 듣습니다.
   scroll 은 손가락으로 당길 때도 오므로, 키보드가 올라와 있을 때만 반응합니다. */
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', applyViewportSoon);
  window.visualViewport.addEventListener('scroll', function () {
    if (keyboardOpen()) applyViewportSoon();
  });
}
/* 키보드가 내려간 뒤 남은 자리를 정리합니다 */
document.addEventListener('focusout', function () { setTimeout(applyViewportHeight, 300); });

var wmT = null;
window.addEventListener('resize', function () {
  applyViewportHeight();
  if (!PW) return;
  clearTimeout(wmT);
  wmT = setTimeout(function () { watermark(true); }, 200);
});

/* ── 권한 ───────────────────────────────────────────
   서버가 모르는 role 을 보내도 권한이 열리지 않고 닫히는 쪽으로 떨어집니다. */
function perm(){
  return (CFG.perm && CFG.perm[ROLE]) || CFG.noperm || { label: '—' };
}
function can(k){
  /* 서버가 features 로 "그 기능 자체가 없다"고 하면 권한과 무관하게 닫습니다.
     (예: 재고 앱에는 채팅 기능이 없습니다) */
  if (FEAT && FEAT[k] === false) return false;
  return !!perm()[k];
}

/* ── 게이트 · 헤더 생성 ────────────────────────────── */
function buildChrome(){
  if ($('gate')) return;

  var iconHtml = CFG.iconUrl
    ? '<img src="' + esc(CFG.iconUrl) + '" alt="">'
    : esc(CFG.icon || '📁');

  var gate = document.createElement('div');
  gate.id = 'gate';
  /* 입력 순서는 항상 이름 → 비밀번호 입니다. 앱에서 바꿀 수 없습니다. */
  gate.innerHTML =
    '<div class="box">' +
      '<div class="logo">' + iconHtml + '</div>' +
      '<h1>' + esc(CFG.title) + '</h1>' +
      '<input type="text" id="nm" placeholder="이름" autocomplete="name" maxlength="20">' +
      '<input type="password" id="pw" placeholder="비밀번호" autocomplete="current-password">' +
      '<button id="loginBtn">' + TXT.loginBtn + '</button>' +
      '<div id="gateMsg"></div>' +
      '<div class="hint">' + TXT.hint +
        '<br>' + esc(CFG.appVersion || '') + ' · core ' + CORE_VERSION + '</div>' +
    '</div>';

  var appEl = $('app');
  appEl.parentNode.insertBefore(gate, appEl);

  var wm = document.createElement('div');
  wm.id = 'wm'; wm.setAttribute('aria-hidden', 'true');
  document.body.appendChild(wm);

  /* 헤더 — 왼쪽 아이콘·앱이름·갱신시각 / 오른쪽 이름·권한 + 로그아웃 */
  setHTML('header',
    '<div class="icon">' + iconHtml + '</div>' +
    '<div><div class="title">' + esc(CFG.title) + '</div>' +
      '<div class="sub" id="updated"></div></div>' +
    '<span class="who" id="whoBox"></span>' +
    '<button class="logoutBtn" id="logoutBtn">로그아웃</button>');

  $('nm').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('pw').focus(); });
  $('pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') login(); });
  $('loginBtn').addEventListener('click', function () { login(); });
  $('logoutBtn').addEventListener('click', function () {
    if (confirm('로그아웃할까요?')) logout();
  });

  applyViewportHeight();
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
  var shown = null;
  Array.prototype.forEach.call(document.querySelectorAll('#tabs button[data-page]'), function (b) {
    var need = b.dataset.perm;
    var ok = (!need || can(need));
    b.style.display = ok ? 'block' : 'none';
    if (ok && !shown) shown = b.dataset.page;
  });
  return shown;
}

/* ── 채팅 높이 ──────────────────────────────────────
   visualViewport 는 키보드가 올라온 뒤의 실제 보이는 높이를 알려줍니다.
   innerHeight 를 쓰면 입력창이 키보드 뒤로 숨습니다.
   4개 앱이 이 계산 하나만 씁니다. */
function fitChat(){
  /* 보이는 영역만 맞추면 채팅 판은 flex 로 남은 자리를 채웁니다.
     입력줄은 그 판의 맨 아래 = 키보드 바로 위에 놓입니다.
     예전처럼 채팅 판에 높이를 직접 계산해 넣지 않습니다. */
  applyViewportHeight();
  if (!CFG || !CFG.chatPage) return;
  var p = $(CFG.chatPage);
  if (!p) return;
  if (p.style.height) p.style.height = '';   /* v1.0 에서 넣어 둔 값이 남아 있으면 지웁니다 */
  chatScrollEnd();
}
/* 키보드가 오르내릴 때마다 다시 계산하면 입력이 버벅입니다.
   scroll 은 듣지 않고, resize 도 잠시 모아서 한 번만 처리합니다. */
/* 화면 크기를 맞추는 일은 applyViewportSoon 이 전담합니다.
   여기서는 방향 전환처럼 늦게 반영되는 경우만 뒤따라 한 번 더 봅니다. */
window.addEventListener('orientationchange', function () {
  setTimeout(applyViewportHeight, 300);
  setTimeout(fitChat, 350);
});
/* 화면을 처음 그릴 때도 한 번 맞춥니다 */
applyViewportHeight();

/* ══════════════════════════════════════════════════
   채팅 — 코어가 입력줄과 말풍선을 소유합니다
   --------------------------------------------------
   앱 HTML 은 아래 뼈대만 두면 됩니다.
     <div id="p4" class="page chat">
       <div id="chatTop"></div>
       <div id="chatScroll"><div id="chatBody" data-clear></div></div>
       <div id="chatFoot">
         <div id="chatChips" class="chips" data-clear></div>
         <div id="chatBar"></div>          ← 코어가 채웁니다
         <div class="sub2" id="chatNote"></div>
       </div>
     </div>
   ══════════════════════════════════════════════════ */
var CHAT_SEND = null;

function chatInit(onSend){
  CHAT_SEND = onSend;
  var bar = $('chatBar');
  if (!bar) return;

  /* placeholder 는 넣지 않습니다. 예시 문구를 없애기로 했습니다. */
  bar.innerHTML =
    '<textarea id="qInput" rows="1" data-reset autocomplete="off"></textarea>' +
    '<button class="send" id="askBtn" aria-label="보내기">↑</button>';

  var ta = $('qInput'), btn = $('askBtn');

  /* 글이 길어지면 입력칸만 늘어납니다(최대 4줄). 버튼 크기는 그대로입니다. */
  function grow(){
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 96) + 'px';
  }
  ta.addEventListener('input', grow);
  /* 탭한 직후 · 키보드가 다 올라온 뒤 두 번 맞춰 줍니다.
     기기에 따라 키보드 애니메이션이 끝나는 시점이 다릅니다. */
  /* 키보드 애니메이션이 끝나는 시점이 기기마다 다릅니다.
     탭한 뒤 두 번 나눠 확인합니다. */
  ta.addEventListener('focus', function () {
    setTimeout(function () { applyViewportHeight(); chatScrollEnd(); }, 300);
    setTimeout(function () { applyViewportHeight(); chatScrollEnd(); }, 650);
  });

  /* 넓은 화면에서만 Enter 로 보냅니다.
     모바일에서 Enter 가 전송이면 줄바꿈을 할 수 없습니다. */
  ta.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 700) {
      e.preventDefault(); chatSend();
    }
  });
  btn.addEventListener('click', chatSend);
}

function chatSend(){
  var ta = $('qInput');
  if (!ta || !CHAT_SEND) return;
  var q = (ta.value || '').trim();
  if (!q) return;
  ta.value = ''; ta.style.height = 'auto';
  CHAT_SEND(q);
}

/** 앱이 칩·예시 버튼에서 부릅니다 */
function chatAsk(text){
  if (CHAT_SEND) CHAT_SEND(String(text || '').trim());
}

/** 보내는 동안 입력을 잠급니다 (아이콘은 그대로 둡니다) */
function chatBusy(on){
  var ta = $('qInput'), btn = $('askBtn');
  if (btn) btn.disabled = !!on;
  if (ta) ta.disabled = !!on;
  BUSY = !!on;
}

function chatScrollEnd(){
  var sc = $('chatScroll');
  if (sc) sc.scrollTop = sc.scrollHeight;
}

/** who : 'me' | 'bot' | 'ai' */
function say(who, text){
  var b = $('chatBody');
  if (!b) return null;
  var d = document.createElement('div');
  d.className = 'cmsg ' + who;
  d.innerHTML = linkify(text);
  b.appendChild(d);
  chatScrollEnd();
  return d;
}

/** 답변을 생각하는 동안 점 세 개가 움직입니다. 지울 때 el.remove() */
function typing(){
  var b = $('chatBody');
  if (!b) return { remove: function () {} };
  var d = document.createElement('div');
  d.className = 'cmsg bot';
  d.innerHTML = '<div class="typing"><i></i><i></i><i></i></div>';
  b.appendChild(d);
  chatScrollEnd();
  return d;
}

/** AI 답변 아래에 토큰 사용량을 붙입니다 */
function tokens(el, usage){
  if (!el || !usage) return;
  var u = document.createElement('div');
  u.className = 'tok';
  u.textContent = '토큰 ' + n(usage.total) + '개 사용 (입력 ' + n(usage.input) +
                  ' · 출력 ' + n(usage.output) + ')';
  el.appendChild(u);
  chatScrollEnd();
}

/** 칩 목록 — [{ label:'…', on:함수, gray:true }] */
function chips(list){
  var box = $('chatChips');
  if (!box) return;
  box.innerHTML = '';
  (list || []).forEach(function (c) {
    var b = document.createElement('button');
    b.className = 'chip' + (c.gray ? ' gray' : '');
    b.textContent = c.label;
    b.onclick = c.on;
    box.appendChild(b);
  });
  chatScrollEnd();
}

/** 규칙으로 못 푼 질문 — 되묻기. 문구는 4개 앱이 똑같습니다. */
function confirmChips(onYes, onNo){
  chips([
    { label: TXT.yes, on: function () { chips([]); if (onYes) onYes(); } },
    { label: TXT.no,  gray: true, on: function () { chips([]); if (onNo) onNo(); } }
  ]);
}

function chatClear(){
  setHTML('chatBody', '');
  setHTML('chatChips', '');
  setVal('qInput', '');
  var ta = $('qInput'); if (ta) ta.style.height = 'auto';
}

/* ── 로그인 ─────────────────────────────────────── */
async function login(){
  if (BUSY) return;
  var nm = ($('nm').value || '').trim();
  var pw = ($('pw').value || '').trim();
  if (!nm) { gm(TXT.noName); return; }
  if (!pw) { gm(TXT.noPw); return; }
  gm(TXT.waiting, true);
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
    gm(isTimeout(e) ? TXT.timeout : '연결 실패: ' + e.message);
  } finally { busy(false); }
}

function start(r){
  DATA = r; ROLE = r.role;
  FEAT = r.features || null;   /* 서버가 "이 앱엔 그 기능이 없다"고 알려줍니다 */
  setDisp('gate', 'none');
  setDisp('app', 'flex');
  setText('whoBox', USER + ' · ' + (perm().label || '—'));
  stamp('갱신 ' + (r.updated || '—'), false);
  watermark(true);
  var first = applyTabPerm();
  accessLoaded = false;
  LOGS = []; LOGVIEW = '';
  applyViewportHeight();
  if (CFG.onStart) CFG.onStart(r);
  tab(first || firstPage());
  gm('');
}

/* ── 로그아웃 ───────────────────────────────────────
   보안에 직결되는 상태 초기화를 DOM 조작보다 앞에 둡니다.
   화면 쪽에서 무슨 일이 나도 값은 반드시 지워지게 하기 위해서입니다. */
function logout(){
  try {
    localStorage.removeItem(CFG.store.pw);
    (CFG.legacyKeys || []).forEach(function (k) { localStorage.removeItem(k); });
  } catch (e) {}                       /* 이름은 남겨 재입력을 줄입니다 */

  PW = ''; USER = ''; ROLE = ''; DATA = null; FEAT = null;
  BUSY = false; LAST = 0; LOGS = []; accessLoaded = false; LOGVIEW = ''; IDEM = {};
  document.body.classList.remove('chatmode');
  if (CFG.onLogout) { try { CFG.onLogout(); } catch (e) {} }

  watermark(false);
  busy(false);
  setDisp('app', 'none');
  setDisp('gate', 'flex');
  setVal('pw', '');
  setText('whoBox', '');

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
    if (r.features) FEAT = r.features;
    stamp('갱신 ' + (r.updated || '—'), false);
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
  if (r && r.features) FEAT = r.features;
  if (r && r.updated) stamp('갱신 ' + r.updated, false);
  if (CFG.onData) CFG.onData(r);
}

/* ══════════════════════════════════════════════════
   접근로그 — 접속 / 기록 / 채팅
   --------------------------------------------------
   앱 HTML 은 아래 두 줄만 두면 됩니다.
     <div class="seg" id="segLog"></div>
     <div id="accessBody" data-clear></div>
   서버가 각 줄에 kind 를 붙여 보냅니다.
     access 접속·실패 / work 사람이 한 작업 / chat 질문·답변
     system 자동 처리분 → 코어가 걸러내 화면에 넣지 않습니다.
   ══════════════════════════════════════════════════ */
async function fetchLogs(force){
  if (accessLoaded && !force) return LOGS;
  var r = await api({ action: 'access' });
  if (!r.ok) throw new Error(r.msg || r.error || '불러오지 못했습니다.');
  accessLoaded = true;
  LOGS = (r.logs || []).filter(function (l) { return l.kind !== 'system'; });
  return LOGS;
}

function logKinds(){
  /* 앱이 정하지 않으면 3분류를 다 보여줍니다.
     채팅이 없는 앱은 CFG.logKinds:['access','work'] 로 줄이면 됩니다. */
  return (CFG && CFG.logKinds) || ['access', 'work', 'chat'];
}

async function loadLogs(force){
  var box = CFG.logBox || 'accessBody';
  setHTML(box, '<div class="note">불러오는 중...</div>');
  try {
    await fetchLogs(force);
    logView(LOGVIEW || logKinds()[0]);
  } catch (e) {
    setHTML(box, '<div class="note err">' + esc(failMsg(e, '새로고침을 눌러주세요.')) + '</div>');
  }
}

function buildLogSeg(){
  var seg = $(CFG.logSeg || 'segLog');
  if (!seg || seg.dataset.built === '1') return;
  var kinds = logKinds();
  seg.innerHTML = kinds.map(function (k, i) {
    return '<button data-k="' + k + '"' + (i === 0 ? ' class="on"' : '') + '>' +
           LOGTAB[k].label + '</button>';
  }).join('');
  seg.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-k]');
    if (b) logView(b.dataset.k);
  });
  seg.dataset.built = '1';
}

function logResultClass(result){
  if (result === '실패' || result === '오류' || result === '권한거부') return 'danger';
  if (result === '입력' || result === '확인' || result === '접속' || result === '채팅') return 'ok';
  return '';
}

function logView(k){
  LOGVIEW = k;
  buildLogSeg();
  var seg = $(CFG.logSeg || 'segLog');
  if (seg) {
    Array.prototype.forEach.call(seg.querySelectorAll('button[data-k]'), function (b) {
      b.className = (b.dataset.k === k) ? 'on' : '';
    });
  }

  var box = CFG.logBox || 'accessBody';
  var list = LOGS.filter(function (l) { return l.kind === k; });
  if (!list.length) { setHTML(box, '<div class="note">' + LOGTAB[k].empty + '</div>'); return; }

  var rows = list.map(function (l, i) {
    var cls = logResultClass(l.result);
    var head =
      '<td class="sub2" style="white-space:nowrap">' + esc(l.t) + '</td>' +
      '<td class="ctr ' + cls + '" style="font-size:12px;white-space:nowrap">' + esc(l.result) + '</td>' +
      '<td style="font-size:12px;white-space:nowrap">' + esc(l.user) + '</td>';

    /* 채팅은 질문·답변이 길어 [더보기]로 접어 둡니다 */
    if (k === 'chat') {
      var id = 'vlg' + i;
      var badge = l.ai
        ? ' <span class="badge" style="background:var(--v-ai-bg);border:1px solid var(--v-ai-line);color:var(--v-ai-txt)">AI</span>'
        : '';
      return '<tr>' + head +
        '<td style="font-size:12px"><span class="more" style="margin:0" ' +
          'onclick="VERDAN.toggleBox(\'' + id + '\')">더보기</span>' + badge + '</td></tr>' +
        '<tr id="' + id + '" style="display:none"><td colspan="4" style="padding:0 10px 12px">' +
          '<div class="qa2"><b>질문</b><div>' + esc(l.q || '—') + '</div></div>' +
          '<div class="qa2"><b>답변</b><div>' + linkify(l.a || '—') + '</div></div>' +
        '</td></tr>';
    }

    var tail = (k === 'access') ? esc(l.role || '—') : esc(l.memo);
    return '<tr>' + head + '<td style="font-size:12px">' + tail + '</td></tr>';
  }).join('');

  setHTML(box,
    '<div class="tbl-wrap"><table><thead><tr>' +
    '<th>시각</th><th>결과</th><th>사용자</th>' +
    '<th style="text-align:left">' + LOGTAB[k].col + '</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<div class="sub2">' + list.length + '건 · 시트에는 최근 500건까지 보관됩니다.</div>');
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
  buildLogSeg();

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
  gm(TXT.waiting, true);
  busy(true);
  try {
    var r = await api();
    if (r.ok) { LAST = Date.now(); start(r); }
    else {
      PW = ''; USER = '';
      try { localStorage.removeItem(CFG.store.pw); } catch (e) {}
      gm(TXT.pwChanged);
    }
  } catch (e) {
    PW = ''; USER = '';
    gm(isTimeout(e) ? TXT.timeout : '');
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

  /* 채팅 */
  chatInit: chatInit,
  chatAsk: chatAsk,
  chatBusy: chatBusy,
  chatClear: chatClear,
  chatScrollEnd: chatScrollEnd,
  say: say,
  typing: typing,
  tokens: tokens,
  chips: chips,
  confirmChips: confirmChips,

  /* 접근로그 */
  fetchLogs: fetchLogs,
  loadLogs: loadLogs,
  logView: logView
};

})(window);
