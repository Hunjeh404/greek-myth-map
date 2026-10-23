/* 계정 저장·공유 (Supabase 구글 로그인)
   앱 스크립트보다 먼저 <head>에서 불러온다. 설정은 window.CLOUD_SYNC 로 받는다.
   { app, title, keys: ['키 이름' 또는 '접두어*'], share: true/false, deferStart: true/false,
     summary(data) -> 문자열, theme: {bg, card, ink, soft, accent, font} }
   앱은 지금처럼 localStorage에 저장하고, 이 모듈이 그 키들을 계정과 맞춘다. */
(function () {
  'use strict';
  var URL_ = 'https://rxzqlopkrlftbkzxrqmd.supabase.co';
  var KEY_ = 'sb_publishable_bclbp7IfVuBQpzEFB-yJ5w_LhzyO0yo';
  var C = window.CLOUD_SYNC || {};
  var APP = C.app, META = 'cloudsync.' + APP, BACKUP = 'cloudsync-backup.' + APP;
  var LS = window.localStorage;
  var rawSet = Storage.prototype.setItem, rawRemove = Storage.prototype.removeItem;
  var ready = false, waiters = [], sb = null, user = null, meta = null, info = null;
  var timer = null, pushing = false, again = false, status = 'ok';

  /* ---------- 앱 키 읽고 쓰기 ---------- */
  function mine(k) {
    if (k == null) return false;
    for (var i = 0; i < C.keys.length; i++) {
      var p = C.keys[i];
      if (p.slice(-1) === '*' ? k.indexOf(p.slice(0, -1)) === 0 : k === p) return true;
    }
    return false;
  }
  function readLocal() {
    var o = {};
    for (var i = 0; i < LS.length; i++) {
      var k = LS.key(i); if (!mine(k)) continue;
      var v = LS.getItem(k), j;
      try { j = JSON.parse(v); o[k] = { j: j }; } catch (e) { o[k] = { r: v }; }
    }
    return o;
  }
  function writeLocal(d) {
    var cur = [], k;
    for (var i = 0; i < LS.length; i++) if (mine(LS.key(i))) cur.push(LS.key(i));
    cur.forEach(function (k) { if (!(k in d)) rawRemove.call(LS, k); });
    for (k in d) rawSet.call(LS, k, 'j' in d[k] ? JSON.stringify(d[k].j) : d[k].r);
  }
  function readMeta() { try { return JSON.parse(LS.getItem(META)); } catch (e) { return null; } }
  function saveMeta() { try { rawSet.call(LS, META, JSON.stringify(meta)); } catch (e) {} }
  function empty(d) { return !d || !Object.keys(d).length; }

  /* ---------- 비교와 3방향 합치기 ---------- */
  function isObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }
  function eq(a, b) {
    if (a === b) return true;
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;
      return true;
    }
    if (isObj(a) && isObj(b)) {
      var ka = Object.keys(a), kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      for (var j = 0; j < ka.length; j++) if (!(ka[j] in b) || !eq(a[ka[j]], b[ka[j]])) return false;
      return true;
    }
    return false;
  }
  function merge3(b, l, r) {
    if (eq(l, r) || eq(b, r)) return l;
    if (eq(b, l)) return r;
    if (isObj(l) && isObj(r)) {
      var bo = isObj(b) ? b : {}, out = {}, seen = {};
      Object.keys(r).concat(Object.keys(l)).forEach(function (k) {
        if (seen[k]) return; seen[k] = 1;
        var v = merge3(bo[k], l[k], r[k]);
        if (v !== undefined) out[k] = v;
      });
      return out;
    }
    if (Array.isArray(l) && Array.isArray(r)) return mergeArr(Array.isArray(b) ? b : [], l, r);
    return l; /* 양쪽이 같은 값을 다르게 바꿨으면 이 기기 쪽 */
  }
  function idKeyed(a) {
    var s = {};
    for (var i = 0; i < a.length; i++) {
      var x = a[i]; if (!isObj(x) || x.id == null || s['_' + x.id]) return false; s['_' + x.id] = 1;
    }
    return true;
  }
  function mergeArr(b, l, r) {
    if (l.length && r.length && idKeyed(l) && idKeyed(r) && idKeyed(b)) {
      var bm = {}, lm = {}, rm = {}, order = [], out = [];
      b.forEach(function (x) { bm['_' + x.id] = x; });
      l.forEach(function (x) { lm['_' + x.id] = x; });
      r.forEach(function (x) { rm['_' + x.id] = x; order.push('_' + x.id); });
      l.forEach(function (x) { if (!rm['_' + x.id]) order.push('_' + x.id); });
      order.forEach(function (k) { var v = merge3(bm[k], lm[k], rm[k]); if (v !== undefined) out.push(v); });
      return out;
    }
    if (b.length === l.length && l.length === r.length) {
      return r.map(function (x, i) { return merge3(b[i], l[i], x); });
    }
    var J = JSON.stringify, delta = {}, res = [];
    b.forEach(function (x) { var k = J(x); delta[k] = (delta[k] || 0) - 1; });
    l.forEach(function (x) { var k = J(x); delta[k] = (delta[k] || 0) + 1; });
    r.forEach(function (x) { var k = J(x); if ((delta[k] || 0) < 0) { delta[k]++; return; } res.push(x); });
    l.forEach(function (x) { var k = J(x); if ((delta[k] || 0) > 0) { delta[k]--; res.push(x); } });
    return res;
  }

  /* ---------- 앱이 저장할 때마다 계정에도 저장 ---------- */
  Storage.prototype.setItem = function (k, v) { rawSet.call(this, k, v); if (this === LS && mine(k)) changed(); };
  Storage.prototype.removeItem = function (k) { rawRemove.call(this, k); if (this === LS && mine(k)) changed(); };
  function changed() { if (!ready || !meta) return; clearTimeout(timer); timer = setTimeout(push, 1200); }
  window.addEventListener('pagehide', function () { if (ready && meta) push(); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && ready && meta) push(); });

  function rpc(fn, args) {
    return sb.rpc(fn, args).then(function (res) { if (res.error) throw res.error; return res.data; });
  }
  function push() {
    clearTimeout(timer);
    if (!meta || !sb) return Promise.resolve();
    if (pushing) { again = true; return pushing; }
    setStatus('saving');
    pushing = (function loop(n) {
      var L = readLocal(), payload = merge3(meta.base, L, meta.remote);
      if (eq(payload, meta.remote)) { meta.base = L; saveMeta(); return Promise.resolve(); }
      return rpc('cloud_put', { p_save: meta.save, p_data: payload, p_rev: meta.rev }).then(function (r) {
        if (r.ok) { meta.rev = r.rev; meta.remote = payload; meta.base = L; saveMeta(); return; }
        meta.rev = r.rev; meta.remote = r.data || {}; saveMeta();
        if (n < 5) return loop(n + 1);
        throw new Error('conflict');
      });
    })(0).then(function () { setStatus('ok'); }, function () { setStatus('offline'); })
      .then(function () { pushing = false; if (again) { again = false; return push(); } });
    return pushing;
  }

  /* ---------- 화면 ---------- */
  var T = C.theme || {};
  var css = ''
    + 'html.cs-wait body{visibility:hidden}'
    + '#cs-root{visibility:visible;position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;'
    + 'background:' + (T.bg || '#EDE7D6') + ';font-family:' + (T.font || "'Gowun Dodum','Apple SD Gothic Neo','Malgun Gothic',sans-serif") + ';color:' + (T.ink || '#3A3739') + '}'
    + '#cs-root.cs-dim{background:rgba(30,24,18,.55)}'
    + '.cs-card{background:' + (T.card || '#FFF8DC') + ';border:2px solid ' + (T.ink || '#3A3739') + ';border-radius:14px;padding:22px 20px;max-width:400px;width:100%;box-sizing:border-box;max-height:92vh;overflow:auto;font-size:16px;line-height:1.55}'
    + '.cs-card h2{margin:0 0 8px;font-size:22px}.cs-card p{margin:0 0 12px}.cs-soft{color:' + (T.soft || '#6d676a') + ';font-size:14px}'
    + '.cs-btn{display:block;width:100%;box-sizing:border-box;margin:8px 0 0;padding:12px 14px;border-radius:10px;border:2px solid ' + (T.ink || '#3A3739') + ';background:' + (T.accent || '#C7E1D7') + ';color:inherit;font:inherit;font-size:16px;cursor:pointer}'
    + '.cs-btn.cs-plain{background:transparent}.cs-btn:disabled{opacity:.5}'
    + '.cs-row{display:flex;gap:8px;align-items:center}.cs-row .cs-btn{margin:0;width:auto;padding:8px 12px;font-size:14px}'
    + '.cs-box{border:1px solid ' + (T.soft || '#6d676a') + ';border-radius:10px;padding:10px 12px;margin:10px 0}'
    + '.cs-in{flex:1;min-width:0;padding:9px 10px;border-radius:8px;border:1px solid ' + (T.soft || '#6d676a') + ';font:inherit;font-size:16px}'
    + '.cs-li{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-top:1px dashed ' + (T.soft || '#6d676a') + ';font-size:14px;word-break:break-all}'
    + '.cs-li .cs-btn{width:auto;margin:0;padding:6px 12px;font-size:14px;flex:none}'
    + '.cs-li:first-child{border-top:0}.cs-err{color:#B4442E;font-size:14px;min-height:1em}'
    + '#cs-acct{position:fixed;' + (C.btnPos || 'right:10px;bottom:10px') + ';z-index:2147482000;width:40px;height:40px;border-radius:50%;border:2px solid ' + (T.ink || '#3A3739') + ';'
    + 'background:' + (T.card || '#FFF8DC') + ';color:' + (T.ink || '#3A3739') + ';font:700 16px sans-serif;cursor:pointer;opacity:.85;padding:0}'
    + '#cs-acct i{position:absolute;top:-3px;right:-3px;width:12px;height:12px;border-radius:50%;background:#D9503A;display:none}#cs-acct.cs-new i{display:block}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  document.documentElement.classList.add('cs-wait');

  var root = null;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function body(cb) { if (document.body) cb(); else document.addEventListener('DOMContentLoaded', cb); }
  function show(html, dim) {
    body(function () {
      if (!root) {
        root = document.createElement('div'); root.id = 'cs-root'; document.body.appendChild(root);
        /* 창에서 치는 글자가 게임 조작으로 넘어가지 않게 */
        ['keydown', 'keyup', 'keypress'].forEach(function (t) { root.addEventListener(t, function (e) { e.stopPropagation(); }); });
      }
      root.className = dim ? 'cs-dim' : ''; root.style.display = 'flex';
      root.innerHTML = '<div class="cs-card" role="dialog" aria-modal="true">' + html + '</div>';
    });
  }
  function hide() { if (root) { root.style.display = 'none'; root.innerHTML = ''; } }
  function $(s) { return root.querySelector(s); }
  function ask(title, text, buttons, dim) {
    return new Promise(function (res) {
      show('<h2>' + esc(title) + '</h2>' + text + buttons.map(function (b, i) {
        return '<button class="cs-btn' + (b.plain ? ' cs-plain' : '') + '" data-i="' + i + '">' + esc(b.t) + '</button>';
      }).join(''), dim);
      body(function () { root.querySelectorAll('[data-i]').forEach(function (el) { el.onclick = function () { res(buttons[+el.dataset.i].v); }; }); });
    });
  }
  function when(t) { try { return new Date(t).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } }
  function sum(d) { try { return C.summary ? C.summary(d) : ''; } catch (e) { return ''; } }

  /* ---------- 시작 ---------- */
  var snap = readLocal();
  meta = readMeta();

  var scriptSrc = (document.currentScript || {}).src;

  function loginScreen(msg) {
    /* 로그인 전 화면에서 앱이 써 둔 기본값은 기기 기록으로 치지 않는다 */
    if (!meta && empty(snap)) { meta = { fresh: true }; saveMeta(); }
    show('<h2>' + esc(C.title || '') + '</h2><p>가족 계정으로 로그인해야 쓸 수 있어요.</p>'
      + (msg ? '<p class="cs-err">' + esc(msg) + '</p>' : '')
      + '<button class="cs-btn" id="cs-g">구글로 로그인</button>');
    body(function () {
      $('#cs-g').onclick = function () {
        this.disabled = true;
        sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } })
          .then(function (r) { if (r.error) loginScreen('로그인을 시작하지 못했어요. 다시 눌러 주세요.'); });
      };
    });
  }

  function done(changedLocal) {
    if (changedLocal && !C.deferStart) { location.reload(); return; }
    ready = true; hide();
    document.documentElement.classList.remove('cs-wait');
    body(accountButton);
    waiters.splice(0).forEach(function (f) { try { f(); } catch (e) { console.error(e); } });
  }

  function settle(R, payload) {
    /* 이 기기를 payload로 맞추고, 계정과 다르면 올린다 */
    var changedLocal = !eq(payload, snap);
    writeLocal(payload);
    meta = { uid: user.id, save: info.save_id, rev: info.rev, remote: R, base: R };
    saveMeta();
    var p = eq(payload, R) ? Promise.resolve() : push();
    return p.then(function () { done(changedLocal); });
  }

  function start() {
    var src = scriptSrc;
    (window.supabase ? Promise.resolve() : new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = (src ? src.replace(/cloud-sync\.js.*$/, '') : '') + 'supabase.js';
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    })).then(function () {
      sb = window.supabase.createClient(URL_, KEY_, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
      return sb.auth.getSession();
    }).then(function (r) {
      var s = r.data && r.data.session;
      if (location.search.indexOf('code=') >= 0) history.replaceState(null, '', location.pathname + location.hash);
      if (!s) return loginScreen();
      user = s.user;
      show('<p>계정 기록을 불러오는 중…</p>');
      return rpc('cloud_open', { p_app: APP }).then(function (o) { info = o; return decide(); }, function () {
        if (meta && meta.uid === user.id) { setStatus('offline'); return done(false); }
        show('<h2>' + esc(C.title || '') + '</h2><p>인터넷에 연결되지 않아 계정 기록을 불러오지 못했어요.</p><button class="cs-btn" id="cs-re">다시 시도</button>');
        body(function () { $('#cs-re').onclick = function () { location.reload(); }; });
      });
    }).catch(function () {
      show('<h2>' + esc(C.title || '') + '</h2><p>로그인 기능을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.</p><button class="cs-btn" id="cs-re">다시 시도</button>');
      body(function () { $('#cs-re').onclick = function () { location.reload(); }; });
    });
  }

  function decide() {
    var R = info.data || {};
    if (meta && meta.uid === user.id && meta.save === info.save_id) {
      return settle(R, merge3(meta.base, snap, R));
    }
    if (meta && (meta.uid || meta.fresh)) return settle(R, R); /* 다른 계정이 쓰던 기기, 공유가 바뀜, 로그인 전 기본값 */
    if (empty(snap)) return settle(R, R);
    var here = sum(snap), there = sum(R);
    if (empty(R)) {
      return ask('이 기기 기록 옮기기', '<p>이 기기에 저장된 기록이 있어요. 로그인한 계정(' + esc(user.email) + ')으로 옮길까요?</p>'
        + (here ? '<div class="cs-box cs-soft">' + esc(here) + '</div>' : ''),
        [{ t: '계정으로 옮기기', v: 'move' }, { t: '옮기지 않고 새로 시작', v: 'skip', plain: true }]).then(function (v) {
          if (v === 'move') return settle(R, snap);
          rawSet.call(LS, BACKUP, JSON.stringify(snap));
          return settle(R, R);
        });
    }
    return ask('어느 기록을 쓸까요?', '<p>이 기기와 계정에 서로 다른 기록이 있어요. 하나를 골라 주세요. 고르지 않은 기록은 지워집니다.</p>'
      + '<div class="cs-box"><b>이 기기</b><div class="cs-soft">' + esc(here || '저장된 기록') + '</div></div>'
      + '<div class="cs-box"><b>계정</b><div class="cs-soft">' + esc(there || '저장된 기록') + '<br>' + esc(when(info.updated_at)) + ' 저장</div></div>',
      [{ t: '이 기기 기록을 계정으로 옮기기', v: 'device' }, { t: '계정 기록 쓰기', v: 'cloud', plain: true }]).then(function (v) {
        if (v === 'device') return settle(R, snap);
        rawSet.call(LS, BACKUP, JSON.stringify(snap));
        return settle(R, R);
      });
  }

  /* ---------- 계정 단추와 창 ---------- */
  var btn = null;
  function setStatus(s) { status = s; var el = root && root.querySelector('#cs-st'); if (el) el.textContent = statusText(); }
  function statusText() { return status === 'saving' ? '저장 중…' : status === 'offline' ? '인터넷에 연결되면 저장돼요' : '계정에 저장됨'; }
  function accountButton() {
    if (btn) return;
    btn = document.createElement('button'); btn.id = 'cs-acct'; btn.setAttribute('aria-label', '계정');
    btn.innerHTML = esc((user.email || '?')[0].toUpperCase()) + '<i></i>';
    btn.onclick = panel; document.body.appendChild(btn);
    if (info && info.incoming && info.incoming.length) btn.classList.add('cs-new');
  }
  function refresh() { return rpc('cloud_open', { p_app: APP }).then(function (o) { info = o; }); }

  function panel() {
    var p = info || {}, me = user.email;
    var people = (p.people || []).filter(function (x) { return x.email !== (me || '').toLowerCase(); });
    var h = '<h2>계정</h2><p>' + esc(me) + '<br><span class="cs-soft" id="cs-st">' + statusText() + '</span></p>';
    if (C.share) {
      h += '<div class="cs-box"><b>기록 함께 쓰기</b>';
      if (people.length) {
        h += '<p class="cs-soft">아래 사람과 이 앱 기록을 같이 써요.</p>' + people.map(function (x) {
          var act = p.owner ? '<button class="cs-btn cs-plain" data-kick="' + x.id + '">빼기</button>' : '';
          return '<div class="cs-li"><span>' + esc(x.email) + (x.role === 'owner' ? ' (초대한 사람)' : '') + '</span>' + act + '</div>';
        }).join('');
        if (!p.owner) h += '<button class="cs-btn cs-plain" id="cs-leave">함께 쓰기 그만두기</button>';
      } else h += '<p class="cs-soft">가족 계정을 초대하면, 상대가 수락한 뒤부터 이 앱 기록을 같은 계정처럼 함께 써요.</p>';
      h += '<div class="cs-row" style="margin-top:8px"><input class="cs-in" id="cs-em" type="email" placeholder="초대할 구글 이메일" autocomplete="off"><button class="cs-btn" id="cs-inv">초대</button></div><p class="cs-err" id="cs-msg"></p>';
      (p.outgoing || []).forEach(function (x) { h += '<div class="cs-li"><span>' + esc(x.to) + ' 수락 기다리는 중</span><button class="cs-btn cs-plain" data-cancel="' + x.id + '">취소</button></div>'; });
      (p.incoming || []).forEach(function (x) { h += '<div class="cs-li"><span>' + esc(x.from) + '님이 초대했어요</span><span class="cs-row"><button class="cs-btn" data-yes="' + x.id + '" data-from="' + esc(x.from) + '">수락</button><button class="cs-btn cs-plain" data-no="' + x.id + '">거절</button></span></div>'; });
      h += '</div>';
    }
    h += '<button class="cs-btn cs-plain" id="cs-out">로그아웃</button><button class="cs-btn" id="cs-close">닫기</button>';
    show(h, true);
    $('#cs-close').onclick = hide;
    root.onclick = function (e) { if (e.target === root) hide(); };
    $('#cs-out').onclick = function () {
      this.disabled = true;
      push().then(function () {
        writeLocal({}); rawRemove.call(LS, META);
        return sb.auth.signOut();
      }).then(function () { location.reload(); }, function () { location.reload(); });
    };
    if (!C.share) return;
    var msg = function (t) { $('#cs-msg').textContent = t; };
    $('#cs-inv').onclick = function () {
      var em = $('#cs-em').value.trim(); if (!em) return msg('이메일을 적어 주세요.');
      this.disabled = true;
      rpc('cloud_invite', { p_app: APP, p_email: em }).then(function (r) {
        if (!r.ok) return msg(r.why === 'self' ? '내 이메일은 초대할 수 없어요.' : r.why === 'already' ? '이미 함께 쓰고 있어요.' : '이메일 형식을 확인해 주세요.');
        return refresh().then(panel);
      }, function () { msg('초대를 보내지 못했어요. 인터넷 연결을 확인해 주세요.'); }).then(function () { var b = $('#cs-inv'); if (b) b.disabled = false; });
    };
    root.querySelectorAll('[data-cancel]').forEach(function (b) {
      b.onclick = function () { rpc('cloud_invite_cancel', { p_invite: b.dataset.cancel }).then(refresh).then(panel, function () { msg('취소하지 못했어요.'); }); };
    });
    root.querySelectorAll('[data-no]').forEach(function (b) {
      b.onclick = function () { rpc('cloud_invite_respond', { p_invite: b.dataset.no, p_accept: false }).then(refresh).then(function () { if (!info.incoming.length && btn) btn.classList.remove('cs-new'); panel(); }); };
    });
    root.querySelectorAll('[data-yes]').forEach(function (b) {
      b.onclick = function () {
        var id = b.dataset.yes, from = b.dataset.from;
        ask('초대 수락', '<p>수락하면 ' + esc(from) + '님과 이 앱 기록을 함께 써요.</p><p>지금 이 계정에 있던 이 앱 기록은 지워지고 ' + esc(from) + '님의 기록으로 바뀝니다.</p>',
          [{ t: '수락하기', v: true }, { t: '취소', v: false, plain: true }], true).then(function (ok) {
            if (!ok) return panel();
            push().then(function () { return rpc('cloud_invite_respond', { p_invite: id, p_accept: true }); }).then(function (r) {
              if (r.ok) return location.reload();
              ask('수락하지 못했어요', '<p>' + (r.why === 'has_members' ? '이 계정 기록을 이미 다른 사람과 함께 쓰고 있어요. 먼저 함께 쓰는 사람을 모두 뺀 뒤 수락해 주세요.' : '초대가 취소됐거나 이미 처리됐어요.') + '</p>', [{ t: '확인', v: 1 }], true).then(function () { refresh().then(panel); });
            }, function () { ask('수락하지 못했어요', '<p>인터넷 연결을 확인해 주세요.</p>', [{ t: '확인', v: 1 }], true).then(panel); });
          });
      };
    });
    root.querySelectorAll('[data-kick]').forEach(function (b) {
      b.onclick = function () {
        ask('함께 쓰기에서 빼기', '<p>빼면 그 사람 계정에는 지금까지의 기록이 한 부 복사되고, 이후로는 따로 저장돼요.</p>', [{ t: '빼기', v: true }, { t: '취소', v: false, plain: true }], true).then(function (ok) {
          if (!ok) return panel();
          rpc('cloud_leave', { p_app: APP, p_user: b.dataset.kick }).then(refresh).then(panel, function () { msg('처리하지 못했어요.'); });
        });
      };
    });
    var lv = $('#cs-leave');
    if (lv) lv.onclick = function () {
      ask('함께 쓰기 그만두기', '<p>그만두면 지금까지의 기록을 한 부 복사해서 내 계정에 따로 저장해요.</p>', [{ t: '그만두기', v: true }, { t: '취소', v: false, plain: true }], true).then(function (ok) {
        if (!ok) return panel();
        push().then(function () { return rpc('cloud_leave', { p_app: APP }); }).then(function () { location.reload(); }, function () { panel(); });
      });
    };
  }

  window.CloudSync = {
    whenReady: function (f) { if (ready) f(); else waiters.push(f); },
    get isReady() { return ready; },
    _merge3: merge3
  };
  start();
})();
