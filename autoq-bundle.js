(function () {
  'use strict';
  const banner = document.createElement('div');
  banner.textContent = '🟢 PLACEHOLDER DZIAŁA — v' + Date.now();
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;' +
    'background:#e91e63;color:#fff;font:bold 16px monospace;padding:10px;text-align:center;';
  document.documentElement.appendChild(banner);
  console.log('%c[PLACEHOLDER] bundle wczytany o ' + new Date().toLocaleTimeString(), 'color:#e91e63;font-weight:bold;font-size:14px');
})();
