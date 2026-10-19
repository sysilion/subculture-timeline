'use strict';

const I18n = (() => {
  // 저장소가 막힌 환경(사생활 보호 모드 등)에서 getItem이 throw하면 IIFE가 통째로 실패해
  // 전역 I18n 선언이 초기화되지 않고, timeline.js의 typeof I18n 가드까지 ReferenceError를 낸다.
  let current = 'ko';
  try { current = localStorage.getItem('tl-lang') || 'ko'; } catch (e) {}
  let strings = {};

  async function load(lang) {
    const res = await fetch(`data/i18n/${lang}.json`);
    strings = await res.json();
    current = lang;
    try { localStorage.setItem('tl-lang', lang); } catch (e) {}
    apply();
    document.documentElement.lang = lang;
    document.dispatchEvent(new CustomEvent('tl-langchange', { detail: { lang } }));
  }

  function t(key) {
    return strings[key] || key;
  }

  function apply() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (strings[key]) el.textContent = strings[key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (strings[key]) el.placeholder = strings[key];
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
