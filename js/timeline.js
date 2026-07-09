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
    rowH: 44,            // 행 높이
    rulerH: 52,          // 눈금자 높이
    labelW: 120,         // 게임 이름 컬럼 너비
  };

  let data = null;
  let today = null;
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
    try {
      const res = await fetch('data/games.json');
      data = await res.json();
    } catch (e) {
      console.error('games.json 로드 실패:', e);
      return;
    }

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
    setupViewToggle();
    setupTodayButton();
    setupIcsExport();
    updateCSSVars();
    scrollToToday(false);

    // 언어 전환 시 렌더 텍스트 갱신 (행 레이블·오늘선·리스트 뷰)
    document.addEventListener('tl-langchange', () => {
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
      ? `<img class="chip-icon-img" src="${esc(game.iconUrl)}" alt="${esc(game.name)}" onerror="this.style.display='none'">`
      : `<span class="chip-icon">${esc(game.icon)}</span>`;

    chip.innerHTML = `${iconHtml}<span class="chip-name">${esc(game.nameKo || game.name)}</span>`;
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
  return [game.nameKo, game.name, game.fullName]
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

    // 타입별 분리
    const versions = game.entries.filter(e => e.type === 'version');
    const banners  = game.entries.filter(e => e.type === 'banner');
    const events   = game.entries.filter(e => e.type === 'event');

    // 행 목록 구성: 버전 행 + 배너 행 + 이벤트 행
    const rows = [];
    if (versions.length > 0) rows.push({ kind: 'versions', items: versions });
    if (banners.length > 0)  rows.push({ kind: 'banners',  items: banners });
    if (events.length > 0)   rows.push({ kind: 'events',   items: events });

    const totalRows = Math.max(rows.length, 1);

    // 게임 라벨 (첫 행만 sticky, rowspan은 CSS로 처리)
    const headerRow = document.createElement('div');
    headerRow.className = 'game-header-row';

    const label = document.createElement('div');
    label.className = 'game-label';
    label.tabIndex = 0;
    label.setAttribute('role', 'button');
    label.setAttribute('aria-label', `${game.nameKo || game.name} 상세보기`);
    label.style.borderLeft = `3px solid ${game.color}`;
    label.style.height = (totalRows * CFG.rowH) + 'px';

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
        <div class="game-label-name">${esc(game.nameKo || game.name)}</div>
        <div class="game-label-dev">${esc(game.developer)}</div>
      </div>
      <div class="game-label-hint">${esc(t('detailHint', '상세보기'))}</div>
    `;

    const entriesWrapper = document.createElement('div');
    entriesWrapper.className = 'game-entries';
    entriesWrapper.style.width = (totalDays * CFG.dayPx) + 'px';
    entriesWrapper.style.minHeight = (totalRows * CFG.rowH) + 'px';

    rows.forEach(rowGroup => {
      const rowEl = document.createElement('div');
      rowEl.className = `entry-row entry-row-${rowGroup.kind}`;
      rowEl.style.height = CFG.rowH + 'px';

      // 행 타입 레이블
      const labelText = rowGroup.kind === 'versions' ? t('rowVersions', '버전')
        : rowGroup.kind === 'banners' ? t('rowBanners', '배너') : t('rowEvents', '이벤트');
      const label = document.createElement('div');
      label.className = `entry-row-label label-${rowGroup.kind}`;
      label.textContent = labelText;
      rowEl.appendChild(label);

      rowGroup.items.forEach(entry => {
        const bar = buildBar(entry, game);
        if (bar) rowEl.appendChild(bar);
      });

      entriesWrapper.appendChild(rowEl);
    });

    headerRow.appendChild(label);
    headerRow.appendChild(entriesWrapper);
    section.appendChild(headerRow);

    return section;
  }

function buildBar(entry, game) {
  const entryStart = D.parse(entry.start);
  const entryEnd   = D.parse(entry.end);
  const rangeEnd   = D.addDays(startDate, totalDays);

  // 범위 밖 완전히 제외
  if (entryEnd <= startDate || entryStart >= rangeEnd) return null;

  // 클리핑
  const clippedStart = entryStart < startDate ? startDate : entryStart;
  const clippedEnd   = entryEnd > rangeEnd ? rangeEnd : entryEnd;

  const x = dateToX(clippedStart);
  const w = Math.max(4, D.diffDays(clippedStart, clippedEnd) * CFG.dayPx);

  const bar = document.createElement('div');
  bar.className = `entry-bar type-${entry.type}`;
  if (entry.tentative) bar.classList.add('tentative');

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

  // 툴팁 데이터 (entry.id가 없을 경우 UUID 생성)
  const entryData = {
    gameName: game.name,
    gameFullName: game.fullName,
    gameColor: game.color,
    gameIcon: game.icon,
    ...entry,
    id: entry.id || crypto.randomUUID()
  };
  bar.dataset.entry = JSON.stringify(entryData);

  // 키보드 접근성: Tab으로 포커스 → 툴팁 표시
  bar.tabIndex = 0;
  bar.setAttribute('aria-label',
    `${game.nameKo || game.name} — ${entry.title} (${entry.start} ~ ${entry.end})`);

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

function setupTooltip() {
  // 기존 이벤트 리스너 제거
  if (tooltipController) {
    tooltipController.abort();
  }
  tooltipController = new AbortController();
  const { signal } = tooltipController;

  const tooltip = document.getElementById('tooltip');
  const scroll  = document.getElementById('timeline-scroll');

  let currentBar = null;

  // 마우스 이벤트 리스너
  scroll.addEventListener('mouseover', (e) => {
    const bar = e.target.closest('.entry-bar');
    if (!bar || !bar.dataset.entry) {
      return;
    }
    if (bar === currentBar) return;
    currentBar = bar;
    showTooltip(bar, tooltip, e);
  }, { signal });

  scroll.addEventListener('mousemove', (e) => {
    if (!tooltip.classList.contains('visible')) return;
    positionTooltip(tooltip, e);
  }, { signal });

  scroll.addEventListener('mouseout', (e) => {
    const bar = e.target.closest('.entry-bar');
    if (bar && bar === currentBar) {
      const related = e.relatedTarget;
      if (!related || !related.closest('.entry-bar')) {
        currentBar = null;
        tooltip.classList.remove('visible');
      }
    }
  }, { signal });

  document.addEventListener('mouseleave', () => {
    currentBar = null;
    tooltip.classList.remove('visible');
  }, { signal });

  // 키보드 접근성: 포커스 이동 시 툴팁 표시
  document.addEventListener('focusin', (e) => {
    const bar = e.target.closest ? e.target.closest('.entry-bar') : null;
    if (bar && bar.dataset.entry) {
      currentBar = bar;
      const rect = bar.getBoundingClientRect();
      showTooltip(bar, tooltip, {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
      });
    }
  }, { signal });

  // 포커스 아웃 시 툴팁 숨기기
  document.addEventListener('focusout', (e) => {
    if (!e.relatedTarget || !e.relatedTarget.closest('.entry-bar')) {
      currentBar = null;
      tooltip.classList.remove('visible');
    }
  }, { signal });

  // 터치 기기: 탭으로 툴팁 토글 (hover 불가 환경)
  scroll.addEventListener('click', (e) => {
    if (!window.matchMedia('(hover: none)').matches) return;
    const bar = e.target.closest('.entry-bar');
    if (!bar || !bar.dataset.entry) return;
    if (bar === currentBar && tooltip.classList.contains('visible')) {
      currentBar = null;
      tooltip.classList.remove('visible');
      return;
    }
    currentBar = bar;
    const rect = bar.getBoundingClientRect();
    showTooltip(bar, tooltip, {
      clientX: rect.left + rect.width / 2,
      clientY: rect.bottom + 4
    });
  }, { signal });

  // 터치 기기: 바 바깥 탭으로 툴팁 닫기
  document.addEventListener('click', (e) => {
    if (!window.matchMedia('(hover: none)').matches) return;
    if (!e.target.closest('.entry-bar')) {
      currentBar = null;
      tooltip.classList.remove('visible');
    }
  }, { signal });
}

  function showTooltip(bar, tooltip, e) {
    let entry;
    try { entry = JSON.parse(bar.dataset.entry); } catch { return; }

    const start = D.parse(entry.start);
    const end   = D.parse(entry.end);
    const dur   = D.diffDays(start, end);

    const status = entryStatus(start, end);
    const icon = status.cls === 'status-ended' ? '⏹' : status.cls === 'status-upcoming' ? '🔜' : '▶';
    const statusText = `<div class="tooltip-duration"${status.cls === 'status-active' ? ' style="color:#66bb6a"' : ''}>${icon} ${esc(status.label)}</div>`;

    tooltip.innerHTML = `
      <div class="tooltip-inner">
        <div class="tooltip-game">
          <span class="tooltip-color-dot" style="background:${esc(entry.gameColor)}"></span>
          ${esc(entry.gameIcon)} ${esc(entry.gameFullName)}
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
    restoreOrder();
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
  titleEl.innerHTML = `<span class="detail-modal-icon">${iconHtml}</span>${esc(game.fullName || game.name)}`;

  content.innerHTML = '';

  // 타입 순서: version → banner → event, 같은 타입 내 최신순
  const typeOrder = { version: 0, banner: 1, event: 2 };
  const sorted = [...game.entries].sort((a, b) => {
    const ta = typeOrder[a.type] ?? 9;
    const tb = typeOrder[b.type] ?? 9;
    if (ta !== tb) return ta - tb;
    return b.start.localeCompare(a.start);
  });

  let lastType = null;
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
    item.dataset.entryId = entry.id || '';
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
  });

  panel.classList.add('open');
  overlay.classList.add('open');

  // 포커스 관리: 열릴 때 닫기 버튼으로 이동, 닫힐 때 복원
  lastFocusedBeforeDetail = document.activeElement;
  document.getElementById('detail-panel-close').focus();

  // 상세 패널에서 타임라인 동기화
  document.querySelectorAll('.detail-entry').forEach(entryEl => {
    entryEl.addEventListener('click', () => {
      const entryId = entryEl.dataset.entryId;
      const gameId = currentDetailGame.id;
      highlightTimelineEntry(gameId, entryId);
    });
  });
}

