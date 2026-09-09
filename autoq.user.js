// ==UserScript==
// @name         AutoQ — Margonem auto quest
// @namespace    Wojtus
// @version      10.2
// @description  Loader: wstrzykuje najnowszy bundle AutoQ przy każdym wejściu (bez cyklu Tampermonkey)
// @match        https://*.margonem.pl/*
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/Wojtus421/autoq/main/autoq.user.js
// @updateURL    https://raw.githubusercontent.com/Wojtus421/autoq/main/autoq.user.js
// ==/UserScript==

// Ten plik to tylko loader — właściwa logika AutoQ mieszka w autoq-bundle.js
// i jest wstrzykiwana na nowo przy KAŻDYM wejściu do gry (nie tylko wg cyklu
// aktualizacji Tampermonkey). ?v=Date.now() wymusza pominięcie cache
// przeglądarki, więc user zawsze dostaje najświeższy plik z repo.
//
// GM_xmlhttpRequest zamiast zwykłego <script src="..."> — pobranie robione
// jest w kontekście rozszerzenia (poza CORS/CORB strony), a treść wklejamy
// jako inline <script>. Zwykły <script src="raw.githubusercontent.com/...">
// jest blokowany przez CORB, bo raw.githubusercontent.com serwuje pliki
// jako Content-Type: text/plain + nosniff, a nie application/javascript.
(function () {
  'use strict';
  GM_xmlhttpRequest({
    method: 'GET',
    url: 'https://raw.githubusercontent.com/Wojtus421/autoq/main/autoq-bundle.js?v=' + Date.now(),
    onload: function (res) {
      const s = document.createElement('script');
      s.textContent = res.responseText;
      (document.head || document.documentElement).appendChild(s);
    },
    onerror: function (err) {
      console.error('AutoQ loader: nie udało się pobrać bundla', err);
    }
  });
})();
