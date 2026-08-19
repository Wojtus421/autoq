// ==UserScript==
// @name         AutoQ — Margonem auto quest
// @namespace    Wojtus
// @version      10.0
// @description  Loader: wstrzykuje najnowszy bundle AutoQ przy każdym wejściu (bez cyklu Tampermonkey)
// @match        https://*.margonem.pl/*
// @grant        none
// @run-at       document-start
// @downloadURL  https://github.com/Wojtus421/autoq/raw/refs/heads/main/autoq.user.js
// @updateURL    https://github.com/Wojtus421/autoq/raw/refs/heads/main/autoq.user.js
// ==/UserScript==

// Ten plik to tylko loader — właściwa logika AutoQ mieszka w autoq-bundle.js
// i jest wstrzykiwana na nowo przy KAŻDYM wejściu do gry (nie tylko wg cyklu
// aktualizacji Tampermonkey). ?v=Date.now() wymusza pominięcie cache
// przeglądarki, więc user zawsze dostaje najświeższy plik z repo.
//
// document.documentElement (a nie document.body) — przy @run-at
// document-start <body> może jeszcze nie istnieć, <html> istnieje zawsze.
(function () {
  'use strict';
  const s = document.createElement('script');
  s.src = 'https://github.com/Wojtus421/autoq/raw/refs/heads/main/autoq-bundle.js?v=' + Date.now();
  (document.head || document.documentElement).appendChild(s);
})();
