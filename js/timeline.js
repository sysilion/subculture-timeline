/**
 * timeline.js — 타임라인 렌더링 엔진
 * 게임 데이터(games.json)를 받아 가로형 Gantt 타임라인을 DOM에 그린다.
 */

'use strict';

const Timeline = (() => {

  /* ── 설정 ── */
  const CFG = {
    dayPx: 28,           // 1일당 픽셀 (CSS --day-px와 동기화)
    pastDays: 30,        // 오늘 기준 과거 표시 일수
    futureDays: 60,      // 오늘 기준 미래 표시 일수
    rowH: 44,            // 행 높이 (레인이 하나일 때)
    laneH: 32,           // 겹친 일정을 나눠 담는 레인 높이
    rulerH: 52,          // 눈금자 높이
    labelW: 120,         // 게임 이름 컬럼 너비
  };

  /* ── 화면 폭별 치수 ──
     바 좌표를 JS가 계산하므로 CSS 미디어쿼리로 --day-px를 바꾸면 계산과 어긋난다.
     치수는 여기서 정하고 CSS 변수는 updateCSSVars()로 파생시킨다. */
  const METRICS = [
    { maxWidth: 600,      dayPx: 20, labelW: 76,  rowH: 38, laneH: 28 },
    { maxWidth: 1024,     dayPx: 24, labelW: 100, rowH: 42, laneH: 30 },
    { maxWidth: Infinity, dayPx: 28, labelW: 120, rowH: 44, laneH: 32 },
  ];

  /* ── 행 높이(밀도) ── 화면 폭 기준 치수에 배율을 곱한다 ── */
  const DENSITY = { compact: 0.72, normal: 1, roomy: 1.4 };
  let density = 'normal';
  try {
    const saved = localStorage.getItem('tl-density');
    if (saved && DENSITY[saved]) density = saved;
  } catch (e) {}

  function applyResponsiveMetrics() {
    const m = METRICS.find(x => window.innerWidth <= x.maxWidth);
    const k = DENSITY[density] || 1;
    const rowH  = Math.round(m.rowH * k);
    const laneH = Math.round(m.laneH * k);
    const changed = CFG.dayPx !== m.dayPx || CFG.labelW !== m.labelW
                 || CFG.rowH !== rowH || CFG.laneH !== laneH;
    CFG.dayPx = m.dayPx;
    CFG.labelW = m.labelW;
    CFG.rowH = rowH;
    CFG.laneH = laneH;
    return changed;
  }

  function setupDensityControl() {
    const sel = document.getElementById('density-select');
    if (!sel) return;
    sel.value = density;
    sel.addEventListener('change', () => {
      if (!DENSITY[sel.value]) return;
      density = sel.value;
      try { localStorage.setItem('tl-density', density); } catch (e) {}
      applyResponsiveMetrics();
      updateCSSVars();
      renderRuler();
      renderGames();
      renderTodayLine();
    });
  }

  let data = null;
  let today = null;

  // 바 엘리먼트 → { game, entry, key } (DOM에 JSON을 직렬화해 두지 않기 위한 참조 테이블)
  const barData  = new WeakMap();
  // 안정 키 → 바 엘리먼트 (상세 패널에서 O(1) 조회)
  const barIndex = new Map();
  let startDate = null;
  let totalDays = 0;

  /* ── 날짜 유틸 ── */
  const D = {
    parse(s) {
      const [y, m, d] = s.split('-').map(Number);
      return new Date(y, m - 1, d);
    },
    fmt(d) {
      return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
    },
    fmtShort(d) {
      return `${d.getMonth()+1}/${d.getDate()}`;
    },
    addDays(d, n) {
      const r = new Date(d);
      r.setDate(r.getDate() + n);
      return r;
    },
    diffDays(a, b) {
      return Math.round((b - a) / 86400000);
    },
    monthName(d) {
      const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return names[d.getMonth()];
    },
    monthNameKo(d) {
      return `${d.getFullYear()}년 ${d.getMonth()+1}월`;
    },
  };

  /* ── 날짜 → X픽셀 (ruler-dates 기준) ── */
  function dateToX(date) {
    const diff = D.diffDays(startDate, date);
    return diff * CFG.dayPx;
  }

  /* ── 초기화 ── */
  async function init() {
    // 스켈레톤 표시
    const skeleton = document.getElementById('skeleton-container');
    if (skeleton) skeleton.classList.remove('hidden');

    try {
      const res = await fetch('data/games.json');
      data = await res.json();
    } catch (e) {
      console.error('games.json 로드 실패:', e);
      if (skeleton) skeleton.classList.add('hidden');
      return;
    }

    applyResponsiveMetrics();

    // 오늘 날짜 (시간 제거)
    today = new Date();
    today.setHours(0, 0, 0, 0);

    // 표시 범위
    startDate = D.addDays(today, -CFG.pastDays);
    totalDays = CFG.pastDays + CFG.futureDays + 1;

    // 마지막 업데이트 표시
    const luEl = document.getElementById('last-updated');
    if (luEl && data.meta) {
      const prefix = (typeof I18n !== 'undefined') ? I18n.t('dataUpdated') : '데이터 기준:';
      luEl.textContent = `${prefix} ${data.meta.lastUpdated}`;
    }

    applyHashState();
    restoreOrder();
    buildFilters();
    applyHashFilters();
    setupSearch();
    setupBulkFilters();
    renderRuler();
    renderGames();
    renderTodayLine();
    setupTooltip();
    setupSortable();
    setupDetailPanel();
    setupEntryModal();
    setupDensityControl();
    setupViewToggle();
    setupTodayButton();
    setupIcsExport();
    updateCSSVars();
    scrollToToday(false);

    // 렌더 완료 후 스켈레톤 숨김
    if (skeleton) {
      skeleton.classList.add('hidden');
      setTimeout(() => { skeleton.style.display = 'none'; }, 300);
    }

    // 화면 폭이 바뀌면 치수를 다시 정하고 그릴 때만 재렌더한다
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!applyResponsiveMetrics()) return;
        updateCSSVars();
        renderRuler();
        renderGames();
        renderTodayLine();
        if (currentView === 'list') renderListView();
      }, 150);
    });

    // 언어 전환 시 렌더 텍스트 갱신 (행 레이블·오늘선·리스트 뷰)
    document.addEventListener('tl-langchange', () => {
      buildFilters();   // 칩 이름도 언어를 따라간다
      restoreFilters();
      renderGames();
      renderTodayLine();
      if (currentView === 'list') renderListView();
    });
  }

  /* ── 해시의 hide= 필터를 1회 적용 후 localStorage에 반영 ── */
  function applyHashFilters() {
    if (!hashHiddenGames) return;
    document.querySelectorAll('.game-chip').forEach(chip => {
      const active = !hashHiddenGames.has(chip.dataset.gameId);
      chip.classList.toggle('active', active);
      chip.classList.toggle('inactive', !active);
    });
    saveFilters();
    hashHiddenGames = null;
  }

  /* ── CSS 변수 갱신 ── */
  function updateCSSVars() {
    const root = document.documentElement;
    root.style.setProperty('--day-px', CFG.dayPx + 'px');
    root.style.setProperty('--label-w', CFG.labelW + 'px');
    root.style.setProperty('--row-h', CFG.rowH + 'px');
    root.style.setProperty('--lane-h', CFG.laneH + 'px');
    // 레인이 좁아지면 바도 같이 줄어야 넘치지 않는다
    root.style.setProperty('--bar-h', Math.min(28, CFG.laneH - 4) + 'px');
    root.style.setProperty('--ruler-h', CFG.rulerH + 'px');
  }

  /* ── 날짜 범위 변경 ── */
  function setRange(pastDays, futureDays) {
    CFG.pastDays = pastDays;
    CFG.futureDays = futureDays;
    startDate = D.addDays(today, -CFG.pastDays);
    totalDays = CFG.pastDays + CFG.futureDays + 1;
    renderRuler();
    renderGames();
    renderTodayLine();
    restoreFilters();
    if (currentView === 'list') renderListView();
    updateHash();
  }

  /* ── i18n 헬퍼 (미로드 시 fallback) ── */
  function t(key, fallback) {
    if (typeof I18n !== 'undefined') {
      const v = I18n.t(key);
      if (v !== key) return v;
    }
    return fallback;
  }

  /* ── HTML 이스케이프 (파서가 외부 사이트에서 수집한 문자열 무해화) ── */
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ── 언어별 게임 이름 (nameEn/nameKo가 없으면 name으로 폴백) ── */
  function curLang() {
    return (typeof I18n !== 'undefined') ? I18n.current() : 'ko';
  }

  function gameName(game) {
    return curLang() === 'en'
      ? (game.nameEn || game.name)
      : (game.nameKo || game.name);
  }

  function gameFullName(game) {
    return curLang() === 'en'
      ? (game.nameEn || game.fullName || game.name)
      : (game.fullName || game.name);
  }

  /* ── 화면에 그리는 일정 종류 ──
     버전 기간은 배너·이벤트와 축이 달라 행만 차지해 제외한다.
     데이터에는 남겨 두고 표시만 하지 않는다. */
  const VISIBLE_TYPES = new Set(['banner', 'event']);

  function visibleEntries(game) {
    return (game.entries || []).filter(e => VISIBLE_TYPES.has(e.type));
  }

  /* ── 엔트리 안정 키 — 재렌더·언어 전환에도 동일하게 유지된다 ── */
  function entryKey(game, entry) {
    return entry.id || `${game.id}|${entry.type}|${entry.start}|${entry.end}|${entry.title}`;
  }

  /* ── URL 해시 상태 (뷰·범위·숨긴 게임 공유) ── */
  let hashHiddenGames = null; // 최초 로드 시 해시의 hide= 값 (1회 적용 후 해제)

  function applyHashState() {
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.get('view') === 'list') currentView = 'list';
    const range = (params.get('range') || '').split(',').map(Number);
    if (range.length === 2 && range[0] > 0 && range[1] > 0) {
      CFG.pastDays = range[0];
      CFG.futureDays = range[1];
      const sel = document.getElementById('range-select');
      if (sel && [...sel.options].some(o => o.value === `${range[0]},${range[1]}`)) {
        sel.value = `${range[0]},${range[1]}`;
      }
    }
    const hide = params.get('hide');
    if (hide) hashHiddenGames = new Set(hide.split(','));
  }

  function updateHash() {
    const params = new URLSearchParams();
    if (currentView !== 'gantt') params.set('view', currentView);
    if (CFG.pastDays !== 30 || CFG.futureDays !== 60) {
      params.set('range', `${CFG.pastDays},${CFG.futureDays}`);
    }
    const hidden = [...document.querySelectorAll('.game-chip.inactive')]
      .map(c => c.dataset.gameId);
    if (hidden.length) params.set('hide', hidden.join(','));
    const s = params.toString();
    history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
  }

  /* ── 필터 (게임 on/off) ── */