function highlightTimelineEntry(gameId, entryId) {
  // 리스트 뷰에서는 간트로 전환해야 하이라이트가 보임
  if (currentView !== 'gantt') setView('gantt');

  // 기존 하이라이트 제거
  document.querySelectorAll('.entry-bar.highlight').forEach(el => {
    el.classList.remove('highlight');
  });

  // 해당 게임 섹션 찾기
  const gameSection = document.querySelector(`.game-section[data-id="${gameId}"]`);
  if (!gameSection) return;

  // 해당 엔트리 찾기 (JSON 파싱으로 안전하게 검색)
  const entryBars = gameSection.querySelectorAll('.entry-bar');
  let targetBar = null;
  for (const bar of entryBars) {
    try {
      const entry = JSON.parse(bar.dataset.entry);
      if (entry.id === entryId) {
        targetBar = bar;
        break;
      }
    } catch (e) {
      console.error('Failed to parse entry data:', e);
    }
  }
  if (!targetBar) return;

  // 하이라이트 적용
  targetBar.classList.add('highlight');

  // 타임라인 스크롤 위치 조정
  const timelineScroll = document.getElementById('timeline-scroll');
  const entryRect = targetBar.getBoundingClientRect();
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
    document.getElementById('timeline-scroll').style.display = isList ? 'none' : '';
    document.getElementById('list-scroll').hidden = !isList;
    document.getElementById('gantt-view').classList.toggle('active', !isList);
    document.getElementById('list-view').classList.toggle('active', isList);
    if (isList) renderListView();
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
      game.entries.forEach(entry => {
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

      const titleEl = document.createElement('div');
      titleEl.className = `list-section-title list-sec-${group.key}`;
      titleEl.textContent = `${group.title} (${group.items.length})`;
      container.appendChild(titleEl);

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
            ${iconHtml}<span class="list-entry-game-name">${esc(game.nameKo || game.name)}</span>
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
          <div class="detail-entry-status ${status.cls}">${status.label}</div>
        `;
        const open = () => openDetail(game);
        item.addEventListener('click', open);
        item.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
        });
        container.appendChild(item);
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
      game.entries.forEach(entry => {
        const end = D.parse(entry.end);
        if (end < today) return; // 종료된 일정은 제외
        const start = D.parse(entry.start);
        const gameName = game.nameKo || game.name;
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
          `SUMMARY:${icsEscape(`[${gameName}] ${entry.title}`)}`,
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
      URL.revokeObjectURL(url);
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
