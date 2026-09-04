(function () {
  'use strict';

  const BITS = {
    OPTION: 2, EXIT: 4, NEW_QUEST: 8, CONT_QUEST: 16, SHOP: 32, ATTACK: 64,
    GAME: 128, HEAL: 256, MOTEL: 2048, AUCTION: 4096, MAIL: 8192,
    DEPO: 16384, BARTER: 65536, BONUS_RESELECT: 131072,
  };
  const CLASS_BY_BIT = {
    2: 'line_option', 4: 'line_exit', 8: 'line_new_quest', 16: 'line_cont_quest',
    32: 'line_shop', 64: 'line_attack', 128: 'line_game', 256: 'line_heal',
    512: 'line_option', 1024: 'line_option', 2048: 'line_motel', 4096: 'line_auction',
    8192: 'line_mail', 16384: 'line_depo', 32768: 'line_option',
    65536: 'line_barter', 131072: 'line_bonus_reselect',
  };

  const CFG = {
    tickMs: 250,
    tile: 32,
    clickIntervalMs: 1000,
    arrivalStableMs: 1200,
    talkDelayMs: 150,
    talkRetryMs: 2000,
    talkMaxTries: 3,
    talkRadius: 1,
    sameTargetMaxTalks: 3,
    sameTargetPauseMs: 30000,
    doneTtlMs: 60000,
    arrowRetryMs: 12000,
    maxTargetDistance: 100,
    navStuckMs: 3000,
    stuckGiveUpTries: 4,
    nudgeCooldownMs: 1500,
    nudgeGhostGiveUpTries: 3,
    itemRetryMs: 4000,
    decisionPollMs: 300,
    collectExp: true,
    keyTalk: { key: 'q', code: 'KeyQ', keyCode: 81 },
    keyAttack: { key: 'e', code: 'KeyE', keyCode: 69 },
    keyUp: { key: 'w', code: 'KeyW', keyCode: 87 },
    keyDown: { key: 's', code: 'KeyS', keyCode: 83 },
    keyLeft: { key: 'a', code: 'KeyA', keyCode: 65 },
    keyRight: { key: 'd', code: 'KeyD', keyCode: 68 },
    pathReplanMs: 4000, // okresowe przeliczenie trasy A* nawet bez utknięcia (dynamiczne przeszkody)
    itemFallbackEnabled: false,
    minSendGapMs: 250,
    maxSendPer10s: 18,
    idleFallbackMs: 10000,
    navScanMs: 3000, // cykliczny skan nawigacji w stanie NAV — nie czekamy pełnych idleFallbackMs na bezruch
    questBitPriority: [BITS.CONT_QUEST, BITS.NEW_QUEST],
    avoidBits: [BITS.EXIT],
    skipRe: /pomiń/i,
    loopBreakAfter: 2,
    dialogueDelayMs: 30,
    dialogueJitter: 0.4,
    dialogueHesitate: false,
    dialoguePollMs: 40,
    frameFreshMs: 3000,
    stuckAnswerMs: 800,
    afterDialogueCooldownMs: 300,
    fallbackOption: 1,
    dedupWindowMs: 500,
    answerMaxAgeMs: 15000,
    jitter: 0.35,
    hesitateChance: 0.12,
    hesitateMs: [180, 700],
    clickJitterPx: 4,
    restEnabled: true,
    restEveryMs: [7 * 60000, 14 * 60000],
    restForMs: [25000, 90000],
    microRestChance: 0.05,
    microRestMs: [1500, 5000],
    debug: true,
  };

  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  let running = false;
  const log = (...a) => CFG.debug && console.log('%c[MQ]', 'color:#6cf;font-weight:bold', ...a);
  const safe = fn => { try { return fn(); } catch (e) { return null; } };
  const E = () => W.Engine;
  const ready = () => { const e = E(); return !!(e && e.allInit && e.hero && e.hero.d); };

  const hasBit = (code, bit) => {
    const n = parseInt(code, 10);
    return Number.isFinite(n) && (n & bit) !== 0;
  };

  const rnd = (a, b) => a + Math.random() * (b - a);
  const jit = (base, spread = CFG.jitter) =>
    Math.max(15, Math.round(base * rnd(1 - spread, 1 + spread)));
  const hesitation = () =>
    Math.random() < CFG.hesitateChance ? Math.round(rnd(CFG.hesitateMs[0], CFG.hesitateMs[1])) : 0;

  let restUntil = 0, nextRestAt = 0, activeSince = 0;
  function scheduleNextRest() {
    nextRestAt = Date.now() + rnd(CFG.restEveryMs[0], CFG.restEveryMs[1]);
  }
  function inRest() {
    if (!CFG.restEnabled) return false;
    const now = Date.now();
    if (now < restUntil) return true;
    if (nextRestAt && now >= nextRestAt) {
      const dur = Math.round(rnd(CFG.restForMs[0], CFG.restForMs[1]));
      restUntil = now + dur;
      scheduleNextRest();
      log('przerwa odpoczynku:', (dur / 1000).toFixed(0) + 's');
      safe(updateBadge);
      return true;
    }
    return false;
  }
  function microRest() {
    if (!CFG.restEnabled || Math.random() >= CFG.microRestChance) return 0;
    return Math.round(rnd(CFG.microRestMs[0], CFG.microRestMs[1]));
  }

  let lastSendAt = 0, nextGapMs = 0;
  const sendTimes = [];
  function gSend(cmd) {
    const now = Date.now();
    if (now - lastSendAt < (nextGapMs || CFG.minSendGapMs)) return false;
    while (sendTimes.length && now - sendTimes[0] > 10000) sendTimes.shift();
    if (sendTimes.length >= CFG.maxSendPer10s) { log('limit zapytań — wstrzymuję:', cmd); return false; }
    if (typeof W._g !== 'function') return false;
    try {
      W._g(cmd);
      lastSendAt = now;
      nextGapMs = jit(CFG.minSendGapMs);
      sendTimes.push(now);
      return true;
    } catch (e) { log('_g błąd:', e.message); return false; }
  }
  function allClasses(code) {
    const n = parseInt(code, 10);
    if (!Number.isFinite(n)) return [];
    const out = [];
    for (let b = 1; b <= 131072; b <<= 1) if (n & b) out.push(CLASS_BY_BIT[b] || ('bit' + b));
    return out;
  }

  const knownNames = new Map();
  let arrowHooked = false, lastMapForNames = '';

  function noteArrowNames() {
    for (const a of getArrows()) {
      const id = safe(() => a.id) || '';
      if (!/TRACKING_ARROW/.test(id)) continue;
      const p = parseArrowId(a);
      if (p && p.name) knownNames.set(p.name, Date.now());
    }
  }

  function hookArrows() {
    if (arrowHooked) return;
    const tg = E() && E().targets;
    if (!tg || typeof tg.addArrow !== 'function') return;
    const orig = tg.addArrow.bind(tg);
    tg.addArrow = function (...args) {
      const res = orig(...args);
      safe(noteArrowNames);
      return res;
    };
    arrowHooked = true;
    log('hook na addArrow — nazwy celów zbierane też dla niewidocznych strzałek');
  }

  function pointerPositions() {
    const qt = E() && E().questTracking;
    if (!qt || typeof qt.getPosByPointerName !== 'function') return [];
    const out = [];
    for (const name of knownNames.keys()) {
      const res = safe(() => qt.getPosByPointerName(name, name));
      const arr = Array.isArray(res) ? res : (res ? [res] : []);
      for (const p of arr) {
        const x = p && (p.x ?? p[0]), y = p && (p.y ?? p[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) out.push({ name, x, y });
      }
    }
    return out;
  }

  function targetFromPos(p) {
    const cands = npcList().map(npcInfo).filter(Boolean).filter(n => Number.isFinite(n.x));
    let npc = cands.find(n => n.x === p.x && n.y === p.y) || null;
    if (!npc) {
      npc = cands.filter(n => chebyshev(n, p) <= 2)
                 .filter(n => isTrackedNpc(n) || (p.name && n.name === p.name))
                 .sort((a, b) => chebyshev(a, p) - chebyshev(b, p))[0] || null;
    }
    return {
      arrow: null, tile: { x: p.x, y: p.y }, npc,
      key: npc ? 'npc:' + npc.id : 'tile:' + p.x + ',' + p.y,
      viaPointer: true, name: p.name,
    };
  }

  function getArrows() {
    const l = safe(() => E().targets.getDrawableList()) || [];
    return Array.isArray(l) ? l : Object.values(l);
  }
  function getTrackingArrow() {
    for (const a of getArrows()) if (/TRACKING_ARROW/.test(safe(() => a.id) || '')) return a;
    return null;
  }
  function getMapSize() {
    const d = safe(() => E().map.d);
    const w = d && +d.x, h = d && +d.y;
    return (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) ? { w, h } : null;
  }
  function parseArrowId(a) {
    const m = /^(.*?)(\d+),(\d+)TRACKING_ARROW$/.exec(safe(() => a && a.id) || '');
    if (!m) return null;
    let name = m[1], xs = m[2];
    const y = +m[3];
    const ms = getMapSize();
    if (ms) {
      while (xs.length > 1 && +xs >= ms.w) { name += xs[0]; xs = xs.slice(1); }
      if (+xs >= ms.w || y >= ms.h) return null;
    }
    return { name, x: +xs, y };
  }
  function npcInfo(o) {
    if (!o || typeof o !== 'object') return null;
    const d = o.d && typeof o.d === 'object' ? o.d : o;
    const id = d.id ?? o.id;
    if (id === undefined || id === null) return null;
    return { id: String(id), x: d.x, y: d.y, name: d.nick ?? d.name ?? d.tpl_name, obj: o };
  }
  function npcList() {
    const n = E() && E().npcs;
    if (!n) return [];
    for (const g of [() => n.getDrawableList(), () => n.getList(), () => n.list]) {
      const v = safe(g);
      if (!v) continue;
      const arr = Array.isArray(v) ? v : Object.values(v);
      if (arr.length && typeof arr[0] === 'object') return arr;
    }
    return [];
  }
  const doneTargets = new Map();

  function buildTarget(arrow) {
    const idTile = parseArrowId(arrow);
    const par = safe(() => arrow.objParent);

    let tile = idTile;
    if (par && Number.isFinite(par.x) && Number.isFinite(par.y)) {
      tile = { name: par.name || (idTile && idTile.name) || '', x: par.x, y: par.y };
    }

    let npc = npcInfo(par);
    if (!npc && tile) {
      const cands = npcList().map(npcInfo).filter(Boolean).filter(n => Number.isFinite(n.x));
      npc = cands.find(n => n.x === tile.x && n.y === tile.y) || null;
      if (!npc) {
        npc = cands.filter(n => chebyshev(n, tile) <= 1)
                   .filter(isTrackedNpc)
                   .sort((a, b) => chebyshev(a, tile) - chebyshev(b, tile))[0] || null;
      }
      const kqNames = killQuestNames();
      const isHuntedName = n => (huntName && nameMatches(n, huntName)) ||
                                 kqNames.some(k => nameMatches(k, n));
      if (!npc && isHuntedName(tile.name)) {
        npc = cands.filter(n => isHuntedName(n.name))
                   .sort((a, b) => chebyshev(a, tile) - chebyshev(b, tile))[0] || null;
        if (npc) log('widmowa strzałka — dopasowano po nazwie gatunku:', npc.name || npc.id);
      }
    }
    if (!tile && !npc) return null;
    const key = npc ? 'npc:' + npc.id : 'tile:' + tile.x + ',' + tile.y;
    return { arrow, tile, npc, key };
  }

  function allTargets() {
    const out = [];
    for (const a of getArrows()) {
      if (!/TRACKING_ARROW/.test(safe(() => a.id) || '')) continue;
      const t = buildTarget(a);
      if (t) out.push(t);
    }
    return out;
  }

  function currentTarget() {
    const list = allTargets();

    for (const [k, ts] of [...doneTargets.entries()]) {
      if (Date.now() - ts > CFG.doneTtlMs) doneTargets.delete(k);
    }

    const isDone = t => doneTargets.has(t.key) ||
      (t.npc && doneTargets.has('npc:' + t.npc.id)) ||
      (t.tile && doneTargets.has('tile:' + t.tile.x + ',' + t.tile.y));

    const sane = t => {
      const d = distanceToTarget(t);
      if (d <= CFG.maxTargetDistance) return true;
      if (d !== lastInsaneLogged) { lastInsaneLogged = d; log('odrzucam cel o dystansie', d, '— podejrzane koordynaty', t.tile); }
      return false;
    };

    const pending = list.filter(t => !isDone(t) && sane(t));
    if (pending.length) {
      pending.sort((a, b) => distanceToTarget(a) - distanceToTarget(b));
      return pending[0];
    }

    if (list.length) {
      const sanel = list.filter(sane);
      if (sanel.length) {
        sanel.sort((a, b) => distanceToTarget(a) - distanceToTarget(b));
        const t = sanel[0];
        const ts = doneTargets.get(t.key) || 0;
        if (Date.now() - ts > CFG.arrowRetryMs) {
          doneTargets.delete(t.key);
          if (t.npc) doneTargets.delete('npc:' + t.npc.id);
          if (t.tile) doneTargets.delete('tile:' + t.tile.x + ',' + t.tile.y);
          log('strzałka wciąż wskazuje', t.key, '— ponawiam podejście');
          return t;
        }
      }
      return null;
    }

    const viaPtr = pointerPositions().map(targetFromPos)
      .filter(t => !isDone(t) && sane(t))
      .sort((a, b) => distanceToTarget(a) - distanceToTarget(b));
    if (viaPtr.length) {
      const t = viaPtr[0];
      if (t.key !== lastPtrLogged) {
        lastPtrLogged = t.key;
        log('cel ze wskaźnika silnika:', t.name, '->', t.tile.x + ',' + t.tile.y,
            t.npc ? '| NPC: ' + (t.npc.name || t.npc.id) : '| bez NPC');
      }
      return t;
    }

    const h = E().hero.d;
    const tracked = npcList().map(npcInfo).filter(Boolean)
      .filter(n => Number.isFinite(n.x) && !doneTargets.has('npc:' + n.id))
      .filter(n => chebyshev(h, n) <= CFG.maxTargetDistance)
      .filter(n => isTrackedNpc(n) || (huntName && n.name === huntName))
      .sort((a, b) => chebyshev(h, a) - chebyshev(h, b));

    if (tracked.length) {
      const n = tracked[0];
      if (tracked.length !== lastTrackedCount) {
        lastTrackedCount = tracked.length;
        log('bez strzałki — celów śledzonych na mapie:', tracked.length, '| najbliższy:', n.name || n.id, 'w', chebyshev(h, n));
      }
      return { arrow: null, tile: { x: n.x, y: n.y }, npc: n, key: 'npc:' + n.id, nearOnly: true };
    }
    lastTrackedCount = -1;

    const near = npcInfo(safe(() => E().questTracking.getNearTrackingNpc()));
    if (near) {
      const key = 'npc:' + near.id;
      if (!doneTargets.has(key)) return { arrow: null, tile: null, npc: near, key, nearOnly: true };
    }
    return null;
  }

  let lastTrackedCount = -1;
  let lastPtrLogged = '';
  let lastInsaneLogged = -1;
  let huntName = '';
  let tplCache = { at: 0, val: [] };
  function trackedTpls() {
    const now = Date.now();
    if (now - tplCache.at < 1000) return tplCache.val;
    const d = safe(() => E().questTracking.getItemsData());
    const out = [];
    if (d) for (const k of ['tplArray', 'kindArray']) {
      if (Array.isArray(d[k])) out.push(...d[k].map(v => String(v && v.id != null ? v.id : v)));
    }
    tplCache = { at: now, val: out };
    return out;
  }
  function isTrackedNpc(n) {
    const qt = E() && E().questTracking;
    if (!qt || !n) return false;
    if (safe(() => qt.checkTrackingNpcExist(n.id)) ||
        safe(() => qt.checkTrackingNpcExist(Number(n.id))) ||
        safe(() => qt.checkTrackingNpcExist(n.obj))) return true;
    const tpls = trackedTpls();
    if (!tpls.length) return false;
    const d0 = safe(() => n.obj && n.obj.d) || {};
    return [d0.tpl, d0.tplId, d0.kind, d0.nick, d0.name].some(v => v != null && tpls.includes(String(v)));
  }

  function markDone(t, why) {
    if (!t) return;
    const keys = (typeof t === 'string') ? [t] : [
      t.key,
      t.npc ? 'npc:' + t.npc.id : null,
      t.tile ? 'tile:' + t.tile.x + ',' + t.tile.y : null,
    ].filter(Boolean);
    const now = Date.now();
    keys.forEach(k => doneTargets.set(k, now));
    log('cel załatwiony:', keys.join(' + '), '(' + why + ')');
  }
  const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  function distanceToTarget(t) {
    const h = E().hero.d;
    const p = (t.npc && Number.isFinite(t.npc.x)) ? t.npc : t.tile;
    if (!p || !Number.isFinite(p.x)) return Infinity;
    return chebyshev(h, p);
  }

  let lastDialogue = null, lastFrameKey = '', lastFrameAt = 0, lastAnswerAt = 0;

  (function hookWS() {
    const Native = W.WebSocket;
    if (!Native || Native.__mqHooked) return;
    const P = new Proxy(Native, {
      construct(t, args) {
        const s = new t(...args);
        s.addEventListener('message', ev => { if (typeof ev.data === 'string') handleRaw(ev.data, 'ws'); });
        return s;
      },
    });
    P.__mqHooked = true;
    W.WebSocket = P;
    log('hook na WebSocket założony');
  })();

  (function hookFetch() {
    const nf = W.fetch;
    if (!nf || nf.__mqHooked) return;
    const wrapped = function (...args) {
      const p = nf.apply(this, args);
      p.then(r => {
        try {
          const url = String((args[0] && args[0].url) || args[0] || '');
          if (!/engine|\bg=|margonem/.test(url)) return;
          r.clone().text().then(t => handleRaw(t, 'fetch')).catch(() => {});
        } catch (e) {}
      }).catch(() => {});
      return p;
    };
    wrapped.__mqHooked = true;
    W.fetch = wrapped;
    log('hook na fetch założony');
  })();

  (function hookXHR() {
    const X = W.XMLHttpRequest;
    if (!X || X.prototype.__mqHooked) return;
    const open = X.prototype.open;
    X.prototype.open = function (...args) {
      if (!this.__mqBound) {
        this.__mqBound = true;
        this.addEventListener('load', () => {
          try { if (typeof this.responseText === 'string') handleRaw(this.responseText, 'xhr'); } catch (e) {}
        });
      }
      return open.apply(this, args);
    };
    X.prototype.__mqHooked = true;
    log('hook na XHR założony');
  })();

  function handleRaw(raw, via) {
    let p;
    try { p = JSON.parse(raw); } catch (e) { return; }
    onFrame(p, via);
  }

  function onFrame(p, via) {
    if (!running) return;
    if (!p || !Array.isArray(p.d) || p.d.length < 6 || p.e !== 'ok') return;
    const d = p.d;
    if (typeof d[1] !== 'string' || !d[1] || typeof d[4] !== 'string' || !d[4]) return;

    const options = [];
    if (d[5] === '') {
      for (let i = 6; i + 2 < d.length; i += 3) options.push({ code: d[i], text: d[i + 1], nodeId: d[i + 2] });
    } else if (d.length === 6) {
      options.push({ code: null, text: '(kontynuuj)', nodeId: d[5] });
    }
    if (!options.length) return;

    const key = d[2] + '|' + options.map(o => o.nodeId).join(',');
    const now = Date.now();
    if (key === lastFrameKey && now - lastFrameAt < CFG.dedupWindowMs) return;
    lastFrameKey = key;
    lastFrameAt = now;

    lastDialogue = { npcName: d[1], npcId: String(d[2]), text: d[4], options, at: now };
    log('dialog(' + (via || '?') + '):', d[1], '|', options.map(o => '[' + o.code + ' ' + (allClasses(o.code).join('+') || '-') + '] ' + o.text));
    const hes = CFG.dialogueHesitate ? hesitation() : 0;
    setTimeout(answerDialogue, jit(CFG.dialogueDelayMs, CFG.dialogueJitter) + hes);
  }

  const dialogueLoopTracker = new Map();
  function loopBreakPick(nonExitIdxs, allTexts) {
    if (nonExitIdxs.length <= 1) return null;
    const sig = allTexts.map(norm2).sort().join('|');
    let rec = dialogueLoopTracker.get(sig);
    if (!rec) rec = { idx: 1, count: 0 };
    rec.count++;
    dialogueLoopTracker.set(sig, rec);
    if (rec.count <= CFG.loopBreakAfter) return null;
    const pick = nonExitIdxs[rec.idx % nonExitIdxs.length];
    const cycle = (rec.idx % nonExitIdxs.length) + 1;
    rec.idx++;
    dialogueLoopTracker.set(sig, rec);
    return { pick, tries: rec.count, cycle, total: nonExitIdxs.length };
  }

  function pickOption(options) {
    if (options.length === 1) return { idx: 0, why: 'jedyna opcja' };
    for (const bit of CFG.questBitPriority) {
      const i = options.findIndex(o => hasBit(o.code, bit));
      if (i >= 0) return { idx: i, why: CLASS_BY_BIT[bit] + ' (code ' + options[i].code + ')' };
    }
    if (shopStageNames().length) {
      const sh = options.findIndex(o => hasBit(o.code, BITS.SHOP));
      if (sh >= 0) { shopOpenedByBot = true; return { idx: sh, why: 'sklep (etap wymaga zakupu)' }; }
    }
    const s = options.findIndex(o => CFG.skipRe.test(o.text || ''));
    if (s >= 0) return { idx: s, why: 'pomiń przerywnik' };

    const nonExitIdxs = options.map((o, i) => i).filter(i => !CFG.avoidBits.some(b => hasBit(options[i].code, b)));
    const lb = loopBreakPick(nonExitIdxs, options.map(o => o.text || ''));
    if (lb) return { idx: lb.pick, why: 'łamanie pętli (próba ' + lb.tries + ', opcja ' + lb.cycle + '/' + lb.total + ')' };

    if (nonExitIdxs.length) return { idx: nonExitIdxs[0], why: 'pierwsza nie-wyjściowa (code ' + options[nonExitIdxs[0]].code + ')' };
    return { idx: Math.min(Math.max(0, CFG.fallbackOption - 1), options.length - 1), why: 'fallback' };
  }

  function answerDialogue(tag) {
    if (!running) return false;
    if (!lastDialogue || Date.now() - lastDialogue.at > CFG.answerMaxAgeMs) return false;
    const { idx, why } = pickOption(lastDialogue.options);
    const o = lastDialogue.options[idx];
    if (!o) return false;
    if (!gSend('talk&id=' + lastDialogue.npcId + '&c=' + o.nodeId)) return false;
    log('wybrano [' + idx + '] "' + o.text + '" — ' + why + (tag ? ' [' + tag + ']' : ''));
    state = 'DIALOG';
    lastDialogueAt = Date.now();
    lastAnswerAt = Date.now();
    return true;
  }

  const isDialogueOpen = () => { const d = E() && E().dialogue; return !!d && d !== false; };

  function dialogueRoot() {
    const d = E() && E().dialogue;
    const $ = safe(() => d && d.$);
    return ($ && $[0]) || document.querySelector('.dialogue-window.is-open') || null;
  }
  function domOptionTexts() {
    const root = dialogueRoot();
    const box = root && root.querySelector('.answers');
    if (!box) return [];
    return [...box.children]
      .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  let answeredSig = '', dlgTimer = null, decTimer = null;

  function dialogueTick() {
    if (!ready()) return;
    if (!isDialogueOpen()) { answeredSig = ''; return; }

    const texts = domOptionTexts();
    if (!texts.length) return;
    const sig = texts.join('|');
    if (sig === answeredSig) return;

    const fresh = lastDialogue && Date.now() - lastDialogue.at < CFG.frameFreshMs;
    const ok = fresh ? answerDialogue('szybka') : answerFromDom();
    if (ok) answeredSig = sig;
  }

  function answerFromDom() {
    if (!running) return false;
    const d = E() && E().dialogue;
    const $ = safe(() => d && d.$);
    const root = ($ && $[0]) || document.querySelector('.dialogue-window.is-open');
    if (!root) return false;
    const box = root.querySelector('.answers');
    if (!box) return false;
    const lines = [...box.children];
    if (!lines.length) return false;

    const clsOf = el => (el.className || '') + ' ' + [...el.querySelectorAll('[class*="line_"]')].map(c => c.className).join(' ');
    let idx = lines.findIndex(el => /line_(cont|new)_quest/.test(clsOf(el)));
    if (idx < 0 && shopStageNames().length) {
      idx = lines.findIndex(el => /line_shop/.test(clsOf(el)));
      if (idx >= 0) shopOpenedByBot = true;
    }
    if (idx < 0) idx = lines.findIndex(el => CFG.skipRe.test(el.textContent || ''));
    if (idx < 0) {
      const nonExitIdxs = lines.map((el, i) => i).filter(i => !/line_exit/.test(clsOf(lines[i])));
      const lb = loopBreakPick(nonExitIdxs, lines.map(el => el.textContent || ''));
      if (lb) {
        idx = lb.pick;
        log('łamanie pętli (DOM): próba ' + lb.tries + ', opcja ' + lb.cycle + '/' + lb.total);
      } else if (nonExitIdxs.length) {
        idx = nonExitIdxs[0];
      }
    }
    if (idx < 0) idx = 0;

    if (d && typeof d.hotKeyLine === 'function' && safe(() => { d.hotKeyLine(idx + 1); return 1; })) {
      log('odpowiedź z DOM: hotKeyLine(' + (idx + 1) + ')');
    } else {
      lines[idx].click();
      log('odpowiedź z DOM: klik w linię ' + idx);
    }
    state = 'DIALOG';
    lastDialogueAt = Date.now();
    lastAnswerAt = Date.now();
    return true;
  }

  const canvasEl = () => safe(() => E().interface.get$GAME_CANVAS()[0]) || document.getElementById('GAME_CANVAS');
  function fire(el, type, cx, cy) {
    el.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, view: W, clientX: cx, clientY: cy,
      button: 0, buttons: (type === 'mouseup' || type === 'click') ? 0 : 1,
    }));
  }
  function clickCanvas(px, py) {
    const cv = canvasEl();
    if (!cv) return false;
    const r = cv.getBoundingClientRect();
    const sx = cv.width ? r.width / cv.width : 1, sy = cv.height ? r.height / cv.height : 1;
    const j = CFG.clickJitterPx;
    const cx = r.left + (px + rnd(-j, j)) * sx, cy = r.top + (py + rnd(-j, j)) * sy;
    if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return false;
    ['mousemove', 'mousedown', 'mouseup', 'click'].forEach(t => fire(cv, t, cx, cy));
    return true;
  }
  function clickArrow(t) {
    const a = t && t.arrow;
    if (!a) return false;
    const x = safe(() => a.posX), y = safe(() => a.posY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    lastClickAt = Date.now();
    return clickCanvas(x, y);
  }

  // === Ruch WSAD + A* ===================================================
  // Gra nie wspiera ruchu po skosie — tylko 4 kierunki (góra/dół/lewo/prawo),
  // a ruch trzymanym klawiszem jest ciągły. Zamiast E().hero.autoGoTo(...)
  // (wewnętrzny pathfinding silnika) liczymy własną trasę na siatce kolizji
  // i sterujemy postacią wciskając/trzymając/puszczając WSAD.

  function keyDownEvt(k) {
    const init = { key: k.key, code: k.code, keyCode: k.keyCode, which: k.keyCode, bubbles: true, cancelable: true, view: W };
    const targets = [document.activeElement, canvasEl(), document, W].filter(Boolean);
    for (const el of targets) el.dispatchEvent(new KeyboardEvent('keydown', init));
  }
  function keyUpEvt(k) {
    const init = { key: k.key, code: k.code, keyCode: k.keyCode, which: k.keyCode, bubbles: true, cancelable: true, view: W };
    const targets = [document.activeElement, canvasEl(), document, W].filter(Boolean);
    for (const el of targets) el.dispatchEvent(new KeyboardEvent('keyup', init));
  }
  function tapKey(k) { keyDownEvt(k); keyUpEvt(k); }
  function keyForDir(dx, dy) {
    if (dy < 0) return CFG.keyUp;
    if (dy > 0) return CFG.keyDown;
    if (dx < 0) return CFG.keyLeft;
    if (dx > 0) return CFG.keyRight;
    return null;
  }

  function gridInfo() {
    const md = safe(() => E().map.d);
    const col = safe(() => E().collision) || safe(() => E().map && E().map.col);
    const w = md && +md.x, h = md && +md.y;
    if (!col || !Number.isFinite(w) || !Number.isFinite(h)) return null;
    return { col, w, h };
  }
  function isWalkable(g, x, y) {
    if (!g || x < 0 || y < 0 || x >= g.w || y >= g.h) return false;
    const c = g.col[y * g.w + x] ?? g.col[x + ',' + y];
    return !(c === 1 || c === true || c === '1');
  }
  function tileWalkableKnown(x, y) {
    if (!isWalkable(gridInfo(), x, y)) return false;
    if (npcList().map(npcInfo).filter(Boolean).some(n => n.x === x && n.y === y)) return false;
    return true;
  }

  const ORTHO_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function aStar(start, goal, g) {
    if (!g) return null;
    if (start.x === goal.x && start.y === goal.y) return [{ x: start.x, y: start.y }];
    if (!isWalkable(g, goal.x, goal.y)) return null;
    const h = p => Math.abs(p.x - goal.x) + Math.abs(p.y - goal.y);
    const key = (x, y) => x + ',' + y;
    const open = new Map();
    const closed = new Set();
    open.set(key(start.x, start.y), { x: start.x, y: start.y, g: 0, f: h(start), parent: null });
    const MAX_NODES = 6000; // bezpiecznik dla dużych/nieosiągalnych map
    let iterations = 0;
    while (open.size) {
      if (++iterations > MAX_NODES) return null;
      let cur = null, curKey = null;
      for (const [k, n] of open) { if (!cur || n.f < cur.f) { cur = n; curKey = k; } }
      if (cur.x === goal.x && cur.y === goal.y) {
        const path = [];
        for (let n = cur; n; n = n.parent) path.unshift({ x: n.x, y: n.y });
        return path;
      }
      open.delete(curKey);
      closed.add(curKey);
      for (const [dx, dy] of ORTHO_DIRS) {
        const nx = cur.x + dx, ny = cur.y + dy, nk = key(nx, ny);
        if (closed.has(nk) || !isWalkable(g, nx, ny)) continue;
        const ng = cur.g + 1;
        const existing = open.get(nk);
        if (!existing || ng < existing.g) open.set(nk, { x: nx, y: ny, g: ng, f: ng + h({ x: nx, y: ny }), parent: cur });
      }
    }
    return null;
  }

  function pathToSegments(path) {
    if (!path || path.length < 2) return [];
    const segs = [];
    let curDx = null, curDy = null, segEnd = null;
    for (let i = 1; i < path.length; i++) {
      const dx = Math.sign(path[i].x - path[i - 1].x), dy = Math.sign(path[i].y - path[i - 1].y);
      if (dx !== curDx || dy !== curDy) {
        if (curDx !== null) segs.push({ dx: curDx, dy: curDy, end: segEnd });
        curDx = dx; curDy = dy;
      }
      segEnd = path[i];
    }
    segs.push({ dx: curDx, dy: curDy, end: segEnd });
    return segs;
  }

  let moveSegs = [], moveSegIdx = -1, moveHeldKey = null, movePlannedFor = '', moveLastPlanAt = 0;

  function releaseMoveKey() {
    if (moveHeldKey) { keyUpEvt(moveHeldKey); moveHeldKey = null; }
  }
  function resetMovePlan() {
    releaseMoveKey();
    moveSegs = []; moveSegIdx = -1; movePlannedFor = '';
  }

  function planPath(destTile) {
    const hero = E().hero.d;
    const path = aStar({ x: hero.x, y: hero.y }, destTile, gridInfo());
    releaseMoveKey();
    moveSegs = pathToSegments(path);
    moveSegIdx = -1;
    movePlannedFor = destTile.x + ',' + destTile.y;
    moveLastPlanAt = Date.now();
    if (!path) log('A*: brak trasy do', destTile.x + ',' + destTile.y);
    return !!path;
  }

  function driveMovement(destTile) {
    const now = Date.now();
    const wantKey = destTile.x + ',' + destTile.y;
    const stalePlan = wantKey !== movePlannedFor || (now - moveLastPlanAt > CFG.pathReplanMs && !moveHeldKey);
    if (stalePlan && !planPath(destTile)) return;
    const hero = E().hero.d;
    if (moveHeldKey) {
      const seg = moveSegs[moveSegIdx];
      if (seg && hero.x === seg.end.x && hero.y === seg.end.y) {
        releaseMoveKey();
        moveSegIdx++;
      } else {
        return; // wciąż w trakcie segmentu — trzymamy klawisz
      }
    } else if (moveSegIdx < 0) {
      moveSegIdx = 0;
    }
    if (moveSegIdx >= moveSegs.length) return; // dojechaliśmy do celu trasy
    const seg = moveSegs[moveSegIdx];
    const k = keyForDir(seg.dx, seg.dy);
    if (!k) { moveSegIdx++; return; }
    keyDownEvt(k);
    moveHeldKey = k;
    lastClickAt = now;
  }
  // ========================================================================

  let nudgeDir = 0;
  function nudgeStep(t) {
    const h = E().hero.d;
    const md = safe(() => E().map.d) || {};
    const known = [];
    const blind = [];
    for (const [dx, dy] of ORTHO_DIRS) {
      const nx = h.x + dx, ny = h.y + dy;
      if (md.x && (nx < 0 || ny < 0 || nx >= md.x || ny >= md.y)) continue;
      (tileWalkableKnown(nx, ny) ? known : blind).push({ x: nx, y: ny, dx, dy });
    }
    const pool = known.length ? known : blind;
    if (!pool.length) {
      log('krok w bok: brak sąsiednich pól w granicach mapy — próba interakcji');
      if (!clickArrow(t)) pressQ();
      return false;
    }
    const dest = pool[nudgeDir % pool.length];
    nudgeDir++;
    log('krok w bok na', dest.x + ',' + dest.y, known.length ? '(pewne)' : '(na ślepo)');
    const k = keyForDir(dest.dx, dest.dy);
    if (k) tapKey(k);
    return true;
  }

  const norm2 = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const nameMatches = (a, b) => {
    const x = norm2(a), y = norm2(b);
    return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
  };

  function bagItems() {
    const e = E(); if (!e || !e.items) return [];
    for (const g of [
      () => e.items.fetchLocationItems && e.items.fetchLocationItems('g'),
      () => e.hero && e.hero.getItems && e.hero.getItems(),
      () => e.bag && e.bag.items,
    ]) {
      const v = safe(g);
      if (!v) continue;
      const arr = Array.isArray(v) ? v : Object.values(v);
      if (arr.length && typeof arr[0] === 'object') return arr;
    }
    return [];
  }

  function itemInfo(o) {
    if (!o || typeof o !== 'object') return null;
    const id = safe(() => o.getId && o.getId()) ?? o.id;
    const name = safe(() => o.getName && o.getName());
    if (id == null || !name) return null;
    return {
      id: String(id),
      name,
      loc: safe(() => o.getLoc && o.getLoc()),
      st: safe(() => o.getSt && o.getSt()),
      tpl: safe(() => o.getTpl && o.getTpl()),
      raw: o,
    };
  }

  function findItemByName(want) {
    const w = norm2(want);
    if (!w) return null;
    const items = bagItems().map(itemInfo).filter(Boolean);
    const inBag = i => i.loc == null || String(i.loc) === 'g';
    const exact = items.filter(i => norm2(i.name) === w);
    const partial = items.filter(i => norm2(i.name).includes(w) || w.includes(norm2(i.name)));
    return exact.find(inBag) || exact[0] || partial.find(inBag) || partial[0] || null;
  }

  function questPanelTexts() {
    const texts = [];
    document.querySelectorAll('.questField, .quest-content, [class*="quest"]').forEach(el => {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t) return;
      if (/^\d{1,2}:\d{2}\b/.test(t)) return;
      if (/\[[A-ZĄĆĘŁŃÓŚŹŻ]\]/.test(t)) return;
      texts.push(t);
    });
    return texts;
  }

  function itemNamesFromQuest() {
    const texts = questPanelTexts();

    const clean = s => s
      .replace(/:.*$/, '')
      .replace(/\s+(i|oraz|a następnie|potem|,|;|Filtruj|poziom|Obserwowane|Profesja)\b.*$/i, '')
      .replace(/[.!?].*$/, '')
      .trim();

    const bagExact = name => {
      const w = norm2(name);
      return bagItems().map(itemInfo).filter(Boolean).some(i => norm2(i.name) === w);
    };

    const found = [];
    const seen = new Set();
    const addCandidate = raw => {
      const cleaned = clean(raw);
      const rawTrim = raw.trim();
      let name = null;
      if (cleaned && bagExact(cleaned)) name = cleaned;
      else if (bagExact(rawTrim)) name = rawTrim;
      else if (cleaned && cleaned.length <= 40 && findItemByName(cleaned)) name = cleaned;
      if (!name) return;
      const key = norm2(name);
      if (seen.has(key)) return;
      seen.add(key);
      found.push(name);
    };

    const verbRe = /(?:użyj przedmiotu|użyj|załóż przedmiot|załóż|ubierz|wypij|zjedz|spożyj|wypal|aktywuj|zastosuj)\s*:\s*([^\n.!?:]{1,60})/gi;
    for (const t of texts) {
      verbRe.lastIndex = 0;
      let m;
      while ((m = verbRe.exec(t)) !== null) addCandidate(m[1]);
    }

    if (!found.length && CFG.itemFallbackEnabled) {
      for (const t of texts) {
        const re = /:\s*([^:.\n!?]{2,40})/g;
        let m;
        while ((m = re.exec(t)) !== null) addCandidate(m[1]);
      }
    }
    return found;
  }
  const itemNameFromQuest = () => itemNamesFromQuest()[0] || null;

  function isAreaSearchQuest() {
    for (const t of questPanelTexts()) {
      if (/przeszukaj|zbadaj|przeczesz/i.test(t)) return true;
    }
    return false;
  }

  function killQuestNames() {
    const out = new Set();
    const re = /zabij\s*:\s*([^\n.!?]{1,200})/gi;
    for (const t of questPanelTexts()) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(t)) !== null) {
        const seg = m[1].replace(/\(\s*\d+\s*\/\s*\d+\s*\)\s*$/, '').trim();
        seg.split(',').map(s => s.trim()).filter(Boolean).forEach(n => out.add(n));
      }
    }
    return [...out];
  }

  function shopStageNames() {
    const texts = questPanelTexts();
    const clean = s => s
      .replace(/:.*$/, '')
      .replace(/\s+(i|oraz|a następnie|potem|,|;|Filtruj|poziom|Obserwowane|Profesja)\b.*$/i, '')
      .replace(/[.!?].*$/, '')
      .trim();
    const verbRe = /(?:kup przedmiot|kup|zakup)\s*:\s*([^\n.!?:]{1,60})/gi;
    const found = [];
    const seen = new Set();
    for (const t of texts) {
      verbRe.lastIndex = 0;
      let m;
      while ((m = verbRe.exec(t)) !== null) {
        const name = clean(m[1]);
        if (!name) continue;
        const key = norm2(name);
        if (seen.has(key)) continue;
        seen.add(key);
        found.push(name);
      }
    }
    return found;
  }

  function shopItems() {
    const raw = safe(() => E().shop && E().shop.getItems());
    if (!raw || typeof raw !== 'object') return [];
    return Object.entries(raw).map(([slot, it]) => ({ slot, raw: it }));
  }
  function shopItemInfo(entry) {
    const it = entry.raw;
    if (!it) return null;
    const id = safe(() => it.getId && it.getId()) ?? it.id;
    const name = safe(() => it.getName && it.getName()) ?? it.name ?? it.nazwa;
    if (id == null || !name) return null;
    return { slot: entry.slot, id: String(id), name };
  }
  function findShopItemByName(want) {
    const w = norm2(want);
    if (!w) return null;
    const items = shopItems().map(shopItemInfo).filter(Boolean);
    return items.find(i => norm2(i.name) === w)
        || items.find(i => norm2(i.name).includes(w) || w.includes(norm2(i.name)))
        || null;
  }

  let shopRotateIdx = 0;
  function buyQuestItems() {
    const names = shopStageNames();
    if (!names.length) return false;
    for (let i = 0; i < names.length; i++) {
      const idx = (shopRotateIdx + i) % names.length;
      const name = names[idx];
      const it = findShopItemByName(name);
      if (!it) { log('przedmiotu "' + name + '" nie ma (jeszcze) w katalogu sklepu'); continue; }
      if (!gSend('shop&buy=' + it.slot + ',1&sell=')) continue;
      log('kupno:', it.name, '(slot ' + it.slot + ', id ' + it.id + ')',
          '(' + (i + 1) + '/' + names.length + ' w etapie)');
      shopRotateIdx = (idx + 1) % names.length;
      return true;
    }
    return false;
  }
  function isShopOpen() { return shopItems().length > 0; }

  let itemRotateIdx = 0;
  function useQuestItem() {
    const names = itemNamesFromQuest();
    if (!names.length) { log('nie znalazłem nazwy przedmiotu w etapie questa'); return false; }

    for (let i = 0; i < names.length; i++) {
      const idx = (itemRotateIdx + i) % names.length;
      const name = names[idx];
      const it = findItemByName(name);
      if (!it) { log('przedmiotu "' + name + '" nie ma w plecaku'); continue; }
      if (!gSend('moveitem&st=1&id=' + it.id)) continue;
      log('użycie/założenie przedmiotu:', it.name, '(id ' + it.id + ')',
          '(' + (i + 1) + '/' + names.length + ' w etapie)');
      itemRotateIdx = (idx + 1) % names.length;
      return true;
    }
    return false;
  }

  function questSignature() {
    const list = (safe(() => E().questsObserve && E().questsObserve.list)) || {};
    return Object.keys(list).filter(k => list[k]).sort().join(',');
  }
  let lastQuestSig = null;
  let shopOpenedByBot = false;

  function onQuestChange() {
    log('zmiana aktywnego zadania — czyszczę cele i stan interakcji');
    resetMovePlan();
    doneTargets.clear();
    knownNames.clear();
    talkCount.clear();
    tplCache = { at: 0, val: [] };
    huntName = '';
    lastKey = '';
    lastPtrLogged = '';
    lastFrameKey = '';
    answeredSig = '';
    lastDialogue = null;
    state = 'NAV';
    talkTries = 0;
    moved = false;
    shopOpenedByBot = false;
    dialogueLoopTracker.clear();
  }

  const DECISION_SEL = '.c-window.askAlert, .c-window.mAlert, [class*="askAlert"]';
  const EXP_RE = /z punktami do\u015bwiadczenia|bez punkt\u00f3w do\u015bwiadczenia|punkty do\u015bwiadczenia/i;

  function findDecisionBox() {
    const boxes = [...document.querySelectorAll(DECISION_SEL)].filter(el => el.offsetParent !== null);
    return boxes[0] || null;
  }
  function decisionButtons(box) {
    const btns = [...box.querySelectorAll('.window-controlls .button, .window-controlls [class*="button"]')]
      .filter(el => el.offsetParent !== null);
    return btns.map(el => ({
      el,
      text: ((el.querySelector('.label') || el).textContent || '').trim(),
    })).filter(b => b.text.length > 0);
  }

  function decisionTick() {
    if (!running) return;
    const box = findDecisionBox();
    if (!box) return;
    const btns = decisionButtons(box);
    if (btns.length < 2) return;

    const texts = btns.map(b => b.text);
    const isExpChoice = texts.some(t => EXP_RE.test(t));

    let idx;
    if (isExpChoice) {
      idx = texts.findIndex(t => CFG.collectExp
        ? /z punktami/i.test(t)
        : /bez punkt/i.test(t));
      if (idx < 0) idx = 0;
    } else {
      idx = 0;
    }

    log('okienko decyzyjne:', texts.join(' | '), '-> wybieram [' + idx + ']', texts[idx],
        isExpChoice ? '(exp: ' + (CFG.collectExp ? 'TAK' : 'NIE') + ')' : '');
    btns[idx].el.click();
  }

  function decisionDebug() {
    const all = [...document.querySelectorAll(DECISION_SEL)].filter(el => el.offsetParent !== null);
    return all.map(el => ({ el, klasy: el.className, przyciski: decisionButtons(el).map(b => b.text) }));
  }

  function navigateTo(t) {
    const dest = (t && t.npc && Number.isFinite(t.npc.x) && { x: t.npc.x, y: t.npc.y }) || (t && t.tile);
    if (!dest) return false;
    driveMovement(dest);
    return true;
  }

  function pressKey(key, code, keyCode) {
    const init = { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true, view: W };
    const targets = [document.activeElement, canvasEl(), document, W].filter(Boolean);
    for (const el of targets) {
      el.dispatchEvent(new KeyboardEvent('keydown', init));
      el.dispatchEvent(new KeyboardEvent('keypress', init));
      el.dispatchEvent(new KeyboardEvent('keyup', init));
    }
    return true;
  }
  const keyName = b => (b && b.key && b.key.length === 1) ? b.key.toUpperCase() : ((b && (b.key || b.code)) || '?');
  const pressQ = () => { const k = CFG.keyTalk; pressKey(k.key, k.code, k.keyCode); log('wciśnięto ' + keyName(k) + ' (rozmowa/interakcja)'); return true; };
  const pressE = () => { const k = CFG.keyAttack; pressKey(k.key, k.code, k.keyCode); log('wciśnięto ' + keyName(k) + ' (atak)'); return true; };
  const pressEsc = () => { pressKey('Escape', 'Escape', 27); log('wciśnięto Esc'); return true; };

  const talkCount = new Map();

  function talkToTarget() {
    const t = currentTarget();
    lastTalkAt = Date.now();
    talkTries++;

    if (!t) { log('brak celu — nie zagaduję'); return false; }

    const dist = distanceToTarget(t);
    const maxDist = t.npc ? CFG.talkRadius : 1;
    if (dist > maxDist) { log('cel za daleko (' + dist + ')'); return false; }

    if (!t.npc) {
      if (clickArrow(t)) { log('interakcja z obiektem:', (t.tile && t.tile.name) || t.key, '| dystans', dist); return true; }
      pressQ();
      return true;
    }

    const d0 = (t.npc.obj && t.npc.obj.d && typeof t.npc.obj.d === 'object') ? t.npc.obj.d : {};
    const looksMob = (Number.isFinite(+d0.lvl) && +d0.lvl > 0) || [2, 3].includes(+d0.type);

    const rec = talkCount.get(t.key) || { n: 0, mode: looksMob ? 'attack' : 'talk', switched: false };
    rec.n++;

    if (rec.n > CFG.sameTargetMaxTalks && !rec.switched) {
      rec.mode = rec.mode === 'attack' ? 'talk' : 'attack';
      rec.switched = true;
      rec.n = 1;
      log('cel', t.npc.name || t.npc.id, '— metoda "' + (rec.mode === 'attack' ? 'talk' : 'attack') +
          '" bez efektu, przełączam na "' + rec.mode + '"');
    }
    else if (rec.n > CFG.sameTargetMaxTalks && rec.switched) {
      log('cel', t.npc.name || t.npc.id, '— obie metody bez efektu, skreślam');
      markDone(t, 'atak i rozmowa bez efektu');
      talkCount.delete(t.key);
      state = 'NAV'; talkTries = 0; lastKey = '';
      return false;
    }
    talkCount.set(t.key, rec);

    if (rec.mode === 'attack') {
      huntName = t.npc.name || huntName;
      log('ATAK (E):', t.npc.name || t.npc.id, '| lvl', d0.lvl, '| próba', rec.n);
      return pressE();
    }

    if (!gSend('talk&id=' + t.npc.id)) return false;
    log('zagadanie:', t.npc.name || t.npc.id, '| dystans', dist, '| próba', rec.n);
    return true;
  }

  let timer = null, state = 'OFF';
  let lastClickAt = 0, lastMoveAt = 0, lastDialogueAt = 0, lastTalkAt = 0;
  let nextNavGap = CFG.clickIntervalMs, lastNudgeAt = 0, lastItemTry = 0, lastShopTry = 0, nudgeGiveUpCount = 0;
  let lastPos = '', moved = false, talkTries = 0, lastKey = '', stuckRetries = 0;

  function tick() {
    if (!ready()) return;
    const now = Date.now();

    const qsig = questSignature();
    if (lastQuestSig === null) lastQuestSig = qsig;
    else if (qsig !== lastQuestSig) { lastQuestSig = qsig; onQuestChange(); }

    if (huntName) {
      const kq = killQuestNames();
      if (!kq.length || !kq.some(k => nameMatches(k, huntName))) {
        log('huntName nieaktualne (' + huntName + ') — etap zabijania zakończony, czyszczę');
        huntName = '';
      }
    }

    if (isDialogueOpen()) {
      if (now - Math.max(lastAnswerAt, lastFrameAt) > CFG.stuckAnswerMs) {
        if (!answerDialogue('watchdog')) answerFromDom();
      }
      return;
    }

    if (state === 'DIALOG') {
      if (now - lastDialogueAt > CFG.afterDialogueCooldownMs) {
        markDone(lastKey, 'rozmowa zakończona');
        if (lastKey) talkCount.delete(lastKey);
        huntName = '';
        state = 'NAV'; moved = false; talkTries = 0; lastKey = ''; log('-> NAV');
      }
      return;
    }

    if (inRest()) {
      lastMoveAt = lastTalkAt = lastClickAt = now;
      return;
    }

    if (now - lastItemTry > CFG.itemRetryMs) {
      const names = itemNamesFromQuest();
      if (names.length) {
        lastItemTry = now;
        if (useQuestItem()) { lastTalkAt = now; return; }
      }
    }

    if (isShopOpen() && now - lastShopTry > CFG.itemRetryMs) {
      lastShopTry = now;
      if (buyQuestItems()) { lastTalkAt = now; return; }
    }

    if (shopOpenedByBot && isShopOpen() && !shopStageNames().length) {
      log('sklep: zakupy questowe zakończone — zamykam (Esc)');
      pressEsc();
      shopOpenedByBot = false;
      lastTalkAt = now;
      return;
    }
    if (!isShopOpen()) shopOpenedByBot = false;

    if (!currentTarget() && isAreaSearchQuest() && now - lastMoveAt > CFG.arrivalStableMs) {
      if (now - lastNudgeAt > CFG.nudgeCooldownMs) {
        lastNudgeAt = now;
        log('quest obszarowy, brak celu, bezruch — krok w bok');
        nudgeStep({ tile: { x: E().hero.d.x, y: E().hero.d.y } });
      }
      return;
    }

    const h = E().hero.d;
    const mapName = safe(() => E().map.d.name) || '';
    const pos = mapName + '|' + h.x + ':' + h.y;
    if (pos !== lastPos) { lastPos = pos; lastMoveAt = now; moved = true; stuckRetries = 0; }

    hookArrows();
    noteArrowNames();
    if (mapName !== lastMapForNames) {
      lastMapForNames = mapName;
      knownNames.clear();
      lastPtrLogged = '';
    }

    const t = currentTarget();

    const key = t ? t.key : '';
    if (key !== lastKey) {
      if (lastKey) log('nowy cel:', key || '(brak)');
      lastKey = key;
      state = 'NAV'; moved = false; talkTries = 0; stuckRetries = 0;
    }

    const lastActivity = Math.max(lastMoveAt, lastClickAt, lastTalkAt, lastDialogueAt);
    // W stanie NAV nie czekamy pełnych idleFallbackMs — skanujemy cyklicznie co navScanMs,
    // żeby bot nie "zamierał" w oczekiwaniu na wykrycie bezczynności. W pozostałych stanach
    // (ARRIVED, itp.) zostaje dłuższy, bezpieczniejszy próg idleFallbackMs.
    const scanThreshold = state === 'NAV' ? CFG.navScanMs : CFG.idleFallbackMs;
    if (now - lastActivity > scanThreshold) {
      lastTalkAt = now;
      tplCache = { at: 0, val: [] };
      knownNames.clear();
      lastPtrLogged = '';
      const npc = (t && t.npc) || npcInfo(safe(() => E().questTracking.getNearTrackingNpc()));
      if (npc && gSend('talk&id=' + npc.id)) {
        log('skan (' + (scanThreshold / 1000) + 's) — wymuszam rozmowę z', npc.name || npc.id);
      } else if (!npc) {
        log('skan (' + (scanThreshold / 1000) + 's) — brak NPC-celu, odświeżam i symuluję Q');
        pressQ();
      }
      return;
    }

    if (!t) return;

    if (t.npc) {
      const alive = npcList().map(npcInfo).filter(Boolean).some(n => n.id === t.npc.id);
      if (!alive) {
        markDone(t, 'cel zniknął z mapy');
        talkCount.delete(t.key);
        state = 'NAV'; talkTries = 0; lastKey = ''; moved = false;
        return;
      }
    }

    if (state === 'NAV') {
      const dist = distanceToTarget(t);
      const settled = now - lastMoveAt > CFG.arrivalStableMs;

      if (!t.npc && dist === 0) {
        const kqNames = killQuestNames();
        const isGhostKill = (huntName && nameMatches(t.tile && t.tile.name, huntName)) ||
                             kqNames.some(k => nameMatches(k, t.tile && t.tile.name));
        if (isGhostKill) {
          nudgeGiveUpCount++;
          if (nudgeGiveUpCount >= CFG.nudgeGhostGiveUpTries) {
            log('duch questa zabijania — brak żywego moba w pobliżu po ' + nudgeGiveUpCount + ' próbach, skreślam');
            markDone(t, 'duch questa zabijania — nikogo tu nie ma');
            nudgeGiveUpCount = 0;
            state = 'NAV'; lastKey = ''; talkTries = 0;
            return;
          }
        } else {
          nudgeGiveUpCount = 0;
        }
        if (now - lastNudgeAt > CFG.nudgeCooldownMs) {
          lastNudgeAt = now;
          nudgeStep(t);
        }
        return;
      }
      nudgeGiveUpCount = 0;

      const stopDist = t.npc ? CFG.talkRadius : 0;
      const arriveDist = t.npc ? CFG.talkRadius : 1;

      if (settled && dist <= arriveDist) {
        releaseMoveKey();
        state = 'ARRIVED'; talkTries = 0;
        log('-> ARRIVED, dystans', dist, t.npc ? '' : '(cel-kafelek)');
        setTimeout(talkToTarget, jit(CFG.talkDelayMs) + hesitation());
        return;
      }

      const inRange = dist <= stopDist;

      if (now - lastMoveAt > CFG.navStuckMs) {
        lastMoveAt = now;
        stuckRetries++;
        log('bezruch ' + (CFG.navStuckMs / 1000) + 's' + (inRange ? ' (w zasięgu, bez ARRIVED)' : '') +
            ' — odświeżam cel i trasę (' + stuckRetries + ')');
        tplCache = { at: 0, val: [] };
        knownNames.clear();
        lastPtrLogged = '';
        lastKey = '';
        lastClickAt = 0;
        resetMovePlan();
        if (stuckRetries >= CFG.stuckGiveUpTries) {
          markDone(t, 'nieosiągalny po ' + stuckRetries + ' odświeżeniach');
          state = 'NAV'; talkTries = 0; stuckRetries = 0;
        }
        return;
      }

      if (!inRange) navigateTo(t); else releaseMoveKey();
      return;
    }

    if (state === 'ARRIVED') {
      if (!t.npc) {
        talkTries++;
        if (talkTries === 1 && clickArrow(t)) { log('interakcja: klik w strzałkę na obiekcie', t.tile); return; }
        if (talkTries === 2) { log('cel bez NPC — próba Q'); pressQ(); return; }
        if (talkTries >= 4) {
          markDone(t, 'cel bez NPC — nic tu do zrobienia');
          state = 'NAV'; talkTries = 0; lastKey = ''; moved = false;
        }
        return;
      }
      if (now - lastTalkAt < CFG.talkRetryMs) return;
      if (talkTries >= CFG.talkMaxTries) {
        markDone(t, 'bez efektu po ' + CFG.talkMaxTries + ' próbach');
        state = 'NAV'; moved = false; talkTries = 0;
        return;
      }
      talkToTarget();
    }
  }

  function loopTick() {
    if (!running) return;
    safe(tick);
    timer = setTimeout(loopTick, jit(CFG.tickMs));
  }
  function loopDialogue() {
    if (!running) return;
    safe(dialogueTick);
    dlgTimer = setTimeout(loopDialogue, jit(CFG.dialoguePollMs));
  }
  function loopDecision() {
    if (!running) return;
    safe(decisionTick);
    decTimer = setTimeout(loopDecision, CFG.decisionPollMs);
  }

  const start = () => {
    if (running) return;
    running = true;
    state = 'NAV'; moved = false; lastPos = ''; talkTries = 0; lastKey = ''; answeredSig = ''; stuckRetries = 0;
    nextNavGap = jit(CFG.clickIntervalMs);
    restUntil = 0; scheduleNextRest();
    lastClickAt = lastMoveAt = lastTalkAt = lastDialogueAt = Date.now();
    loopTick();
    loopDialogue();
    loopDecision();
    log('start');
    safe(updateBadge);
  };
  const stop = () => {
    running = false;
    clearTimeout(timer); timer = null;
    clearTimeout(dlgTimer); dlgTimer = null;
    clearTimeout(decTimer); decTimer = null;
    resetMovePlan();
    state = 'OFF'; log('stop');
    safe(updateBadge);
  };

  const LS_KEY = 'mq_bot_enabled';
  const LS_KEY_EXP = 'mq_collect_exp';
  const LS_KEY_TALK = 'mq_key_talk';
  const LS_KEY_ATTACK = 'mq_key_attack';
  const LS_KEY_UP = 'mq_key_up';
  const LS_KEY_DOWN = 'mq_key_down';
  const LS_KEY_LEFT = 'mq_key_left';
  const LS_KEY_RIGHT = 'mq_key_right';
  const readEnabled = () => { try { return localStorage.getItem(LS_KEY) === '1'; } catch (e) { return false; } };
  const saveEnabled = v => { try { localStorage.setItem(LS_KEY, v ? '1' : '0'); } catch (e) {} };
  const readExpPref = () => { try { const v = localStorage.getItem(LS_KEY_EXP); return v === null ? true : v === '1'; } catch (e) { return true; } };
  const saveExpPref = v => { try { localStorage.setItem(LS_KEY_EXP, v ? '1' : '0'); } catch (e) {} };
  const readKeybind = (lsKey, def) => {
    try { const v = localStorage.getItem(lsKey); if (!v) return def; const p = JSON.parse(v); return (p && p.key && p.code) ? p : def; }
    catch (e) { return def; }
  };
  const saveKeybind = (lsKey, bind) => { try { localStorage.setItem(lsKey, JSON.stringify(bind)); } catch (e) {} };
  CFG.collectExp = readExpPref();
  CFG.keyTalk = readKeybind(LS_KEY_TALK, CFG.keyTalk);
  CFG.keyAttack = readKeybind(LS_KEY_ATTACK, CFG.keyAttack);
  CFG.keyUp = readKeybind(LS_KEY_UP, CFG.keyUp);
  CFG.keyDown = readKeybind(LS_KEY_DOWN, CFG.keyDown);
  CFG.keyLeft = readKeybind(LS_KEY_LEFT, CFG.keyLeft);
  CFG.keyRight = readKeybind(LS_KEY_RIGHT, CFG.keyRight);

  let panel = null;
  function togglePanel() {
    if (panel) { panel.remove(); panel = null; return; }
    const host = document.body || document.documentElement;
    if (!host) return;
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;top:26px;right:4px;z-index:2147483647;' +
      'font:11px monospace;padding:8px 10px;border-radius:4px;background:rgba(20,20,25,.95);' +
      'color:#eee;box-shadow:0 2px 8px rgba(0,0,0,.5);min-width:190px;user-select:none;';
    panel.addEventListener('mousedown', e => e.stopPropagation());
    panel.addEventListener('click', e => e.stopPropagation());

    const title = document.createElement('div');
    title.textContent = 'AutoQ — ustawienia';
    title.style.cssText = 'font-weight:bold;margin-bottom:6px;color:#9cf;';
    panel.appendChild(title);

    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = CFG.collectExp;
    cb.addEventListener('change', () => {
      CFG.collectExp = cb.checked;
      saveExpPref(cb.checked);
      log('preferencja exp:', cb.checked ? 'zbieraj (Z punktami doświadczenia)' : 'nie zbieraj (Bez punktów doświadczenia)');
    });
    row.appendChild(cb);
    row.appendChild(document.createTextNode('Zbieraj expa z questów'));
    panel.appendChild(row);

    const sep = document.createElement('div');
    sep.style.cssText = 'margin-top:8px;border-top:1px solid #444;padding-top:6px;';
    panel.appendChild(sep);

    const keyLabel = keyName;

    function makeKeybindRow(label, cfgProp, lsKey) {
      const r = document.createElement('div');
      r.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:6px;';
      const lab = document.createElement('span');
      lab.textContent = label;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = keyLabel(CFG[cfgProp]);
      btn.style.cssText = 'background:#333;color:#fff;border:1px solid #555;border-radius:3px;' +
        'padding:2px 10px;cursor:pointer;min-width:56px;font:11px monospace;';
      btn.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        btn.textContent = '…';
        btn.disabled = true;
        const capture = ev => {
          ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
          document.removeEventListener('keydown', capture, true);
          btn.disabled = false;
          if (ev.key === 'Escape') { btn.textContent = keyLabel(CFG[cfgProp]); return; }
          const bind = { key: ev.key, code: ev.code, keyCode: ev.keyCode || ev.which || 0 };
          CFG[cfgProp] = bind;
          saveKeybind(lsKey, bind);
          btn.textContent = keyLabel(bind);
          log('nowy klawisz (' + label + '):', keyLabel(bind));
        };
        document.addEventListener('keydown', capture, true);
      });
      r.appendChild(lab);
      r.appendChild(btn);
      panel.appendChild(r);
    }
    makeKeybindRow('Rozmowa / interakcja', 'keyTalk', LS_KEY_TALK);
    makeKeybindRow('Atak', 'keyAttack', LS_KEY_ATTACK);
    makeKeybindRow('Ruch: góra', 'keyUp', LS_KEY_UP);
    makeKeybindRow('Ruch: dół', 'keyDown', LS_KEY_DOWN);
    makeKeybindRow('Ruch: lewo', 'keyLeft', LS_KEY_LEFT);
    makeKeybindRow('Ruch: prawo', 'keyRight', LS_KEY_RIGHT);

    const hint = document.createElement('div');
    hint.textContent = 'Dotyczy okienek wyboru nagrody. Inne pytania: zawsze lewa opcja. ' +
      'Zmiana klawisza: kliknij przycisk i wciśnij nowy klawisz (Esc anuluje).';
    hint.style.cssText = 'margin-top:8px;color:#888;font-size:10px;line-height:1.3;';
    panel.appendChild(hint);

    host.appendChild(panel);
  }

  let badge = null;
  function updateBadge() {
    if (!badge) {
      const host = document.body || document.documentElement;
      if (!host) return;
      badge = document.createElement('div');
      badge.title = 'AutoQ — klik: włącz/wyłącz | Ctrl+Shift+Q: to samo | PPM: ustawienia';
      badge.style.cssText = 'position:fixed;top:4px;right:4px;z-index:2147483647;' +
        'font:bold 11px monospace;padding:3px 7px;border-radius:3px;cursor:pointer;user-select:none;' +
        'color:#fff;text-shadow:0 1px 2px #000;opacity:.85';
      badge.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); toggle(); });
      badge.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
      badge.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); togglePanel(); });
      host.appendChild(badge);
    }
    const on = running;
    if (on && Date.now() < restUntil) {
      badge.textContent = 'AutoQ 💤';
      badge.style.background = 'rgba(90,90,140,.92)';
    } else {
      badge.textContent = on ? 'AutoQ ON' : 'AutoQ OFF';
      badge.style.background = on ? 'rgba(30,140,60,.92)' : 'rgba(120,35,35,.92)';
    }
  }

  function toggle() {
    if (running) { stop(); saveEnabled(false); }
    else { start(); saveEnabled(true); }
    updateBadge();
    log('Ctrl+Shift+Q ->', running ? 'WŁĄCZONY' : 'WYŁĄCZONY');
  }

  document.addEventListener('keydown', e => {
    if (!e.ctrlKey || !e.shiftKey || e.altKey) return;
    if (e.code !== 'KeyQ' && String(e.key).toLowerCase() !== 'q') return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    toggle();
  }, true);

  W.__mq = {
    start, stop, toggle, talkToTarget, clickArrow, navigateTo, pressQ, pressE, answerDialogue, answerFromDom, currentTarget, distanceToTarget,
    getTrackingArrow, pickOption, hasBit, allClasses, dialogueTick, domOptionTexts,
    isTrackedNpc, trackedTpls, npcList, npcInfo, gSend,
    pointerPositions, noteArrowNames, bagItems, itemInfo, findItemByName, itemNameFromQuest, itemNamesFromQuest, useQuestItem, isAreaSearchQuest, killQuestNames, keyName,
    loopBreakPick, dialogueLoopStatus: () => [...dialogueLoopTracker.entries()],
    shopStageNames, shopItems, shopItemInfo, findShopItemByName, buyQuestItems, isShopOpen, pressEsc,
    decisionTick, decisionDebug, findDecisionBox, togglePanel,
    restNow: (sec) => { restUntil = Date.now() + (sec || 60) * 1000; safe(updateBadge); log('wymuszona przerwa', (sec || 60) + 's'); },
    restStatus: () => ({ odpoczywa: Date.now() < restUntil, doKoncaS: Math.max(0, Math.round((restUntil - Date.now()) / 1000)), nastepnaZaS: Math.max(0, Math.round((nextRestAt - Date.now()) / 1000)) }),
    names: () => [...knownNames.keys()],
    sendStats: () => ({ ostatnie10s: sendTimes.length, limit: CFG.maxSendPer10s, odstepMs: CFG.minSendGapMs }),
    cfg: CFG, BITS, CLASS_BY_BIT,
    resetTalks: () => { talkCount.clear(); doneTargets.clear(); log('liczniki i załatwione cele wyczyszczone'); },
    targets: () => allTargets().map(t => ({ key: t.key, npc: t.npc && t.npc.name, tile: t.tile, dystans: distanceToTarget(t), done: doneTargets.has(t.key) })),
    lastDialogue: () => lastDialogue,
    state: () => {
      const t = currentTarget();
      return { state, lastPos, talkTries, lastKey, huntName, stuckRetries, zalatwione: [...doneTargets.keys()],
               cel: t && { key: t.key, npc: t.npc && t.npc.name, tile: t.tile, dystans: distanceToTarget(t) } };
    },
  };

  const wait = setInterval(() => {
    if (!ready()) return;
    clearInterval(wait);
    updateBadge();
    if (readEnabled()) {
      start();
      updateBadge();
      log('stan z poprzedniej sesji: WŁĄCZONY — wznawiam automatycznie');
    }
    log('AutoQ v10.2 gotowe → klik: włącz/wyłącz | PPM na wskaźnik: ustawienia (exp, klawisze) | Ctrl+Shift+Q: to samo co klik');
  }, 500);
})();