function buildFilters() {
  const bar = document.getElementById('filter-bar');
  // 필터 라벨 유지, 칩만 초기화
  const existing = bar.querySelectorAll('.game-chip');
  existing.forEach(el => el.remove());

  data.games.forEach(game => {
    const chip = document.createElement('button');
    chip.className = 'game-chip active';
    chip.dataset.gameId = game.id;
    chip.style.setProperty('--chip-color', game.color);

    const iconHtml = game.iconUrl
      ? `<img class="chip-icon-img" src="${esc(game.iconUrl)}" alt="${esc(gameName(game))}" onerror="this.style.display='none'">`
      : `<span class="chip-icon">${esc(game.icon)}</span>`;

    const entryCount = visibleEntries(game).length;
    chip.innerHTML = `${iconHtml}<span class="chip-name">${esc(gameName(game))}</span><span class="chip-count">${entryCount}</span>`;
    chip.addEventListener('click', () => toggleGame(game.id, chip));
    bar.appendChild(chip);
  });

  // 칩 재구성 후 현재 검색어 재적용
  applySearch(document.getElementById('game-search').value);
}

/* ── 게임 검색 (칩 + 타임라인 행 + 리스트 뷰 연동) ── */
let searchTerm = '';

function gameMatchesSearch(game) {
  if (!searchTerm) return true;
  return [game.nameKo, game.nameEn, game.name, game.fullName]
    .some(n => n && n.toLowerCase().includes(searchTerm));
}

function applySearch(term) {
  searchTerm = term.trim().toLowerCase();
  data.games.forEach(game => {
    const match = gameMatchesSearch(game);
    const chip = document.querySelector(`.game-chip[data-game-id="${game.id}"]`);
    if (chip) chip.style.display = match ? 'inline-flex' : 'none';
    const section = document.querySelector(`.game-section[data-id="${game.id}"]`);
    if (section) section.classList.toggle('search-hidden', !match);
  });
  if (currentView === 'list') renderListView();
}

function setupSearch() {
  const searchInput = document.getElementById('game-search');
  const clearButton = document.getElementById('clear-search');

  searchInput.addEventListener('input', () => applySearch(searchInput.value));

  clearButton.addEventListener('click', () => {
    searchInput.value = '';
    applySearch('');
    searchInput.focus();
  });
}

/* ── 필터 전체 켜기/끄기 ── */
function setAllGames(active) {
  document.querySelectorAll('.game-chip').forEach(chip => {
    chip.classList.toggle('active', active);
    chip.classList.toggle('inactive', !active);
    const section = document.querySelector(`.game-section[data-id="${chip.dataset.gameId}"]`);
    if (section) section.classList.toggle('hidden', !active);
  });
  saveFilters();
  updateHash();
  if (currentView === 'list') renderListView();
}

function setupBulkFilters() {
  document.getElementById('filter-all').addEventListener('click', () => setAllGames(true));
  document.getElementById('filter-none').addEventListener('click', () => setAllGames(false));
}

  function toggleGame(id, chip) {
    const section = document.querySelector(`.game-section[data-id="${id}"]`);
    if (!section) return;
    const isActive = chip.classList.contains('active');
    chip.classList.toggle('active', !isActive);
    chip.classList.toggle('inactive', isActive);
    section.classList.toggle('hidden', isActive);
    saveFilters();
    updateHash();
    if (currentView === 'list') renderListView();
  }

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  toast.textContent = message;
  toast.style.position = 'fixed';
  toast.style.bottom = '20px';
  toast.style.right = '20px';
  toast.style.background = 'var(--surface2)';
  toast.style.color = 'var(--text)';
  toast.style.padding = '10px 16px';
  toast.style.borderRadius = '4px';
  toast.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
  toast.style.zIndex = '1000';
  toast.style.fontSize = '12px';
  toast.style.opacity = '0';
  toast.style.transition = 'opacity 0.3s';
  document.body.appendChild(toast);

  // 애니메이션 트리거
  setTimeout(() => {
    toast.style.opacity = '1';
  }, 10);

  // 3초 후 제거
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3000);
}

