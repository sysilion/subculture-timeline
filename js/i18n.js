'use strict';

const I18n = (() => {
  let current = localStorage.getItem('tl-lang') || 'ko';
  let strings = {};

  async function load(lang) {
    const res = await fetch(`data/i18n/${lang}.json`);
    strings = await res.json();
    current = lang;
    localStorage.setItem('tl-lang', lang);
    apply();
    document.documentElement.lang = lang;
  }

  function t(key) {
    return strings[key] || key;
  }

  function apply() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (strings[key]) el.textContent = strings[key];
    });
    // range option 텍스트 갱신
    const opts = strings.rangeOptions || {};
    document.querySelectorAll('#range-select option').forEach(opt => {
      if (opts[opt.value]) opt.textContent = opts[opt.value];
    });
    // 언어 버튼 active 상태
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === current);
    });
  }

  function setupButtons() {
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.addEventListener('click', () => load(btn.dataset.lang));
    });
  }

  async function init() {
    setupButtons();
    await load(current);
  }

  return { init, t, current: () => current };
})();
