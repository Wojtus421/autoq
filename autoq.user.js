// ==UserScript==
// @name         AutoQ — Margonem auto quest v9.4
// @namespace    Wojtus
// @version      9.4
// @description  Konfigurowalne klawisze rozmowy/ataku (domyślnie Q/E) w panelu ustawień — zapisywane między sesjami
// @match        https://*.margonem.pl/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

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

    // ── celowanie ──
    talkRadius: 1,            // rozmowa i stop klikania dopiero tuż przy celu (0 = to samo pole, nieosiągalne przez kolizję)
    sameTargetMaxTalks: 3,
    sameTargetPauseMs: 30000,
    doneTtlMs: 60000,         // po tylu ms cel wraca do puli (gdyby quest jednak go wymagał)
    arrowRetryMs: 12000,      // strzałka wciąż wisi mimo skreślenia celu -> ponów po tylu ms
    maxTargetDistance: 100,   // cel dalej niż tyle kafelków = błąd parsowania, ignorujemy
    navStuckMs: 3000,         // stoimy tyle w miejscu podczas marszu -> odśwież cel i trasę
    stuckGiveUpTries: 4,      // po tylu odświeżeniach bez ruchu uznaj cel za nieosiągalny (~12 s)
    nudgeCooldownMs: 1500,    // odstęp między krokami "w bok" gdy postać stoi na celu-kafelku
    nudgeGhostGiveUpTries: 3, // ile razy nudge'ować "ducha" questa zabijania zanim skreślimy cel
    itemRetryMs: 4000,        // jak często próbować użyć/założyć przedmiot z etapu questa
    decisionPollMs: 300,      // jak często sprawdzać okienko "Wiadomość" z wyborem
    collectExp: true,         // domyślnie: wybieraj "Z punktami doświadczenia" (nadpisywane z panelu/localStorage)
    keyTalk: { key: 'q', code: 'KeyQ', keyCode: 81 },     // klawisz interakcji/rozmowy — nadpisywany z panelu
    keyAttack: { key: 'e', code: 'KeyE', keyCode: 69 },   // klawisz ataku — nadpisywany z panelu
    itemFallbackEnabled: false, // dopasowanie "dowolny tekst: nazwa-z-plecaka" bez znanego czasownika —
                                 // WYŁĄCZONE domyślnie: fałszywie łapało wpisy logu/czatu w panelu zadań
                                 // (np. log podniesienia przedmiotu) i próbowało "użyć" niezakładalnych rzeczy

    // ── ochrona przed anty-floodem gry ──
    minSendGapMs: 250,        // minimalny odstęp między zapytaniami _g
    maxSendPer10s: 18,        // twardy limit zapytań w oknie 10 s

    // ── watchdog bezczynności ──
    idleFallbackMs: 10000,    // tyle bez żadnej akcji -> wymuś rozmowę z celem questa

    // ── dialog ──
    questBitPriority: [BITS.CONT_QUEST, BITS.NEW_QUEST],
    avoidBits: [BITS.EXIT],
    skipRe: /pomiń/i,          // opcja pomijająca scenę/przerywnik — zawsze preferowana, gdy brak opcji questowej
    loopBreakAfter: 2,          // ile razy ta sama plansza opcji może się powtórzyć z domyślną odpowiedzią,
                                 // zanim skrypt zacznie rotować przez pozostałe (mini-zagadki dialogowe)
    dialogueDelayMs: 30,       // odpowiedź niemal natychmiast — decyzja zapada z ramki, nie z DOM
    dialogueJitter: 0.4,       // rozrzut TYLKO dla dialogów, liczony od ich małej bazy
    dialogueHesitate: false,   // dialogi bez zawahań — to one najbardziej spowalniały
    dialoguePollMs: 40,        // osobna pętla: wykrywa otwarty dialog niezależnie od ramek sieciowych
    frameFreshMs: 3000,        // ramka młodsza niż to -> ufamy jej, starsza -> czytamy DOM
    stuckAnswerMs: 800,        // okno otwarte bez odpowiedzi tyle -> watchdog odpowiada
    afterDialogueCooldownMs: 300,
    fallbackOption: 1,
    dedupWindowMs: 500,        // duplikat tej samej ramki ignorowany tylko w tym oknie
    answerMaxAgeMs: 15000,     // jak stara ramka może jeszcze być podstawą odpowiedzi

    // ── humanizacja tempa ──
    // Stałe odstępy co do milisekundy to najprostszy wzorzec automatu.
    // Rozrzucamy je losowo wokół bazy — średnia zostaje, regularność znika.
    jitter: 0.35,             // ±35% od wartości bazowej
    hesitateChance: 0.12,     // szansa na krótkie "zawahanie" przed akcją
    hesitateMs: [180, 700],   // zakres tego zawahania
    clickJitterPx: 4,         // rozrzut punktu kliknięcia w pikselach

    // ── przerwy "odpoczynku" (anty-captcha, poziom średni) ──
    // Bot co jakiś czas przestaje działać na chwilę, jak człowiek odchodzący
    // od klawiatury. Brak jakichkolwiek przerw to najsilniejszy sygnał bota.
    restEnabled: true,
    restEveryMs: [7 * 60000, 14 * 60000],   // przerwa co 7-14 min aktywności
    restForMs: [25000, 90000],              // trwa 25-90 s
    microRestChance: 0.05,                  // szansa na krótkie zastygnięcie po akcji
    microRestMs: [1500, 5000],              // 1,5-5 s

    debug: true,
  };

  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  // stan sterujący zadeklarowany wcześnie — używają go hooki i funkcje dialogowe
  // zdefiniowane powyżej miejsca, gdzie inicjalizujemy resztę stanu maszyny
  let running = false;
  const log = (...a) => CFG.debug && console.log('%c[MQ]', 'color:#6cf;font-weight:bold', ...a);
  const safe = fn => { try { return fn(); } catch (e) { return null; } };
  const E = () => W.Engine;
  const ready = () => { const e = E(); return !!(e && e.allInit && e.hero && e.hero.d); };

  const hasBit = (code, bit) => {
    const n = parseInt(code, 10);
    return Number.isFinite(n) && (n & bit) !== 0;
  };

  // ── HUMANIZACJA ──
  const rnd = (a, b) => a + Math.random() * (b - a);
  // odstęp rozrzucony wokół bazy: jit(1000) da ~650-1350 ms
  const jit = (base, spread = CFG.jitter) =>
    Math.max(15, Math.round(base * rnd(1 - spread, 1 + spread)));
  // czasem człowiek się zawaha przed kliknięciem — dorzucamy to losowo
  const hesitation = () =>
    Math.random() < CFG.hesitateChance ? Math.round(rnd(CFG.hesitateMs[0], CFG.hesitateMs[1])) : 0;

  // ── PRZERWY "ODPOCZYNKU" ──
  let restUntil = 0, nextRestAt = 0, activeSince = 0;
  function scheduleNextRest() {
    nextRestAt = Date.now() + rnd(CFG.restEveryMs[0], CFG.restEveryMs[1]);
  }
  function inRest() {
    if (!CFG.restEnabled) return false;
    const now = Date.now();
    if (now < restUntil) return true;                 // trwa przerwa
    if (nextRestAt && now >= nextRestAt) {            // czas na przerwę
      const dur = Math.round(rnd(CFG.restForMs[0], CFG.restForMs[1]));
      restUntil = now + dur;
      scheduleNextRest();
      log('przerwa odpoczynku:', (dur / 1000).toFixed(0) + 's');
      safe(updateBadge);
      return true;
    }
    return false;
  }
  // krótkie zastygnięcie po pojedynczej akcji — dorzuca nieregularności
  function microRest() {
    if (!CFG.restEnabled || Math.random() >= CFG.microRestChance) return 0;
    return Math.round(rnd(CFG.microRestMs[0], CFG.microRestMs[1]));
  }

  // ── CENTRALNY WYSYŁACZ ──
  // Wszystkie zapytania idą przez jedno gardło z limitem tempa. Zbyt gęste
  // _g wywołuje anty-flood gry, który przeładowuje stronę.
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
      nextGapMs = jit(CFG.minSendGapMs);   // każdy kolejny odstęp inny
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

  // ═══════════════════════════════════════════════════════════════
  //  CEL — zawsze z aktualnej strzałki
  // ═══════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════
  //  REJESTR CELÓW QUESTA — źródło pierwotne, niezależne od strzałek
  // ═══════════════════════════════════════════════════════════════
  // questTracking.getPosByPointerName(name, name) zwraca pozycje wskaźników
  // questowych prosto z silnika — działa też gdy strzałka nie jest rysowana
  // (mała przestrzeń, zerowy dystans). Listy wskaźników nie da się wylistować
  // (siedzi w domknięciu), ale można ją odpytać po nazwie — nazwy zbieramy
  // z ID strzałek, także tych, które silnik od razu wygasza.
  const knownNames = new Map();   // nazwa -> timestamp ostatniego widzenia
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
      safe(noteArrowNames);     // łapiemy nazwę nawet gdy strzałka zaraz zgaśnie
      return res;
    };
    arrowHooked = true;
    log('hook na addArrow — nazwy celów zbierane też dla niewidocznych strzałek');
  }

  // pozycje wszystkich znanych wskaźników questowych, prosto z silnika
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

  // budowa celu z samej pozycji — NPC dołączamy jeśli tam stoi
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
    // Dwuznaczność: nazwa celu może kończyć się cyfrą ("ognisko1" na 26,26
    // daje id "ognisko126,26..."). Leniwy prefiks oddaje cyfry do x, więc
    // przesuwamy je z powrotem do nazwy, aż x zmieści się na mapie.
    const ms = getMapSize();
    if (ms) {
      while (xs.length > 1 && +xs >= ms.w) { name += xs[0]; xs = xs.slice(1); }
      if (+xs >= ms.w || y >= ms.h) return null;   // dalej poza mapą -> nie zgaduj
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
  // ── wiele strzałek: rejestr załatwionych celów ──
  const doneTargets = new Map();   // key -> timestamp oznaczenia

  function buildTarget(arrow) {
    const idTile = parseArrowId(arrow);
    const par = safe(() => arrow.objParent);

    // objParent bywa lekkim obiektem {x, y, name} BEZ pola id — npcInfo zwróci
    // wtedy null, ale jego pozycja i tak jest wiarygodniejsza niż koordynaty
    // wyparsowane z ID strzałki (te potrafią wskazywać zupełnie inny punkt)
    let tile = idTile;
    if (par && Number.isFinite(par.x) && Number.isFinite(par.y)) {
      tile = { name: par.name || (idTile && idTile.name) || '', x: par.x, y: par.y };
    }

    let npc = npcInfo(par);
    if (!npc && tile) {
      const cands = npcList().map(npcInfo).filter(Boolean).filter(n => Number.isFinite(n.x));
      // wyłącznie dokładny kafelek albo NPC POTWIERDZONY przez tracking tuż
      // obok. Branie dowolnego NPC z okolicy zabijało questy obszarowe
      // ("przeszukaj obszar") — przypadkowy przechodzień przykrywał cel.
      npc = cands.find(n => n.x === tile.x && n.y === tile.y) || null;
      if (!npc) {
        npc = cands.filter(n => chebyshev(n, tile) <= 1)
                   .filter(isTrackedNpc)
                   .sort((a, b) => chebyshev(a, tile) - chebyshev(b, tile))[0] || null;
      }
      // Fallback dla "widmowej" strzałki: isTrackedNpc zawodzi dla części
      // questów "zabij N sztuk" (potwierdzone empirycznie — zwraca pustą
      // listę dla wszystkich widocznych mobów, nie tylko złego). Strzałka po
      // zgaśnięciu z bliska (enabled:false) zamraża objParent w ostatniej
      // znanej pozycji, a moby wędrują dalej — bez tego fallbacku bot dochodzi
      // do martwego punktu i staje, mimo że żywy mob stoi kawałek dalej.
      // killQuestNames (lista "Zabij: X, Y, Z" wprost z etapu) działa od
      // PIERWSZEJ sekundy questa — huntName samo nie wystarczy, bo wypełnia
      // się dopiero po udanym ataku.
      // Dopasowanie CZĘŚCIOWE (nie ścisła równość): niektóre moby dostają
      // losowe imię własne przy tym samym typie ("Ork Zhaghkk", "Ork
      // Traroll") — quest podaje gatunek ("Ork"), a konkretne sztuki mają
      // dopisane imię. Ścisłe porównanie nigdy by ich nie połączyło.
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

  // najbliższy cel spośród niezałatwionych; gdy wszystkie załatwione -> null
  function currentTarget() {
    const list = allTargets();

    // Rejestr czyścimy WYŁĄCZNIE po czasie. Kasowanie wpisu, gdy klucz znika
    // z listy strzałek, powodowało migotanie: cel wracał do puli w tym samym
    // ticku, w którym został oznaczony.
    for (const [k, ts] of [...doneTargets.entries()]) {
      if (Date.now() - ts > CFG.doneTtlMs) doneTargets.delete(k);
    }

    const isDone = t => doneTargets.has(t.key) ||
      (t.npc && doneTargets.has('npc:' + t.npc.id)) ||
      (t.tile && doneTargets.has('tile:' + t.tile.x + ',' + t.tile.y));

    // cel oddalony o więcej niż maxTargetDistance to niemal na pewno efekt
    // błędnego odczytu koordynatów, a nie realne miejsce na mapie
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

    // ▶ STRZAŁKA MA PIERWSZEŃSTWO ABSOLUTNE.
    // Jeśli silnik rysuje strzałkę, to ona wskazuje właściwy cel — nie wolno
    // schodzić do fallbacków, bo te potrafią zwrócić punkt z innego questa
    // (getPosByPointerName przeszukuje globalną listę wskaźników).
    if (list.length) {
      const sanel = list.filter(sane);
      if (sanel.length) {
        sanel.sort((a, b) => distanceToTarget(a) - distanceToTarget(b));
        const t = sanel[0];
        // wszystkie oznaczone jako załatwione, a strzałka wciąż wisi — quest
        // nadal ich chce; po arrowRetryMs wracamy do próby zamiast błądzić
        const ts = doneTargets.get(t.key) || 0;
        if (Date.now() - ts > CFG.arrowRetryMs) {
          doneTargets.delete(t.key);
          if (t.npc) doneTargets.delete('npc:' + t.npc.id);
          if (t.tile) doneTargets.delete('tile:' + t.tile.x + ',' + t.tile.y);
          log('strzałka wciąż wskazuje', t.key, '— ponawiam podejście');
          return t;
        }
      }
      return null;   // czekamy, ale NIE idziemy w losowe miejsce
    }

    // ▶ ŹRÓDŁO PIERWOTNE: pozycje wskaźników questowych prosto z silnika.
    // Działa bez strzałki — w celi, przy zerowym dystansie, wszędzie.
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

    // Brak strzałek nie znaczy brak celów: przy questach typu "zabij N sztuk"
    // instancje są rozsiane po mapie, a tracking rysuje strzałkę nie dla
    // wszystkich. Skanujemy więc CAŁĄ mapę za celami śledzenia.
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

    // ostatnia deska: getNearTrackingNpc
    const near = npcInfo(safe(() => E().questTracking.getNearTrackingNpc()));
    if (near) {
      const key = 'npc:' + near.id;
      if (!doneTargets.has(key)) return { arrow: null, tile: null, npc: near, key, nearOnly: true };
    }
    return null;
  }

  // ── rozpoznanie celu śledzenia: po ID oraz po szablonie (questy na zabijanie) ──
  let lastTrackedCount = -1;
  let lastPtrLogged = '';        // żeby nie spamować logiem o celu ze wskaźnika
  let lastInsaneLogged = -1;    // żeby nie spamować logiem o odrzuconych celach
  let huntName = '';            // nazwa moba z ostatniego ataku — wzorzec dla kolejnych sztuk
  let tplCache = { at: 0, val: [] };
  function trackedTpls() {
    const now = Date.now();
    if (now - tplCache.at < 1000) return tplCache.val;   // cache: skan mapy woła to setki razy
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
    // po śmierci moba objParent gaśnie i klucz zmienia się z npc:ID na tile:x,y
    // — oznaczamy OBA, inaczej cel wraca do puli jako "nowy"
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

  // ═══════════════════════════════════════════════════════════════
  //  DIALOG
  // ═══════════════════════════════════════════════════════════════
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

  // gra ma też kanał HTTP (idleJSON/startJSONInterval) — łapiemy fetch i XHR
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
      // listener TYLKO raz na instancję — gra recyklinguje obiekty XHR,
      // a dopinanie go przy każdym open() mnożyło obsługę tej samej odpowiedzi
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
    if (!running) return;   // bot wyłączony -> nie tykamy dialogów mimo żywego hooka
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

    // dedup TYLKO w krótkim oknie — powtórna rozmowa z tym samym NPC musi przejść
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

  // ── ŁAMANIE PĘTLI DIALOGOWEJ ──
  // Niektóre dialogi to mini-zagadki (np. "popchnij/pociągnij dźwignię") bez
  // żadnej opcji oznaczonej bitem questowym — deterministyczny wybór
  // "pierwsza nie-wyjściowa" zawsze trafia w tę samą (być może błędną)
  // odpowiedź i zapętla się w nieskończoność. Rozpoznajemy powtórkę po
  // zestawie tekstów opcji (niezależnie od ich kolejności) i po kilku
  // próbach zaczynamy rotować przez pozostałe, aż któraś zmieni dialog.
  const dialogueLoopTracker = new Map();   // sygnatura opcji -> {idx, count}
  function loopBreakPick(nonExitIdxs, allTexts) {
    if (nonExitIdxs.length <= 1) return null;
    const sig = allTexts.map(norm2).sort().join('|');
    let rec = dialogueLoopTracker.get(sig);
    if (!rec) rec = { idx: 1, count: 0 };   // idx startuje od 1 — 0 to domyślna, już wypróbowana
    rec.count++;
    dialogueLoopTracker.set(sig, rec);
    if (rec.count <= CFG.loopBreakAfter) return null;   // jeszcze w granicach normalnego powtórzenia
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
    // etap wymaga zakupu (funkcja hoistowana, zdefiniowana niżej w pliku) ->
    // otwarcie sklepu jest postępem, preferuj tę opcję nad zwykłą rozmową
    if (shopStageNames().length) {
      const sh = options.findIndex(o => hasBit(o.code, BITS.SHOP));
      if (sh >= 0) { shopOpenedByBot = true; return { idx: sh, why: 'sklep (etap wymaga zakupu)' }; }
    }
    // przerywniki typu [ Kontynuuj. ] / [ Pomiń. ]: brak opcji questowej ->
    // pomijamy scenę, celowo PRZED filtrem avoidBits (Pomiń bywa oznaczone
    // jako wyjście i filtr by je odrzucił)
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

  // ── SZYBKA PĘTLA DIALOGOWA ──
  // Nie czekamy na ramkę sieciową: gdy okno jest otwarte i pokazuje ekran,
  // na który jeszcze nie odpowiedzieliśmy, odpowiadamy natychmiast.
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
    if (!texts.length) return;                 // okno jeszcze się rysuje
    const sig = texts.join('|');
    if (sig === answeredSig) return;           // na ten ekran już odpowiedzieliśmy

    // ramka świeża -> decyzja z bitów (pewniejsza); inaczej z klas w DOM
    const fresh = lastDialogue && Date.now() - lastDialogue.at < CFG.frameFreshMs;
    const ok = fresh ? answerDialogue('szybka') : answerFromDom();
    if (ok) answeredSig = sig;
  }

  // ratunek gdy ramka nie została przechwycona: czytamy opcje z DOM
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

    // priorytet: klasa questowa, potem sklep (gdy etap tego wymaga),
    // potem Pomiń (przerywnik), potem pierwsza bez line_exit
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

  // ═══════════════════════════════════════════════════════════════
  //  KLIKANIE STRZAŁKI (jedyny klik w skrypcie — brak API nawigacji)
  // ═══════════════════════════════════════════════════════════════
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
    // rozrzut kilku pikseli — człowiek nie trafia dwa razy w ten sam punkt
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

  // krok w bok, żeby ruszyć postać z pola-celu i wyzwolić detekcję ruchu.
  // Nie ufamy własnemu sprawdzaniu kolizji (format niepewny) — zlecamy
  // autoGoTo na kolejne sąsiednie pola i pozwalamy pathfinderowi gry wybrać
  // osiągalne. Za każdym wywołaniem próbujemy innego kierunku.
  let nudgeDir = 0;
  const NUDGE_DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  function nudgeStep(t) {
    const h = E().hero.d;
    // preferuj pola, o których wiemy, że są przechodnie; ale nie odrzucaj
    // wszystkiego, gdy danych kolizji brak — wtedy po prostu próbuj po kolei
    const md = safe(() => E().map.d) || {};
    const known = [];
    const blind = [];
    for (const [dx, dy] of NUDGE_DIRS) {
      const nx = h.x + dx, ny = h.y + dy;
      if (md.x && (nx < 0 || ny < 0 || nx >= md.x || ny >= md.y)) continue;   // poza mapą
      (tileWalkableKnown(nx, ny) ? known : blind).push({ x: nx, y: ny });
    }
    const pool = known.length ? known : blind;   // najpierw pewne, potem "na ślepo"
    if (!pool.length) {
      log('krok w bok: brak sąsiednich pól w granicach mapy — próba interakcji');
      if (!clickArrow(t)) pressQ();
      return false;
    }
    const dest = pool[nudgeDir % pool.length];
    nudgeDir++;
    log('krok w bok na', dest.x + ',' + dest.y, known.length ? '(pewne)' : '(na ślepo)');
    if (!safe(() => { E().hero.autoGoTo({ x: dest.x, y: dest.y }); return 1; })) {
      safe(() => E().hero.autoGoTo(dest.x, dest.y));
    }
    return true;
  }

  // kolizja tylko gdy dane są dostępne i jednoznaczne; brak danych -> null (nie wiemy)
  function tileWalkableKnown(x, y) {
    const md = safe(() => E().map.d);
    const col = safe(() => E().collision) || safe(() => E().map && E().map.col);
    const w = md && +md.x;
    if (!col || !Number.isFinite(w)) return false;   // nie wiemy -> nie "pewne"
    const c = col[y * w + x] ?? col[x + ',' + y];
    if (c === 1 || c === true || c === '1') return false;
    // pole zajęte przez NPC/gracza
    if (npcList().map(npcInfo).filter(Boolean).some(n => n.x === x && n.y === y)) return false;
    return true;
  }

  // ── UŻYCIE / ZAŁOŻENIE PRZEDMIOTU ──
  // Etap questa: "Użyj przedmiotu: X" albo "Załóż: X". Request jest ten sam
  // (moveitem&st=1&id=ID) — serwer sam decyduje, czy wypić czy ubrać, na
  // podstawie typu. My tylko znajdujemy przedmiot po nazwie i wysyłamy ID.
  const norm2 = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  // dopasowanie CZĘŚCIOWE — łapie moby z losowym imieniem własnym przy tym
  // samym gatunku ("Ork" pasuje do "Ork Zhaghkk"), używane w kilku miejscach
  const nameMatches = (a, b) => {
    const x = norm2(a), y = norm2(b);
    return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
  };

  // lista przedmiotów z plecaka — potwierdzone API: fetchLocationItems("g")
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
    // obiekty przedmiotów są opakowane — użyteczne dane tylko przez gettery
    const id = safe(() => o.getId && o.getId()) ?? o.id;
    const name = safe(() => o.getName && o.getName());
    if (id == null || !name) return null;
    return {
      id: String(id),
      name,
      loc: safe(() => o.getLoc && o.getLoc()),   // 'g' = plecak; slot wyposażenia = założony
      st: safe(() => o.getSt && o.getSt()),
      tpl: safe(() => o.getTpl && o.getTpl()),
      raw: o,
    };
  }

  // znajdź przedmiot po nazwie z etapu; preferuj te w plecaku (loc 'g')
  function findItemByName(want) {
    const w = norm2(want);
    if (!w) return null;
    const items = bagItems().map(itemInfo).filter(Boolean);
    const inBag = i => i.loc == null || String(i.loc) === 'g';
    const exact = items.filter(i => norm2(i.name) === w);
    const partial = items.filter(i => norm2(i.name).includes(w) || w.includes(norm2(i.name)));
    // najpierw dokładne dopasowanie w plecaku, potem dokładne gdziekolwiek, itd.
    return exact.find(inBag) || exact[0] || partial.find(inBag) || partial[0] || null;
  }

  // wspólny odczyt tekstu panelu zadań — odfiltrowuje wpisy logu/czatu
  // (znaczniki czasu "12:34", tagi "[G]"/"[S]"/"[Z]"), bo to nie są
  // instrukcje etapu, tylko historia zdarzeń wyświetlana w tym samym panelu
  function questPanelTexts() {
    const texts = [];
    document.querySelectorAll('.questField, .quest-content, [class*="quest"]').forEach(el => {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t) return;
      if (/^\d{1,2}:\d{2}\b/.test(t)) return;        // "12:34 [G] ..."
      if (/\[[A-ZĄĆĘŁŃÓŚŹŻ]\]/.test(t)) return;       // "[G]" "[S]" "[Z]" itp.
      texts.push(t);
    });
    return texts;
  }

  // wyciągnij WSZYSTKIE nazwy przedmiotów z etapu questa — etap może mieć
  // kilka linii naraz (np. "Załóż przedmiot: X" + "Załóż przedmiot: Y")
  function itemNamesFromQuest() {
    const texts = questPanelTexts();

    // czyści ogon nazwy: ucina wszystko od kolejnego dwukropka (to już inne
    // pole UI, nie nazwa przedmiotu), znane słowa-śmieci z sąsiednich
    // widgetów (filtry, listy), spójniki i koniec zdania
    const clean = s => s
      .replace(/:.*$/, '')
      .replace(/\s+(i|oraz|a następnie|potem|,|;|Filtruj|poziom|Obserwowane|Profesja)\b.*$/i, '')
      .replace(/[.!?].*$/, '')
      .trim();

    // dopasowanie ŚCISŁE (norm2 równość) — bezpieczne niezależnie od długości
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
      // 1) ścisłe dopasowanie po oczyszczeniu, 2) ścisłe po surowej,
      // 3) rozmyte (zawieranie) — TYLKO dla rozsądnie krótkiego tekstu.
      // Bez weryfikacji w plecaku nic nie trafia na listę: selektor DOM bywa
      // szeroki i potrafi skleić tekst z sąsiednich widgetów (filtry, menu)
      // w jeden długi ciąg — bez tego warunku taki śmieć trafiłby do
      // useQuestItem i mógłby przez przypadkowe zawieranie użyć złego przedmiotu.
      if (cleaned && bagExact(cleaned)) name = cleaned;
      else if (bagExact(rawTrim)) name = rawTrim;
      else if (cleaned && cleaned.length <= 40 && findItemByName(cleaned)) name = cleaned;
      if (!name) return;
      const key = norm2(name);
      if (seen.has(key)) return;
      seen.add(key);
      found.push(name);
    };

    // ▶ WYMÓG DWUKROPKA. Instrukcja etapu ma format "Czasownik [rzeczownik]: Nazwa"
    // (np. "Wypij: Herbata od Mima", "Załóż przedmiot: Miecz"). Opis zadania
    // to zdanie ciągłe BEZ dwukropka po czasowniku — nie może się dopasować.
    // Warianty z dodatkowym rzeczownikiem ("załóż przedmiot") muszą być
    // wypisane wprost — inaczej słowo między czasownikiem a dwukropkiem
    // łamie dopasowanie. Grupa przechwytująca ograniczona do 60 znaków —
    // realna nazwa przedmiotu nigdy nie jest dłuższa, a to tnie w zarodku
    // najgorsze przypadki sklejonego tekstu z DOM.
    const verbRe = /(?:użyj przedmiotu|użyj|załóż przedmiot|załóż|ubierz|wypij|zjedz|spożyj|wypal|aktywuj|zastosuj)\s*:\s*([^\n.!?:]{1,60})/gi;
    for (const t of texts) {
      verbRe.lastIndex = 0;
      let m;
      while ((m = verbRe.exec(t)) !== null) addCandidate(m[1]);
    }

    // fallback: dowolna etykieta "coś: nazwa", gdzie nazwa jest w plecaku.
    // WYŁĄCZONY domyślnie (CFG.itemFallbackEnabled) — zbyt ryzykowny, łapał
    // wpisy niepowiązane z instrukcją etapu. Włącz świadomie, jeśli trafisz
    // na nowe sformułowanie, którego nie ma na liście czasowników wyżej.
    if (!found.length && CFG.itemFallbackEnabled) {
      for (const t of texts) {
        const re = /:\s*([^:.\n!?]{2,40})/g;
        let m;
        while ((m = re.exec(t)) !== null) addCandidate(m[1]);
      }
    }
    return found;
  }
  // wsteczna zgodność: pojedyncza nazwa (pierwsza z listy)
  const itemNameFromQuest = () => itemNamesFromQuest()[0] || null;

  // czy aktywny etap to "przeszukaj/zbadaj obszar" (quest obszarowy)
  function isAreaSearchQuest() {
    for (const t of questPanelTexts()) {
      if (/przeszukaj|zbadaj|przeczesz/i.test(t)) return true;
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════════
  //  SKLEP — etap "Kup przedmiot: X"
  // ═══════════════════════════════════════════════════════════════
  // Nazwy przedmiotów do kupienia — wyciągane z tekstu etapu BEZ wymogu
  // otwartego sklepu (bo to właśnie ta nazwa decyduje, czy w ogóle sklep
  // trzeba otworzyć). Ryzyko śmieci z DOM ograniczamy tak samo jak przy
  // "użyj/załóż": wykluczenie dwukropka z przechwytywanego tekstu, cięcie
  // po słowach-śmieciach UI, limit długości. Bez weryfikacji w katalogu
  // (sklep jeszcze zamknięty) — to jedyny etap, gdzie akceptujemy nazwę
  // bez potwierdzenia, bo potwierdzić nie ma jak przed otwarciem sklepu.
  // lista nazw moli do zabicia wprost z etapu questa: "Zabij: X, Y, Z (8/15)".
  // Działa od pierwszej sekundy questa, niezależnie od tego, czy cokolwiek
  // już skutecznie zaatakowano (w przeciwieństwie do huntName, które
  // wypełnia się dopiero PO udanym ataku — bezużyteczne przy pierwszym
  // kontakcie z widmową strzałką).
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

  // katalog aktualnie otwartego sklepu — pusty obiekt, gdy sklep zamknięty
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

  // rotacja: przy kilku przedmiotach w etapie próbujemy po kolei, jeden na
  // wywołanie, żeby każdy dostał szansę zamiast utknięcia na pierwszym
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
      itemRotateIdx = (idx + 1) % names.length;   // następnym razem zacznij od kolejnego
      return true;
    }
    return false;
  }

  // sygnatura aktywnych zadań — zmiana = nowy quest, trzeba wyczyścić cele
  function questSignature() {
    const list = (safe(() => E().questsObserve && E().questsObserve.list)) || {};
    return Object.keys(list).filter(k => list[k]).sort().join(',');
  }
  let lastQuestSig = null;
  let shopOpenedByBot = false;   // sklep otwarty przez bota (do zakupu) — tylko taki bot sam zamyka

  function onQuestChange() {
    log('zmiana aktywnego zadania — czyszczę cele i stan interakcji');
    doneTargets.clear();
    knownNames.clear();
    talkCount.clear();
    tplCache = { at: 0, val: [] };
    huntName = '';
    lastKey = '';
    lastPtrLogged = '';
    lastFrameKey = '';
    answeredSig = '';
    lastDialogue = null;   // stara ramka dialogu nie może już wyzwolić odpowiedzi
    state = 'NAV';
    talkTries = 0;
    moved = false;
    shopOpenedByBot = false;
    dialogueLoopTracker.clear();
  }

  // ═══════════════════════════════════════════════════════════════
  //  OKIENKO DECYZYJNE ("Wiadomość" — Tak/Nie, wybór nagrody itp.)
  // ═══════════════════════════════════════════════════════════════
  // Potwierdzone z DOM gry: kontener ma klasy c-window + mAlert + askAlert,
  // treść w .inner-content, przyciski w .window-controlls .button.small,
  // a tekst przycisku siedzi w zagnieżdżonym .label (nie bezpośrednio w guziku).
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
      idx = 0;   // wszystkie inne pytania -> zawsze lewa/pierwsza opcja
    }

    log('okienko decyzyjne:', texts.join(' | '), '-> wybieram [' + idx + ']', texts[idx],
        isExpChoice ? '(exp: ' + (CFG.collectExp ? 'TAK' : 'NIE') + ')' : '');
    btns[idx].el.click();
  }

  // diagnostyka: pokaż co widać na ekranie, gdy okienko nie jest łapane
  function decisionDebug() {
    const all = [...document.querySelectorAll(DECISION_SEL)].filter(el => el.offsetParent !== null);
    return all.map(el => ({ el, klasy: el.className, przyciski: decisionButtons(el).map(b => b.text) }));
  }

  // ── NAWIGACJA FUNKCYJNA ──
  // Engine.hero.autoGoTo — natywny pathfinder bohatera. Klik w strzałkę
  // zostaje wyłącznie jako fallback, gdyby autoGoTo rzuciło błędem.
  function navigateTo(t) {
    // pozycja NPC (z objParent) jest jednoznaczna — parsowany kafelek tylko
    // gdy NPC nieznany (przejścia, obiekty bez referencji)
    const dest = (t && t.npc && Number.isFinite(t.npc.x) && { x: t.npc.x, y: t.npc.y }) || (t && t.tile);
    if (!dest) return false;
    const h = E().hero;
    lastClickAt = Date.now();
    nextNavGap = jit(CFG.clickIntervalMs);   // kolejne przeliczenie za losowy czas
    if (typeof h.autoGoTo === 'function') {
      try { h.autoGoTo({ x: dest.x, y: dest.y }); log('autoGoTo ->', dest.x + ',' + dest.y); return true; }
      catch (e1) {
        try { h.autoGoTo(dest.x, dest.y); log('autoGoTo(x,y) ->', dest.x + ',' + dest.y); return true; }
        catch (e2) { log('autoGoTo błąd:', e2.message); }
      }
    }
    return clickArrow(t);
  }

  // symulacja klawisza — Q (interakcja) i E (atak); używane punktowo
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

  // ═══════════════════════════════════════════════════════════════
  //  ZAGADANIE PRZEZ _g()
  // ═══════════════════════════════════════════════════════════════
  const talkCount = new Map();

  function talkToTarget() {
    const t = currentTarget();
    lastTalkAt = Date.now();
    talkTries++;

    if (!t) { log('brak celu — nie zagaduję'); return false; }

    const dist = distanceToTarget(t);
    const maxDist = t.npc ? CFG.talkRadius : 1;
    if (dist > maxDist) { log('cel za daleko (' + dist + ')'); return false; }

    // cel-kafelek: jeśli stoimy NA nim, akcja mogła się już wykonać samym
    // wejściem — i tak próbujemy interakcji, ale bez zagadywania sąsiadów
    if (!t.npc) {
      if (clickArrow(t)) { log('interakcja z obiektem:', (t.tile && t.tile.name) || t.key, '| dystans', dist); return true; }
      pressQ();
      return true;
    }

    // ── potwór czy rozmówca? mob ma lvl > 0 albo typ bojowy (2/3).
    // ALE część questowych "potworów" wymaga rozmowy mimo posiadania lvl.
    // Dlatego metoda jest ADAPTACYJNA: zaczynamy zgodnie z heurystyką, a gdy
    // wybrana metoda nie daje efektu, przełączamy na drugą i zapamiętujemy to.
    const d0 = (t.npc.obj && t.npc.obj.d && typeof t.npc.obj.d === 'object') ? t.npc.obj.d : {};
    const looksMob = (Number.isFinite(+d0.lvl) && +d0.lvl > 0) || [2, 3].includes(+d0.type);

    const rec = talkCount.get(t.key) || { n: 0, mode: looksMob ? 'attack' : 'talk', switched: false };
    rec.n++;

    // przełącz metodę, gdy dotychczasowa nie zadziałała po kilku próbach
    if (rec.n > CFG.sameTargetMaxTalks && !rec.switched) {
      rec.mode = rec.mode === 'attack' ? 'talk' : 'attack';
      rec.switched = true;
      rec.n = 1;
      log('cel', t.npc.name || t.npc.id, '— metoda "' + (rec.mode === 'attack' ? 'talk' : 'attack') +
          '" bez efektu, przełączam na "' + rec.mode + '"');
    }
    // obie metody wyczerpane -> skreśl cel
    else if (rec.n > CFG.sameTargetMaxTalks && rec.switched) {
      log('cel', t.npc.name || t.npc.id, '— obie metody bez efektu, skreślam');
      markDone(t, 'atak i rozmowa bez efektu');
      talkCount.delete(t.key);
      state = 'NAV'; talkTries = 0; lastKey = '';
      return false;
    }
    talkCount.set(t.key, rec);

    if (rec.mode === 'attack') {
      huntName = t.npc.name || huntName;   // dla questów "zabij N sztuk"
      log('ATAK (E):', t.npc.name || t.npc.id, '| lvl', d0.lvl, '| próba', rec.n);
      return pressE();
    }

    if (!gSend('talk&id=' + t.npc.id)) return false;
    log('zagadanie:', t.npc.name || t.npc.id, '| dystans', dist, '| próba', rec.n);
    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  //  MASZYNA STANÓW
  // ═══════════════════════════════════════════════════════════════
  let timer = null, state = 'OFF';
  let lastClickAt = 0, lastMoveAt = 0, lastDialogueAt = 0, lastTalkAt = 0;
  let nextNavGap = CFG.clickIntervalMs, lastNudgeAt = 0, lastItemTry = 0, lastShopTry = 0, nudgeGiveUpCount = 0;
  let lastPos = '', moved = false, talkTries = 0, lastKey = '', stuckRetries = 0;

  function tick() {
    if (!ready()) return;
    const now = Date.now();

    // ▶ ZMIANA AKTYWNEGO ZADANIA -> wyczyść cele starego questa.
    // Gdy nowy quest zaczyna się u innego NPC, stary bywa nadal celem tracking,
    // a rozmowa z nim niczego nie pcha — bez czyszczenia bot gada w kółko.
    const qsig = questSignature();
    if (lastQuestSig === null) lastQuestSig = qsig;
    else if (qsig !== lastQuestSig) { lastQuestSig = qsig; onQuestChange(); }

    // ▶ ŚWIEŻOŚĆ huntName: quest potrafi przejść do kolejnego etapu bez
    // żadnego dialogu (sam licznik "15/15" kończy etap zabijania) — wtedy
    // DIALOG->NAV nigdy nie odpala i huntName zostaje z poprzedniego etapu
    // na zawsze, każąc botowi dalej bić już niepotrzebny gatunek (i przez to
    // "deskę ratunku" — dowolnego innego moba w promieniu). Sprawdzamy co
    // tick: jeśli polowany gatunek zniknął z aktualnej listy "Zabij", czyść.
    if (huntName) {
      const kq = killQuestNames();
      if (!kq.length || !kq.some(k => nameMatches(k, huntName))) {
        log('huntName nieaktualne (' + huntName + ') — etap zabijania zakończony, czyszczę');
        huntName = '';
      }
    }

    // ▶ watchdog: okno otwarte, a odpowiedź nie poszła — ramka albo DOM
    if (isDialogueOpen()) {
      if (now - Math.max(lastAnswerAt, lastFrameAt) > CFG.stuckAnswerMs) {
        if (!answerDialogue('watchdog')) answerFromDom();
      }
      return;
    }

    if (state === 'DIALOG') {
      if (now - lastDialogueAt > CFG.afterDialogueCooldownMs) {
        markDone(lastKey, 'rozmowa zakończona');
        if (lastKey) talkCount.delete(lastKey);   // udana rozmowa = postęp, licznik od zera
        huntName = '';   // etap questa się zmienił — stary wzorzec moba nieaktualny
        state = 'NAV'; moved = false; talkTries = 0; lastKey = ''; log('-> NAV');
      }
      return;
    }

    // ▶ PRZERWA ODPOCZYNKU — po dialogu (nie przerywa rozmowy), przed ruchem.
    // Podbijamy znaczniki aktywności, żeby idle-watchdog nie odpalił po powrocie.
    if (inRest()) {
      lastMoveAt = lastTalkAt = lastClickAt = now;
      return;
    }

    // ▶ ETAP "UŻYJ/ZAŁÓŻ PRZEDMIOT" — zwykle bez celu na mapie (przedmiot
    // jest w plecaku). Etap może wymagać kilku przedmiotów naraz — useQuestItem
    // rotuje przez wszystkie, próbujemy co itemRetryMs.
    if (now - lastItemTry > CFG.itemRetryMs) {
      const names = itemNamesFromQuest();
      if (names.length) {
        lastItemTry = now;
        if (useQuestItem()) { lastTalkAt = now; return; }
      }
    }

    // ▶ ETAP "KUP PRZEDMIOT" — jeśli sklep jest już otwarty (dialog z NPC
    // wybrał opcję sklepu, patrz pickOption/answerFromDom), kupujemy
    // rotacyjnie tak samo jak przy użyciu/założeniu przedmiotu.
    if (isShopOpen() && now - lastShopTry > CFG.itemRetryMs) {
      lastShopTry = now;
      if (buyQuestItems()) { lastTalkAt = now; return; }
    }

    // ▶ ZAMKNIĘCIE SKLEPU po zakończonych zakupach questowych. Tylko gdy to
    // BOT go otworzył (shopOpenedByBot) — nigdy nie zamykamy sklepu, który
    // otworzyłeś ręcznie, nawet jeśli akurat nie ma aktywnego etapu zakupu.
    if (shopOpenedByBot && isShopOpen() && !shopStageNames().length) {
      log('sklep: zakupy questowe zakończone — zamykam (Esc)');
      pressEsc();
      shopOpenedByBot = false;
      lastTalkAt = now;
      return;
    }
    if (!isShopOpen()) shopOpenedByBot = false;   // sklep zamknięty (np. ręcznie) -> zapomnij flagę

    // ▶ QUEST OBSZAROWY BEZ CELU: teleport w środek obszaru "przeszukaj"
    // gasi strzałkę i nie tworzy wskaźnika, więc nie mamy czego wykryć.
    // Jeśli aktywny jest etap "przeszukaj/zbadaj obszar", a bot stoi bez
    // celu i bez ruchu — robimy krok w bok, żeby wyzwolić detekcję pola.
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

    hookArrows();          // instalacja przy pierwszym ticku po załadowaniu silnika
    noteArrowNames();      // odświeżanie nazw z aktualnie widocznych strzałek
    if (mapName !== lastMapForNames) {
      lastMapForNames = mapName;
      knownNames.clear();  // wskaźniki są per mapa
      lastPtrLogged = '';
    }

    const t = currentTarget();

    const key = t ? t.key : '';
    if (key !== lastKey) {
      if (lastKey) log('nowy cel:', key || '(brak)');
      lastKey = key;
      state = 'NAV'; moved = false; talkTries = 0; stuckRetries = 0;
    }

    // ▶ WATCHDOG BEZCZYNNOŚCI:
    // nic się nie dzieje od idleFallbackMs -> wymuś rozmowę z NPC-celem przez
    // request (zgodnie z zasadą: funkcje/requesty zamiast symulacji). Q tylko
    // wtedy, gdy żadnego NPC-celu nie da się ustalić.
    const lastActivity = Math.max(lastMoveAt, lastClickAt, lastTalkAt, lastDialogueAt);
    if (now - lastActivity > CFG.idleFallbackMs) {
      lastTalkAt = now;   // zeruje licznik bezczynności, ponowienie za idleFallbackMs
      const npc = (t && t.npc) || npcInfo(safe(() => E().questTracking.getNearTrackingNpc()));
      if (npc && gSend('talk&id=' + npc.id)) {
        log('bezczynność ' + (CFG.idleFallbackMs / 1000) + 's — wymuszam rozmowę z', npc.name || npc.id);
      } else if (!npc) {
        log('bezczynność ' + (CFG.idleFallbackMs / 1000) + 's — brak NPC-celu, symuluję Q');
        pressQ();
      }
      return;
    }

    if (!t) return;

    // cel-NPC zniknął z mapy (ubity potwór, NPC odszedł) -> od razu do kolejnego,
    // bez czekania na wyczerpanie prób interakcji ze zwłokami
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

      // ▶ POSTAĆ WRZUCONA NA CEL-KAFELEK — DWA RÓŻNE PRZYPADKI.
      // 1) Quest teleportował gracza na pole wykrywające ruch (obszar do
      //    przeszukania) — krok w bok faktycznie coś wyzwala, nudge'ujemy
      //    bez limitu, to zamierzony mechanizm.
      // 2) To "duch" questa zabijania — nazwa kafelka pasuje do listy "Zabij"
      //    albo huntName, ale w tym miejscu nikogo już nie ma (strzałka
      //    zamroziła pozycję dawno pokonanego moba). Nudge tu NIC nie daje —
      //    nie ma żadnego pola detekcji do wyzwolenia. Bez limitu prób ta
      //    gałąź potrafiła nudge'ować w nieskończoność (potwierdzone w logu).
      //    Po kilku próbach poddajemy się i skreślamy ten cel.
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
          nudgeGiveUpCount = 0;   // zwykły teleport na pole detekcji — bez limitu
        }
        if (now - lastNudgeAt > CFG.nudgeCooldownMs) {
          lastNudgeAt = now;
          nudgeStep(t);
        }
        return;
      }
      nudgeGiveUpCount = 0;   // cel się zmienił / nie jest to już przypadek dist===0

      // Cel-NPC: zatrzymujemy się obok (talkRadius).
      // Cel-kafelek (obszar do przeszukania, przejście, przedmiot): trzeba
      // WEJŚĆ na pole — samo wejście jest akcją, więc jedziemy do dystansu 0.
      const stopDist = t.npc ? CFG.talkRadius : 0;
      const arriveDist = t.npc ? CFG.talkRadius : 1;   // gdy pole zablokowane, działamy z sąsiedniego

      if (settled && dist <= arriveDist) {
        state = 'ARRIVED'; talkTries = 0;
        log('-> ARRIVED, dystans', dist, t.npc ? '' : '(cel-kafelek)');
        setTimeout(talkToTarget, jit(CFG.talkDelayMs) + hesitation());
        return;
      }

      const inRange = dist <= stopDist;

      // ▶ UTKNIĘCIE: brak postępu mimo trwającego "marszu" — obejmuje też
      // przypadek gdy cel jest formalnie w zasięgu (inRange), ale stan z
      // jakiegoś powodu nigdy nie osiąga ARRIVED (oscylacja pozycji celu,
      // np. wędrujący mob, albo nieaktualny wpis NPC z zafiksowaną pozycją
      // — wcześniej ten przypadek nie miał żadnej siatki bezpieczeństwa i
      // wymagał zewnętrznego zdarzenia, żeby się odblokować).
      if (now - lastMoveAt > CFG.navStuckMs) {
        lastMoveAt = now;          // odlicz kolejne navStuckMs od teraz
        stuckRetries++;
        log('bezruch ' + (CFG.navStuckMs / 1000) + 's' + (inRange ? ' (w zasięgu, bez ARRIVED)' : '') +
            ' — odświeżam cel i trasę (' + stuckRetries + ')');
        tplCache = { at: 0, val: [] };   // wymuś ponowny odczyt danych questa
        knownNames.clear();              // wymuś ponowne zebranie nazw wskaźników
        lastPtrLogged = '';
        lastKey = '';                    // wymuś ponowny wybór celu
        lastClickAt = 0;                 // pozwól od razu przeliczyć trasę
        if (stuckRetries >= CFG.stuckGiveUpTries) {
          markDone(t, 'nieosiągalny po ' + stuckRetries + ' odświeżeniach');
          state = 'NAV'; talkTries = 0; stuckRetries = 0;
        }
        return;
      }

      if (!inRange && now - lastClickAt > nextNavGap) navigateTo(t);
      return;
    }

    if (state === 'ARRIVED') {
      // cel bez NPC (kości, drzwi, obiekt bez id) — przy bliskim dystansie
      // strzałka rysuje się NA obiekcie, więc klik w nią jest interakcją
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

  // pętle planują się same z losowym odstępem — brak sztywnego rytmu
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
    restUntil = 0; scheduleNextRest();   // pierwsza przerwa za restEveryMs od teraz
    // start liczników od teraz, żeby watchdog nie odpalił w pierwszej sekundzie
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
    state = 'OFF'; log('stop');
    safe(updateBadge);
  };

  // ═══════════════════════════════════════════════════════════════
  //  WŁĄCZNIK — Ctrl+Shift+Q, stan przeżywa odświeżenie strony
  // ═══════════════════════════════════════════════════════════════
  const LS_KEY = 'mq_bot_enabled';
  const LS_KEY_EXP = 'mq_collect_exp';
  const LS_KEY_TALK = 'mq_key_talk';
  const LS_KEY_ATTACK = 'mq_key_attack';
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

  // ── panel ustawień: prawy klik na wskaźnik otwiera/zamyka ──
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

    // klawisz jednoznakowy pokazujemy wielką literą, resztę jako kod (np. "Space")
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
          if (ev.key === 'Escape') { btn.textContent = keyLabel(CFG[cfgProp]); return; }   // anuluj
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

  // capture + stopImmediatePropagation, żeby gra nie dostała samego "q"
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
    log('AutoQ v9.4 gotowe → klik: włącz/wyłącz | PPM na wskaźnik: ustawienia (exp, klawisze) | Ctrl+Shift+Q: to samo co klik');
  }, 500);
})();