function saveFilters() {
  const state = {};
  document.querySelectorAll('.game-chip').forEach(c => {
    state[c.dataset.gameId] = c.classList.contains('active');
  });
  try {
    localStorage.setItem('tl-filters', JSON.stringify(state));
  } catch(e) {
    console.error('Failed to save filters:', e);
    showToast('필터 저장 실패: 로컬 스토리지 접근 불가');
  }
}

  function restoreFilters() {
    let state = null;
    try { state = JSON.parse(localStorage.getItem('tl-filters')); } catch(e) {}
    if (!state) return;
    document.querySelectorAll('.game-chip').forEach(chip => {
      const id = chip.dataset.gameId;
      if (id in state) {
        const active = state[id];
        chip.classList.toggle('active', active);
        chip.classList.toggle('inactive', !active);
        const section = document.querySelector(`.game-section[data-id="${id}"]`);
        if (section) section.classList.toggle('hidden', !active);
      }
    });
  }

  /* ── 날짜 눈금자 렌더링 ── */
  function renderRuler() {
    const rulerDates = document.getElementById('ruler-dates');
    const canvas = document.getElementById('timeline-canvas');
    const gameRowsEl = document.getElementById('game-rows');

    const totalW = totalDays * CFG.dayPx;
    rulerDates.style.width = totalW + 'px';
    canvas.style.width = (CFG.labelW + totalW) + 'px';

    rulerDates.innerHTML = '';

    // 격자선 컨테이너 초기화
    let gridContainer = document.getElementById('grid-lines');
    if (!gridContainer) {
      gridContainer = document.createElement('div');
      gridContainer.id = 'grid-lines';
      gridContainer.style.cssText = 'position:absolute;top:0;left:0;bottom:0;width:100%;pointer-events:none;';
      gameRowsEl.appendChild(gridContainer);
    }
    gridContainer.innerHTML = '';

    const seenMonths = new Set();

    for (let i = 0; i <= totalDays; i++) {
      const d = D.addDays(startDate, i);
      const x = i * CFG.dayPx;
      const dow = d.getDay();
      const dom = d.getDate();

      // 월 표시 (1일 또는 첫날)
      if (dom === 1 || i === 0) {
        const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
        if (!seenMonths.has(monthKey)) {
          seenMonths.add(monthKey);
          const monthEl = document.createElement('div');
          monthEl.className = 'ruler-month';
          monthEl.style.left = x + 'px';
          monthEl.textContent = D.monthNameKo(d);
          rulerDates.appendChild(monthEl);

          // 월 경계 격자선
          if (i > 0) {
            const gline = document.createElement('div');
            gline.className = 'grid-line month-line';
            gline.style.left = (CFG.labelW + x) + 'px';
            gridContainer.appendChild(gline);
          }
        }
      }

      // 주 눈금 (월요일 or 7일 간격)
      if (dow === 1) {
        const tick = document.createElement('div');
        tick.className = 'ruler-week-tick';
        tick.style.left = x + 'px';
        rulerDates.appendChild(tick);

        const label = document.createElement('div');
        label.className = 'ruler-day';
        label.style.left = x + 'px';
        const isToday = D.diffDays(today, d) === 0;
        if (isToday) label.classList.add('today-label');
        label.textContent = D.fmtShort(d);
        rulerDates.appendChild(label);

        // 주 격자선
        const gline = document.createElement('div');
        gline.className = 'grid-line';
        gline.style.left = (CFG.labelW + x) + 'px';
        gridContainer.appendChild(gline);
      }
    }
  }

  /* ── 게임 행 렌더링 ── */
  function renderGames() {
    const container = document.getElementById('game-rows');
    // 기존 섹션 제거 (grid-lines 제외)
    container.querySelectorAll('.game-section').forEach(el => el.remove());

    // 이전 렌더의 바 참조·툴팁 캐시 폐기 (누적되면 메모리 누수)
    barIndex.clear();
    tooltipCache.clear();

    if (!data) return;

    data.games.forEach(game => {
      const section = buildGameSection(game);
      container.appendChild(section);
    });

    restoreFilters();
    applySearch(document.getElementById('game-search').value);
  }

  function buildGameSection(game) {
    const section = document.createElement('div');
    section.className = 'game-section';
    section.dataset.id = game.id;

    // 타입별 분리 (버전 기간은 표시하지 않는다)
    const banners = game.entries.filter(e => e.type === 'banner');
    const events  = game.entries.filter(e => e.type === 'event');

    const rows = [];
    if (banners.length > 0) rows.push({ kind: 'banners', items: banners });
    if (events.length > 0)  rows.push({ kind: 'events',  items: events });

    // 겹치는 일정을 레인으로 나누고, 그 결과로 행·라벨 높이를 정한다
    rows.forEach(r => {
      r.lanes = packLanes(r.items);
      r.laneH = r.lanes.length > 1 ? CFG.laneH : CFG.rowH;
      r.height = Math.max(r.lanes.length, 1) * r.laneH;
    });
    const totalHeight = rows.reduce((sum, r) => sum + r.height, 0) || CFG.rowH;

    // 게임 라벨 (첫 행만 sticky, rowspan은 CSS로 처리)
    const headerRow = document.createElement('div');
    headerRow.className = 'game-header-row';

    const label = document.createElement('div');
    label.className = 'game-label';
    label.tabIndex = 0;
    label.setAttribute('role', 'button');
    label.setAttribute('aria-label', `${gameName(game)} ${t('detailHint', '상세보기')}`);
    label.style.borderLeft = `3px solid ${game.color}`;
    label.style.height = totalHeight + 'px';

    // 배경 이미지
    if (game.bgUrl) {
      label.style.backgroundImage = `url("${game.bgUrl}")`;
      label.style.backgroundSize = 'cover';
      label.style.backgroundPosition = 'center';
    } else {
      // bgUrl 없으면 게임 색상 그라디언트
      label.style.background = `linear-gradient(135deg, ${game.color}33, var(--surface))`;
    }

    const iconHtml = game.iconUrl
      ? `<img class="game-label-icon-img" src="${esc(game.iconUrl)}" alt="${esc(game.name)}" onerror="this.remove()">`
      : '';

    label.innerHTML = `
      <div class="game-label-overlay"></div>
      <div class="game-label-drag" title="${esc(t('dragHint', '드래그하여 순서 변경'))}"></div>
      ${iconHtml}
      <div class="game-label-content">
        <div class="game-label-name">${esc(gameName(game))}</div>
        <div class="game-label-dev">${esc(game.developer)}</div>
      </div>
      <div class="game-label-hint">${esc(t('detailHint', '상세보기'))}</div>
    `;

    const entriesWrapper = document.createElement('div');
    entriesWrapper.className = 'game-entries';
    entriesWrapper.style.width = (totalDays * CFG.dayPx) + 'px';
    entriesWrapper.style.minHeight = totalHeight + 'px';

    rows.forEach(rowGroup => {
      const rowEl = document.createElement('div');
      rowEl.className = `entry-row entry-row-${rowGroup.kind}`;
      rowEl.style.height = rowGroup.height + 'px';

      // 행 타입 레이블
      const labelText = rowGroup.kind === 'versions' ? t('rowVersions', '버전')
        : rowGroup.kind === 'banners' ? t('rowBanners', '배너') : t('rowEvents', '이벤트');
      const label = document.createElement('div');
      label.className = `entry-row-label label-${rowGroup.kind}`;
      label.textContent = labelText;
      rowEl.appendChild(label);

      rowGroup.lanes.forEach(laneItems => {
        const laneEl = document.createElement('div');
        laneEl.className = 'entry-lane';
        laneEl.style.height = rowGroup.laneH + 'px';
        laneItems.forEach(entry => {
          const bar = buildBar(entry, game);
          if (bar) laneEl.appendChild(bar);
        });
        rowEl.appendChild(laneEl);
      });

      entriesWrapper.appendChild(rowEl);
    });

    headerRow.appendChild(label);
    headerRow.appendChild(entriesWrapper);
    section.appendChild(headerRow);

    return section;
  }

