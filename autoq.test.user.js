// ==UserScript==
// @name         AutoQ — Margonem auto quest [TESTING]
// @namespace    Wojtus
// @version      10.3-test
// @description  Loader: wstrzykuje bundle AutoQ z brancha testing (do testow przed merge do main)
// @match        https://*.margonem.pl/*
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @connect      api.github.com
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/Wojtus421/autoq/testing/autoq.test.user.js
// @updateURL    https://raw.githubusercontent.com/Wojtus421/autoq/testing/autoq.test.user.js
// ==/UserScript==

// Ten plik to tylko loader — właściwa logika AutoQ mieszka w autoq-bundle.js
// i jest wstrzykiwana na nowo przy KAŻDYM wejściu do gry (nie tylko wg cyklu
// aktualizacji Tampermonkey). ?v=Date.now() wymusza pominięcie cache.
//
// GM_xmlhttpRequest zamiast <script src="...">: raw.githubusercontent.com
// serwuje pliki jako text/plain + nosniff, więc zwykły <script src> blokuje
// CORB. Pobieramy treść w kontekście rozszerzenia i wklejamy jako inline.
//
// Loader przekazuje też bundlowi środowisko i datę ostatniej aktualizacji
// (window.__AUTOQ_META) — bundle sam tego nie wie, bo nie zna adresu,
// z którego przyszedł. Pokazywane w stopce panelu ustawień.
(function () {
  'use strict';
  const REPO = 'Wojtus421/autoq';
  const BRANCH = 'testing';
  const ENV = 'test';

  // Loader działa w sandboksie Tampermonkey — do kontekstu strony
  // docieramy wstrzykując inline <script>.
  const inject = code => {
    const s = document.createElement('script');
    s.textContent = code;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  };
  const setMeta = obj => inject('window.__AUTOQ_META = Object.assign(window.__AUTOQ_META || {}, ' +
    JSON.stringify(obj) + ');');

  setMeta({ env: ENV, branch: BRANCH });

  GM_xmlhttpRequest({
    method: 'GET',
    url: 'https://raw.githubusercontent.com/' + REPO + '/' + BRANCH + '/autoq-bundle.js?v=' + Date.now(),
    onload: function (res) { inject(res.responseText); },
    onerror: function (err) { console.error('AutoQ loader: nie udało się pobrać bundla', err); }
  });

  // Data ostatniego commita na branchu. Niezależne od bundla — jeśli GitHub
  // nie odpowie (np. limit 60 zapytań/h na IP), skrypt działa normalnie,
  // a w panelu pojawi się "brak danych".
  GM_xmlhttpRequest({
    method: 'GET',
    url: 'https://api.github.com/repos/' + REPO + '/commits/' + BRANCH,
    headers: { Accept: 'application/vnd.github+json' },
    onload: function (res) {
      try {
        const j = JSON.parse(res.responseText);
        const c = j && j.commit && (j.commit.committer || j.commit.author);
        if (res.status === 200 && c && c.date) setMeta({ commitDate: c.date, sha: j.sha });
        else setMeta({ commitError: 'HTTP ' + res.status });
      } catch (e) { setMeta({ commitError: 'parse' }); }
    },
    onerror: function () { setMeta({ commitError: 'network' }); }
  });
})();