/* ── 바의 x·너비 계산 (표시 범위 밖이면 null) ── */
function barGeometry(entry) {
  const entryStart = D.parse(entry.start);
  const entryEnd   = D.parse(entry.end);
  const rangeEnd   = D.addDays(startDate, totalDays);

  if (entryEnd <= startDate || entryStart >= rangeEnd) return null;

  const clippedStart = entryStart < startDate ? startDate : entryStart;
  const clippedEnd   = entryEnd > rangeEnd ? rangeEnd : entryEnd;

  return {
    x: dateToX(clippedStart),
    w: Math.max(4, D.diffDays(clippedStart, clippedEnd) * CFG.dayPx),
  };
}

/* ── 겹치는 일정을 레인으로 분배 ──
   한 행에 몰아 그리면 서로 가려 제목도 못 읽고 클릭도 위쪽 바가 가로챈다. */
const LANE_GAP = 6;    // 인접한 바 사이 최소 간격(px)
const MAX_LANES = 24;  // 극단적인 데이터에서 행이 끝없이 높아지지 않도록 둔 상한

function packLanes(items) {
  const placed = items
    .map(entry => ({ entry, geo: barGeometry(entry) }))
    .filter(o => o.geo)
    .sort((a, b) => a.geo.x - b.geo.x || a.geo.w - b.geo.w);

  const lanes = [];
  for (const o of placed) {
    let lane = lanes.find(l => o.geo.x >= l.end + LANE_GAP);
    if (!lane) {
      if (lanes.length >= MAX_LANES) {
        // 상한을 넘으면 가장 일찍 비는 레인에 얹는다 (이 경우만 겹침을 허용)
        lane = lanes.reduce((a, b) => (a.end <= b.end ? a : b));
      } else {
        lane = { end: -Infinity, items: [] };
        lanes.push(lane);
      }
    }
    lane.items.push(o.entry);
    lane.end = Math.max(lane.end, o.geo.x + o.geo.w);
  }
  return lanes.map(l => l.items);
}

function buildBar(entry, game) {
  const geo = barGeometry(entry);
  if (!geo) return null;
  const { x, w } = geo;

  const bar = document.createElement('div');
  bar.className = `entry-bar type-${entry.type}`;
  if (entry.tentative) bar.classList.add('tentative');
  // 지난 일정은 흐리게 — 진행 중인 일정이 먼저 눈에 들어와야 한다
  if (D.parse(entry.end) < today) bar.classList.add('is-ended');

  bar.style.left  = x + 'px';
  bar.style.width = w + 'px';

  if (entry.type === 'version') {
    bar.style.borderColor = game.color;
    bar.style.color = game.color;
  } else if (entry.type === 'event') {
    bar.style.backgroundColor = game.color;
  } else {
    bar.style.background = game.color;
  }

  // 텍스트 (너비가 충분할 때만)
  if (w > 32) {
    const textEl = document.createElement('div');
    textEl.className = 'bar-text';
    if (entry.type === 'version') {
      textEl.textContent = entry.title;
    } else {
      textEl.innerHTML = `${esc(entry.title)}${entry.subtitle ? `<span class="bar-subtitle">${esc(entry.subtitle)}</span>` : ''}`;
    }
    // version이 없을 경우 텍스트 렌더링 생략
    if (entry.type !== 'version' || entry.version) {
      bar.appendChild(textEl);
    }
  }

  // 툴팁·하이라이트용 참조 — DOM에 JSON을 직렬화해 두지 않는다
  const key = entryKey(game, entry);
  barData.set(bar, { game, entry, key });
  barIndex.set(key, bar);

  // 340개 바가 모두 탭 대상이면 키보드로 푸터까지 가는 데 수백 번이 걸린다.
  // 바는 탭 순서에서 빼고(프로그램적 포커스는 가능) 목록 탐색은 상세 패널이 맡는다.
  bar.tabIndex = -1;
  bar.setAttribute('aria-label',
    `${gameName(game)} — ${entry.title} (${entry.start} ~ ${entry.end})`);

  return bar;
}

  /* ── 오늘 세로선 ── */
  function renderTodayLine() {
    let line = document.getElementById('today-line');
    if (!line) {
      line = document.createElement('div');
      line.id = 'today-line';
      document.getElementById('game-rows').appendChild(line);
    }
    const x = CFG.labelW + dateToX(today);
    line.style.left = x + 'px';
    line.dataset.label = t('legendToday', '오늘');
  }

  /* ── 툴팁 ── */
  // AbortController를 사용하여 이벤트 리스너 중복 방지
  let tooltipController = null;
  // 툴팁 내용 캐시 (entry.id → HTML 문자열) — IIFE 스코프에서 공유
  const tooltipCache = new Map();

  function setupTooltip() {
    if (tooltipController) tooltipController.abort();
    tooltipController = new AbortController();
    const { signal } = tooltipController;

    const tooltip = document.getElementById('tooltip');
    const scroll  = document.getElementById('timeline-scroll');

    let currentBar = null;
    let hoverDelayTimer = null;
    let pendingBar = null;
    const HOVER_DELAY = 200; // ms

    let rafId = null;

    // ── requestAnimationFrame 쓰로틀 ──
    // 이벤트 객체는 재사용될 수 있으므로 좌표만 복사해 둔다
    const lastPos = { clientX: 0, clientY: 0 };
    function schedulePositionUpdate() {
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          if (tooltip.classList.contains('visible')) {
            positionTooltip(tooltip, lastPos);
          }
        });
      }
    }

    function showDelayed(bar) {
      if (bar === currentBar) return;
      clearTimeout(hoverDelayTimer);
      pendingBar = bar;
      hoverDelayTimer = setTimeout(() => {
        currentBar = pendingBar;
        pendingBar = null;
        // 좌표를 넘기지 않으면 positionTooltip에서 TypeError가 난다
        showTooltip(bar, tooltip, lastPos);
      }, HOVER_DELAY);
    }

    function hideTooltip() {
      clearTimeout(hoverDelayTimer);
      pendingBar = null;
      currentBar = null;
      tooltip.classList.remove('visible');
    }

    // 마우스 이벤트 리스너
    scroll.addEventListener('mouseover', (e) => {
      const bar = e.target.closest('.entry-bar');
      if (!bar || !barData.has(bar)) return;
      lastPos.clientX = e.clientX;
      lastPos.clientY = e.clientY;
      showDelayed(bar);
    }, { signal });

    scroll.addEventListener('mousemove', (e) => {
      // hover 딜레이 중에도 좌표를 최신으로 유지해야 첫 표시 위치가 맞는다
      lastPos.clientX = e.clientX;
      lastPos.clientY = e.clientY;
      if (!tooltip.classList.contains('visible')) return;
      schedulePositionUpdate();
    }, { signal });

    scroll.addEventListener('mouseout', (e) => {
      const bar = e.target.closest('.entry-bar');
      if (bar && (bar === currentBar || bar === pendingBar)) {
        const related = e.relatedTarget;
        if (!related || !related.closest('.entry-bar')) {
          hideTooltip();
        }
      }
    }, { signal });

    document.addEventListener('mouseleave', hideTooltip, { signal });

    // 키보드 접근성: 포커스 이동 시 툴팁 즉시 표시 (딜레이 없음)
    document.addEventListener('focusin', (e) => {
      const bar = e.target.closest ? e.target.closest('.entry-bar') : null;
      if (bar && barData.has(bar)) {
        clearTimeout(hoverDelayTimer);
        pendingBar = null;
        currentBar = bar;
        const rect = bar.getBoundingClientRect();
        showTooltip(bar, tooltip, {
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2
        });
      }
    }, { signal });

    document.addEventListener('focusout', (e) => {
      if (!e.relatedTarget || !e.relatedTarget.closest('.entry-bar')) {
        hideTooltip();
      }
    }, { signal });

    // 바를 누르면 상세를 연다 (마우스·터치 공통)
    scroll.addEventListener('click', (e) => {
      const bar = e.target.closest('.entry-bar');
      if (!bar) return;
      const rec = barData.get(bar);
      if (!rec) return;
      hideTooltip();
      openEntryModal(rec.game, rec.entry);
    }, { signal });
  }
  function showTooltip(bar, tooltip, e) {
    const rec = barData.get(bar);
    if (!rec) return;
    const { game, entry, key } = rec;

    // 캐시를 언어별로 분리 — 언어 전환 후 이전 언어 툴팁이 남는 것을 막는다
    const cacheKey = `${key}|${curLang()}`;
    const cached = tooltipCache.get(cacheKey);
    if (cached) {
      tooltip.innerHTML = cached;
    } else {
      const start = D.parse(entry.start);
      const end   = D.parse(entry.end);
      const dur   = D.diffDays(start, end);

      const status = entryStatus(start, end);
      const icon = status.cls === 'status-ended' ? '⏹' : status.cls === 'status-upcoming' ? '🔜' : '▶';
      const statusText = `<div class="tooltip-duration"${status.cls === 'status-active' ? ' style="color:#66bb6a"' : ''}>${icon} ${esc(status.label)}</div>`;

      const html = `
        <div class="tooltip-inner">
          <div class="tooltip-game">
            <span class="tooltip-color-dot" style="background:${esc(game.color)}"></span>
            ${esc(game.icon)} ${esc(gameFullName(game))}
          </div>
          <div class="tooltip-title">${esc(entry.title)}</div>
          ${entry.subtitle ? `<div class="tooltip-subtitle">${esc(entry.subtitle)}</div>` : ''}
          <div class="tooltip-dates">
            <div><span>${esc(t('tooltipStart', '시작:'))}</span> ${D.fmt(start)}</div>
            <div><span>${esc(t('tooltipEnd', '종료:'))}</span> ${D.fmt(end)}</div>
          </div>
          ${statusText}
          <div class="tooltip-duration">${esc(t('tooltipDuration', '기간'))}: ${esc(fmtDuration(dur))} · v${esc(entry.version || '?')}</div>
          ${entry.tentative ? `<div class="tooltip-tentative">${esc(t('tooltipTentative', '⚠ 미확정 일정 (변동 가능)'))}</div>` : ''}
          ${entry.source ? `<div class="tooltip-source">${esc(t('tooltipSource', '출처:'))} ${esc(entry.source)}</div>` : ''}
        </div>
      `;
      tooltipCache.set(cacheKey, html);
      tooltip.innerHTML = html;
    }

    tooltip.classList.add('visible');
    positionTooltip(tooltip, e);
  }

  function positionTooltip(tooltip, e) {
    const margin = 12;
    const tw = tooltip.offsetWidth || 280;
    const th = tooltip.offsetHeight || 160;
    let x = e.clientX + margin;
    let y = e.clientY + margin;
    if (x + tw > window.innerWidth  - margin) x = e.clientX - tw - margin;
    if (y + th > window.innerHeight - margin) y = e.clientY - th - margin;
    tooltip.style.left = x + 'px';
    tooltip.style.top  = y + 'px';
  }

  /* ── 날짜 범위 드롭다운 ── */
  function setupRangeControl() {
    const sel = document.getElementById('range-select');
    if (!sel) return;
    sel.addEventListener('change', () => {
      const [p, f] = sel.value.split(',').map(Number);
      setRange(p, f);
    });
  }

  /* ── Sortable 드래그 (게임 순서 변경) ── */
  function setupSortable() {
    if (typeof Sortable === 'undefined') return;
    const container = document.getElementById('game-rows');
    Sortable.create(container, {
      draggable: '.game-section',
      handle: '.game-label-drag',
      ghostClass: 'sortable-ghost',
      dragClass: 'sortable-drag',
      animation: 150,
      onEnd(evt) {
        // data.games 배열 순서 동기화
        const newOrder = [...container.querySelectorAll('.game-section[data-id]')]
          .map(el => el.dataset.id);
        data.games.sort((a, b) => newOrder.indexOf(a.id) - newOrder.indexOf(b.id));
        // 필터 칩도 순서 맞추기
        buildFilters();
        restoreFilters();
        saveOrder(newOrder);
      }
    });
  }

function saveOrder(order) {
  try {
    localStorage.setItem('tl-order', JSON.stringify(order));
  } catch(e) {
    console.error('Failed to save order:', e);
    showToast('순서 저장 실패: 로컬 스토리지 접근 불가');
  }
}

  function restoreOrder() {
    let order;
    try { order = JSON.parse(localStorage.getItem('tl-order')); } catch(e) {}
    if (!order || !order.length) return;
    data.games.sort((a, b) => {
      const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }

  /* ── 게임 상세 패널 ── */
  let currentDetailGame = null;
  let lastFocusedBeforeDetail = null;

function openDetail(game) {
  currentDetailGame = game;
  const panel = document.getElementById('detail-panel');
  const overlay = document.getElementById('detail-overlay');
  const titleEl = panel.querySelector('.detail-panel-title');
  const content = document.getElementById('detail-panel-content');

  const iconHtml = game.iconUrl
    ? `<img src="${esc(game.iconUrl)}" alt="${esc(game.name)}" style="width:20px;height:20px;border-radius:4px;object-fit:contain;">`
    : esc(game.icon || '');
  titleEl.innerHTML = `<span class="detail-modal-icon">${iconHtml}</span>${esc(gameFullName(game))}`;

  content.innerHTML = '';

  // 타입 순서: version → banner → event, 같은 타입 내 시작일 오름차순
  const typeOrder = { version: 0, banner: 1, event: 2 };
  const sorted = visibleEntries(game).sort((a, b) => {
    const ta = typeOrder[a.type] ?? 9;
    const tb = typeOrder[b.type] ?? 9;
    if (ta !== tb) return ta - tb;
    const byStart = a.start.localeCompare(b.start);
    return byStart !== 0 ? byStart : a.end.localeCompare(b.end);
  });

  let lastType = null;
  // 아직 끝나지 않은 첫 항목 — 패널을 열었을 때 여기가 보이도록 스크롤한다
  let firstCurrent = null;
  sorted.forEach(entry => {
    const start = D.parse(entry.start);
    const end = D.parse(entry.end);
    const dur = D.diffDays(start, end);

    const status = entryStatus(start, end);

    // 타입 구분선
    if (entry.type !== lastType) {
      const sep = document.createElement('div');
      const typeLabel = entry.type === 'version' ? t('rowVersions', '버전')
        : entry.type === 'banner' ? t('legendBanner', '뽑기 배너') : t('rowEvents', '이벤트');
      sep.className = `detail-type-sep sep-${entry.type}`;
      sep.textContent = typeLabel;
      content.appendChild(sep);
      lastType = entry.type;
    }

    const item = document.createElement('div');
    item.className = `detail-entry detail-entry-${entry.type}`;
    item.tabIndex = 0;
    item.dataset.entryId = entryKey(game, entry);
    item.innerHTML = `
      <div class="detail-entry-bar-indicator type-${entry.type}${entry.tentative ? ' tentative' : ''}"></div>
      <div class="detail-entry-main">
        <div class="detail-entry-title-row">
          <span class="detail-entry-title">${esc(entry.title)}</span>
          ${entry.tentative ? `<span class="detail-entry-tentative-badge">⚠ ${esc(t('legendTentative', '미확정'))}</span>` : ''}
        </div>
        ${entry.subtitle ? `<div class="detail-entry-subtitle">${esc(entry.subtitle)}</div>` : ''}
      </div>
      <div class="detail-entry-dates">
        <span class="detail-date-range">${D.fmtShort(start)} → ${D.fmtShort(end)}</span>
        <span class="detail-date-dur">${esc(fmtDuration(dur))}${entry.version ? ` · v${esc(entry.version)}` : ''}</span>
      </div>
      <div class="detail-entry-status ${status.cls}">${esc(status.label)}</div>
    `;
    content.appendChild(item);

    if (!firstCurrent && end >= today) firstCurrent = item;
  });

  // 시작일 오름차순이라 과거 항목이 위에 쌓인다.
  // 오늘 진행 중인(또는 다음에 올) 항목이 첫 화면에 오도록 맞춘다.
  scrollDetailToToday(content, firstCurrent);

  panel.classList.add('open');
  overlay.classList.add('open');

  // 포커스 관리: 열릴 때 닫기 버튼으로 이동, 닫힐 때 복원
  lastFocusedBeforeDetail = document.activeElement;
  document.getElementById('detail-panel-close').focus();

  // 상세 패널에서 타임라인 동기화
  document.querySelectorAll('.detail-entry').forEach(entryEl => {
    entryEl.addEventListener('click', () => {
      highlightTimelineEntry(entryEl.dataset.entryId);
    });
  });
}

/* ── 개별 일정 상세 모달 ── */
let lastFocusedBeforeEntry = null;

function safeUrl(u) {
  return (typeof u === 'string' && /^https:\/\//.test(u)) ? u : '';
}

function openEntryModal(game, entry) {
  const modal   = document.getElementById('entry-modal');
  const overlay = document.getElementById('entry-modal-overlay');
  const body    = document.getElementById('entry-modal-body');
  if (!modal || !entry) return;

  const start = D.parse(entry.start);
  const end   = D.parse(entry.end);
  const status = entryStatus(start, end);
  const typeLabel = entry.type === 'banner'
    ? t('legendBanner', '뽑기 배너') : t('legendEvent', '이벤트');

  const img = safeUrl(entry.image);
  const cover = img
    ? `<img class="entry-modal-cover" src="${esc(img)}" alt="" loading="lazy" onerror="this.remove()">`
    : '';
  const icon = game.iconUrl
    ? `<img src="${esc(game.iconUrl)}" alt="" onerror="this.remove()">`
    : `<span>${esc(game.icon || '')}</span>`;
  const link = safeUrl(entry.link);

  body.innerHTML = `
    ${cover}
    <div class="entry-modal-content">
      <div class="entry-modal-game">${icon}${esc(gameFullName(game))}</div>
      <div class="entry-modal-title" id="entry-modal-title">${esc(entry.title)}</div>
      ${entry.subtitle ? `<div class="entry-modal-subtitle">${esc(entry.subtitle)}</div>` : ''}
      <div class="entry-modal-badges">
        <span class="entry-modal-badge type-${esc(entry.type)}">${esc(typeLabel)}</span>
        <span class="entry-modal-badge ${status.cls}">${esc(status.label)}</span>
        ${entry.tentative
          ? `<span class="entry-modal-badge tentative">⚠ ${esc(t('legendTentative', '미확정'))}</span>`
          : ''}
      </div>
      <div class="entry-modal-dates">
        <div><span>${esc(t('tooltipStart', '시작:'))}</span> ${D.fmt(start)}</div>
        <div><span>${esc(t('tooltipEnd', '종료:'))}</span> ${D.fmt(end)}</div>
        <div><span>${esc(t('tooltipDuration', '기간'))}:</span> ${esc(fmtDuration(D.diffDays(start, end)))}</div>
      </div>
      ${entry.description ? `<div class="entry-modal-desc">${esc(entry.description)}</div>` : ''}
      <div class="entry-modal-links">
        ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(t('entryMoreInfo', '자세히 보기'))} ↗</a>` : ''}
        ${entry.source ? `<span class="entry-modal-source">${esc(t('tooltipSource', '출처:'))} ${esc(entry.source)}</span>` : ''}
      </div>
    </div>`;

  lastFocusedBeforeEntry = document.activeElement;
  modal.hidden = false;
  overlay.hidden = false;
  document.getElementById('entry-modal-close').focus();
}

function closeEntryModal() {
  const modal   = document.getElementById('entry-modal');
  const overlay = document.getElementById('entry-modal-overlay');
  if (!modal || modal.hidden) return false;
  modal.hidden = true;
  overlay.hidden = true;
  if (lastFocusedBeforeEntry && document.contains(lastFocusedBeforeEntry)) {
    lastFocusedBeforeEntry.focus();
  }
  lastFocusedBeforeEntry = null;
  return true;
}

function setupEntryModal() {
  document.getElementById('entry-modal-close')
    .addEventListener('click', closeEntryModal);
  document.getElementById('entry-modal-overlay')
    .addEventListener('click', closeEntryModal);
  // 게임 상세 패널의 ESC보다 먼저 잡도록 캡처 단계에서 듣는다
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && closeEntryModal()) e.stopPropagation();
  }, true);
}

/* ── 상세 패널을 오늘 위치로 맞춤 ── */
function scrollDetailToToday(content, target) {
  if (!target) {
    // 전부 지난 일정이면 가장 최근(맨 아래)을 보여준다
    content.scrollTop = content.scrollHeight;
    return;
  }
  // content와 항목이 같은 offsetParent를 공유하므로 그 차이가 곧 내부 오프셋이다
  // (transform이 걸린 패널에서도 getBoundingClientRect와 달리 영향받지 않는다)
  const sep = content.querySelector('.detail-type-sep');
  const stickyH = sep ? sep.offsetHeight : 0;
  content.scrollTop = Math.max(0, target.offsetTop - content.offsetTop - stickyH);
}

function highlightTimelineEntry(entryKeyStr) {
  // 리스트 뷰에서는 간트로 전환해야 하이라이트가 보임
  if (currentView !== 'gantt') setView('gantt');

  // 기존 하이라이트 제거
  document.querySelectorAll('.entry-bar.highlight').forEach(el => {
    el.classList.remove('highlight');
  });

  // 안정 키로 바로 조회 (표시 범위 밖 엔트리는 바가 없어 undefined)
  const targetBar = barIndex.get(entryKeyStr);
  if (!targetBar) return;
  const gameSection = targetBar.closest('.game-section');
  if (!gameSection) return;

  // 하이라이트 적용
  targetBar.classList.add('highlight');

  // 타임라인 스크롤 위치 조정
  const timelineScroll = document.getElementById('timeline-scroll');
  const scrollRect = timelineScroll.getBoundingClientRect();

  // 수직 스크롤 (게임 섹션이 보이도록)
  const gameRect = gameSection.getBoundingClientRect();
  if (gameRect.top < scrollRect.top || gameRect.bottom > scrollRect.bottom) {
    gameSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // 수평 스크롤 (엔트리 바가 보이도록)
  const scrollLeft = targetBar.offsetLeft - scrollRect.width / 2 + targetBar.offsetWidth / 2;
  timelineScroll.scrollTo({ left: scrollLeft, behavior: 'smooth' });
}

  function closeDetail() {
    document.getElementById('detail-panel').classList.remove('open');
    document.getElementById('detail-overlay').classList.remove('open');
    currentDetailGame = null;
    if (lastFocusedBeforeDetail && document.contains(lastFocusedBeforeDetail)) {
      lastFocusedBeforeDetail.focus();
    }
    lastFocusedBeforeDetail = null;
  }

function setupDetailPanel() {
  // 게임 라벨 클릭으로 상세 패널 열기 (드래그 핸들 제외)
  document.getElementById('game-rows').addEventListener('click', (e) => {
    const label = e.target.closest('.game-label');
    if (!label) return;
    // 드래그 핸들 클릭은 무시
    if (e.target.closest('.game-label-drag')) return;
    const section = label.closest('.game-section');
    if (!section) return;
    const gid = section.dataset.id;
    const game = data.games.find(g => g.id === gid);
    if (game) openDetail(game);
  });

  document.getElementById('detail-panel-close').addEventListener('click', closeDetail);
  document.getElementById('detail-overlay').addEventListener('click', closeDetail);

  // ESC 키
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('detail-panel').classList.contains('open')) {
      closeDetail();
    }
  });

  // 키보드 접근성 추가
  document.getElementById('game-rows').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const label = e.target.closest('.game-label');
      if (label && !e.target.closest('.game-label-drag')) {
        const section = label.closest('.game-section');
        if (section) {
          const gid = section.dataset.id;
          const game = data.games.find(g => g.id === gid);
          if (game) {
            openDetail(game);
            e.preventDefault();
          }
        }
      }
    }
  });

  // 포커스 트랩: Tab 순환을 패널 내부로 제한
  document.getElementById('detail-panel').addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const panel = document.getElementById('detail-panel');
    const focusables = panel.querySelectorAll('button, [tabindex="0"]');
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // 상세 패널 내 키보드 탐색
  document.getElementById('detail-panel-content').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const entries = document.querySelectorAll('.detail-entry');
      if (entries.length === 0) return;

      let currentIndex = -1;
      entries.forEach((entry, index) => {
        if (entry === document.activeElement || entry.contains(document.activeElement)) {
          currentIndex = index;
        }
      });

      if (e.key === 'ArrowDown') {
        const nextIndex = (currentIndex + 1) % entries.length;
        entries[nextIndex].focus();
      } else {
        const prevIndex = (currentIndex - 1 + entries.length) % entries.length;
        entries[prevIndex].focus();
      }
      e.preventDefault();
    }
  });
}

  /* ── 뷰 전환 (간트 ↔ 리스트) ── */
  let currentView = 'gantt';
  try { currentView = localStorage.getItem('tl-view') || 'gantt'; } catch(e) {}

  function setView(view) {
    currentView = view;
    try { localStorage.setItem('tl-view', view); } catch(e) {}
    const isList = view === 'list';
    const timelineEl = document.getElementById('timeline-scroll');
    const listEl = document.getElementById('list-scroll');

    // 페이드 아웃 → 전환 → 페이드 인
    const fromEl = isList ? timelineEl : listEl;
    const toEl   = isList ? listEl : timelineEl;

    fromEl.classList.add('view-fade-out');

    setTimeout(() => {
      // 이전 뷰는 어느 방향이든 숨긴다.
      // display만 비우면 간트로 돌아올 때 리스트가 남아 그대로 겹쳐 보였다.
      fromEl.hidden = true;
      fromEl.style.display = 'none';
      fromEl.classList.remove('view-fade-out');

      toEl.hidden = false;
      toEl.style.display = '';
      toEl.classList.add('view-fade-out');
      // 강제 리플로우 후 페이드 인
      toEl.offsetHeight;
      toEl.classList.remove('view-fade-out');

      if (isList) renderListView();
    }, 200); // CSS transition duration과 일치

    document.getElementById('gantt-view').classList.toggle('active', !isList);
    document.getElementById('list-view').classList.toggle('active', isList);
    updateHash();
  }

  function setupViewToggle() {
    document.getElementById('gantt-view').addEventListener('click', () => setView('gantt'));
    document.getElementById('list-view').addEventListener('click', () => setView('list'));
    if (currentView === 'list') setView('list');
  }

  /* ── 엔트리 상태 계산 ── */
  function entryStatus(start, end) {
    const endDiff = D.diffDays(today, end);
    const startDiff = D.diffDays(today, start);
    if (endDiff < 0) {
      return { cls: 'status-ended',
        label: t('statusEndedFmt', '종료 ({n}일 전)').replace('{n}', Math.abs(endDiff)) };
    }
    if (startDiff > 0) {
      return { cls: 'status-upcoming',
        label: t('statusUpcomingFmt', '{n}일 후 시작').replace('{n}', startDiff) };
    }
    return { cls: 'status-active',
      label: t('statusOngoingFmt', '진행중 · {n}일 남음').replace('{n}', endDiff) };
  }

  function fmtDuration(days) {
    return t('durationFmt', '{n}일').replace('{n}', days);
  }

  /* ── 리스트 뷰 그룹 접기 상태 ── */
  // 진행중 항목이 100건을 넘는 경우가 있어, 지난 일정은 기본으로 접어둔다
  let listCollapsed = new Set(['ended']);
  try {
    const saved = JSON.parse(localStorage.getItem('tl-list-collapsed'));
    if (Array.isArray(saved)) listCollapsed = new Set(saved);
  } catch (e) {}

  function saveListCollapsed() {
    try {
      localStorage.setItem('tl-list-collapsed', JSON.stringify([...listCollapsed]));
    } catch (e) {}
  }

  /* ── 리스트 뷰 렌더링 ── */
  function renderListView() {
    const container = document.getElementById('list-container');
    container.innerHTML = '';
    if (!data) return;

    const rangeEnd = D.addDays(startDate, totalDays);
    const activeIds = new Set(
      [...document.querySelectorAll('.game-chip.active')].map(c => c.dataset.gameId)
    );

    const items = [];
    data.games.forEach(game => {
      if (!activeIds.has(game.id)) return;
      visibleEntries(game).forEach(entry => {
        const s = D.parse(entry.start);
        const e = D.parse(entry.end);
        if (e <= startDate || s >= rangeEnd) return; // 표시 범위 밖 제외
        items.push({ game, entry, s, e });
      });
    });

    const groups = [
      { key: 'ongoing',  title: t('listOngoing', '진행중'),
        items: items.filter(it => it.s <= today && it.e >= today).sort((a, b) => a.e - b.e) },
      { key: 'upcoming', title: t('listUpcoming', '예정'),
        items: items.filter(it => it.s > today).sort((a, b) => a.s - b.s) },
      { key: 'ended',    title: t('listEnded', '종료'),
        items: items.filter(it => it.e < today).sort((a, b) => b.e - a.e) },
    ];

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-empty';
      empty.textContent = t('listEmpty', '표시할 일정이 없습니다.');
      container.appendChild(empty);
      return;
    }

    groups.forEach(group => {
      if (group.items.length === 0) return;

      const collapsed = listCollapsed.has(group.key);

      const titleEl = document.createElement('button');
      titleEl.type = 'button';
      titleEl.className = `list-section-title list-sec-${group.key}`;
      titleEl.setAttribute('aria-expanded', String(!collapsed));
      titleEl.innerHTML =
        `<span class="list-sec-caret" aria-hidden="true">▾</span>` +
        `<span>${esc(group.title)} (${group.items.length})</span>`;
      titleEl.addEventListener('click', () => {
        if (listCollapsed.has(group.key)) listCollapsed.delete(group.key);
        else listCollapsed.add(group.key);
        saveListCollapsed();
        renderListView();
      });
      container.appendChild(titleEl);

      const body = document.createElement('div');
      body.className = 'list-section-body';
      body.hidden = collapsed;
      container.appendChild(body);

      group.items.forEach(({ game, entry, s, e }) => {
        const dur = D.diffDays(s, e);
        const status = entryStatus(s, e);

        const iconHtml = game.iconUrl
          ? `<img class="chip-icon-img" src="${esc(game.iconUrl)}" alt="" onerror="this.style.display='none'">`
          : `<span class="chip-icon">${esc(game.icon || '')}</span>`;

        const item = document.createElement('div');
        item.className = 'list-entry';
        item.tabIndex = 0;
        item.setAttribute('role', 'button');
        item.innerHTML = `
          <div class="detail-entry-bar-indicator type-${entry.type}${entry.tentative ? ' tentative' : ''}"></div>
          <div class="list-entry-game" style="--chip-color:${esc(game.color)}">
            ${iconHtml}<span class="list-entry-game-name">${esc(gameName(game))}</span>
          </div>
          <div class="detail-entry-main">
            <div class="detail-entry-title-row">
              <span class="detail-entry-title">${esc(entry.title)}</span>
              ${entry.tentative ? `<span class="detail-entry-tentative-badge">⚠ ${esc(t('legendTentative', '미확정'))}</span>` : ''}
            </div>
            ${entry.subtitle ? `<div class="detail-entry-subtitle">${esc(entry.subtitle)}</div>` : ''}
          </div>
          <div class="detail-entry-dates">
            <span class="detail-date-range">${D.fmtShort(s)} → ${D.fmtShort(e)}</span>
            <span class="detail-date-dur">${esc(fmtDuration(dur))}${entry.version ? ` · v${esc(entry.version)}` : ''}</span>
          </div>
          <div class="detail-entry-status ${status.cls}">${esc(status.label)}</div>
        `;
        const open = () => openEntryModal(game, entry);
        item.addEventListener('click', open);
        item.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
        });
        body.appendChild(item);
      });
    });
  }

  /* ── 오늘 위치로 스크롤 ── */
  function scrollToToday(smooth = true) {
    const scroll = document.getElementById('timeline-scroll');
    const x = CFG.labelW + dateToX(today);
    const target = Math.max(0, x - scroll.clientWidth * 0.35);
    scroll.scrollTo({ left: target, behavior: smooth ? 'smooth' : 'auto' });
  }

  function setupTodayButton() {
    document.getElementById('today-btn').addEventListener('click', () => {
      if (currentView !== 'gantt') setView('gantt');
      scrollToToday(true);
    });
  }

  /* ── iCalendar(.ics) 내보내기 ── */
  function icsEscape(s) {
    return String(s ?? '')
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  function icsDate(d) {
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }

  function buildIcs() {
    const activeIds = new Set(
      [...document.querySelectorAll('.game-chip.active')].map(c => c.dataset.gameId)
    );
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//subculture-timeline//KO',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ];
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z/, 'Z');
    let seq = 0;

    data.games.forEach(game => {
      if (!activeIds.has(game.id)) return;
      visibleEntries(game).forEach(entry => {
        const end = D.parse(entry.end);
        if (end < today) return; // 종료된 일정은 제외
        const start = D.parse(entry.start);
        const gName = gameName(game);
        const descParts = [];
        if (entry.subtitle) descParts.push(entry.subtitle);
        if (entry.tentative) descParts.push(t('tooltipTentative', '⚠ 미확정 일정 (변동 가능)'));
        if (entry.source) descParts.push(`${t('tooltipSource', '출처:')} ${entry.source}`);
        lines.push(
          'BEGIN:VEVENT',
          `UID:${game.id}-${entry.id || seq++}-${entry.start}@subculture-timeline`,
          `DTSTAMP:${stamp}`,
          `DTSTART;VALUE=DATE:${icsDate(start)}`,
          `DTEND;VALUE=DATE:${icsDate(D.addDays(end, 1))}`, // DTEND는 exclusive
          `SUMMARY:${icsEscape(`[${gName}] ${entry.title}`)}`,
          descParts.length ? `DESCRIPTION:${icsEscape(descParts.join('\n'))}` : null,
          'END:VEVENT'
        );
      });
    });

    lines.push('END:VCALENDAR');
    return lines.filter(Boolean).join('\r\n');
  }

  function setupIcsExport() {
    document.getElementById('ics-btn').addEventListener('click', () => {
      const blob = new Blob([buildIcs()], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'subculture-timeline.ics';
      a.click();
      // 클릭과 동시에 revoke하면 일부 브라우저에서 다운로드가 취소된다
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  /* ── Public API ── */
  return { init, setupRangeControl };

})();

document.addEventListener('DOMContentLoaded', async () => {
  // i18n 먼저 로드 (언어 버튼 + 텍스트)
  if (typeof I18n !== 'undefined') await I18n.init();
  Timeline.init();
  Timeline.setupRangeControl();
});
