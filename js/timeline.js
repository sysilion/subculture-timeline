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

    restoreOrder();
    buildFilters();
    renderRuler();
    renderGames();
    renderTodayLine();
    setupTooltip();
    setupSortable();
    setupDetailPanel();
    updateCSSVars();
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
      ? `<img class="chip-icon-img" src="${game.iconUrl}" alt="${game.name}" onerror="this.style.display='none'">`
      : `<span class="chip-icon">${game.icon}</span>`;

    chip.innerHTML = `${iconHtml}<span class="chip-name">${game.nameKo || game.name}</span>`;
    chip.addEventListener('click', () => toggleGame(game.id, chip));
    bar.appendChild(chip);
  });

  // 검색 기능 추가
  const searchInput = document.getElementById('game-search');
  const clearButton = document.getElementById('clear-search');

  searchInput.addEventListener('input', () => {
    const searchTerm = searchInput.value.toLowerCase();
    document.querySelectorAll('.game-chip').forEach(chip => {
      const gameName = chip.querySelector('.chip-name').textContent.toLowerCase();
      const shouldShow = gameName.includes(searchTerm);
      chip.style.display = shouldShow ? 'inline-flex' : 'none';
    });
  });

  clearButton.addEventListener('click', () => {
    searchInput.value = '';
    document.querySelectorAll('.game-chip').forEach(chip => {
      chip.style.display = 'inline-flex';
    });
  });
}

  function toggleGame(id, chip) {
    const section = document.querySelector(`.game-section[data-id="${id}"]`);
    if (!section) return;
    const isActive = chip.classList.contains('active');
    chip.classList.toggle('active', !isActive);
    chip.classList.toggle('inactive', isActive);
    section.classList.toggle('hidden', isActive);
    saveFilters();
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
      ? `<img class="game-label-icon-img" src="${game.iconUrl}" alt="${game.name}" onerror="this.remove()">`
      : '';

    label.innerHTML = `
      <div class="game-label-overlay"></div>
      <div class="game-label-drag" title="드래그하여 순서 변경"></div>
      ${iconHtml}
      <div class="game-label-content">
        <div class="game-label-name">${game.nameKo || game.name}</div>
        <div class="game-label-dev">${game.developer}</div>
      </div>
      <div class="game-label-hint">상세보기</div>
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
      const labelText = rowGroup.kind === 'versions' ? '버전'
        : rowGroup.kind === 'banners' ? '배너' : '이벤트';
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
      textEl.innerHTML = `${entry.title}${entry.subtitle ? `<span class="bar-subtitle">${entry.subtitle}</span>` : ''}`;
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

  // 키보드 접근성 추가
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      const focused = document.activeElement;
      const bar = focused.closest('.entry-bar');
      if (bar && bar.dataset.entry) {
        currentBar = bar;
        showTooltip(bar, tooltip, {
          clientX: bar.getBoundingClientRect().left + bar.offsetWidth / 2,
          clientY: bar.getBoundingClientRect().top + bar.offsetHeight / 2
        });
      }
    }
  }, { signal });

  // 포커스 아웃 시 툴팁 숨기기
  document.addEventListener('focusout', (e) => {
    if (!e.relatedTarget || !e.relatedTarget.closest('.entry-bar')) {
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

    const nowDiff = D.diffDays(today, end);
    let statusText = '';
    if (nowDiff < 0) {
      statusText = `<div class="tooltip-duration">⏹ ${Math.abs(nowDiff)}일 전 종료</div>`;
    } else if (D.diffDays(today, start) > 0) {
      statusText = `<div class="tooltip-duration">🔜 ${D.diffDays(today, start)}일 후 시작</div>`;
    } else {
      statusText = `<div class="tooltip-duration" style="color:#66bb6a">▶ 진행중 — ${nowDiff}일 남음</div>`;
    }

    tooltip.innerHTML = `
      <div class="tooltip-inner">
        <div class="tooltip-game">
          <span class="tooltip-color-dot" style="background:${entry.gameColor}"></span>
          ${entry.gameIcon} ${entry.gameFullName}
        </div>
        <div class="tooltip-title">${entry.title}</div>
        ${entry.subtitle ? `<div class="tooltip-subtitle">${entry.subtitle}</div>` : ''}
        <div class="tooltip-dates">
          <div><span>시작:</span> ${D.fmt(start)}</div>
          <div><span>종료:</span> ${D.fmt(end)}</div>
        </div>
        ${statusText}
        <div class="tooltip-duration">기간: ${dur}일 · v${entry.version || '?'}</div>
        ${entry.tentative ? '<div class="tooltip-tentative">⚠ 미확정 일정 (변동 가능)</div>' : ''}
        ${entry.source ? `<div class="tooltip-source">출처: ${entry.source}</div>` : ''}
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

function openDetail(game) {
  currentDetailGame = game;
  const panel = document.getElementById('detail-panel');
  const overlay = document.getElementById('detail-overlay');
  const titleEl = panel.querySelector('.detail-panel-title');
  const content = document.getElementById('detail-panel-content');

  const iconHtml = game.iconUrl
    ? `<img src="${game.iconUrl}" alt="${game.name}" style="width:20px;height:20px;border-radius:4px;object-fit:contain;">`
    : (game.icon || '');
  titleEl.innerHTML = `<span class="detail-modal-icon">${iconHtml}</span>${game.fullName || game.name}`;

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

    const nowDiff = D.diffDays(today, end);
    const startDiff = D.diffDays(today, start);
    let statusClass = '', statusLabel = '';
    if (nowDiff < 0) {
      statusClass = 'status-ended';
      statusLabel = `종료 (${Math.abs(nowDiff)}일 전)`;
    } else if (startDiff > 0) {
      statusClass = 'status-upcoming';
      statusLabel = `${startDiff}일 후 시작`;
    } else {
      statusClass = 'status-active';
      statusLabel = `진행중 · ${nowDiff}일 남음`;
    }

    // 타입 구분선
    if (entry.type !== lastType) {
      const sep = document.createElement('div');
      const typeLabel = entry.type === 'version' ? '버전' : entry.type === 'banner' ? '뽑기 배너' : '이벤트';
      sep.className = `detail-type-sep sep-${entry.type}`;
      sep.textContent = typeLabel;
      content.appendChild(sep);
      lastType = entry.type;
    }

    const item = document.createElement('div');
    item.className = `detail-entry detail-entry-${entry.type}`;
    item.dataset.entryId = entry.id || '';
    item.innerHTML = `
      <div class="detail-entry-bar-indicator type-${entry.type}${entry.tentative ? ' tentative' : ''}"></div>
      <div class="detail-entry-main">
        <div class="detail-entry-title-row">
          <span class="detail-entry-title">${entry.title}</span>
          ${entry.tentative ? '<span class="detail-entry-tentative-badge">⚠ 미확정</span>' : ''}
        </div>
        ${entry.subtitle ? `<div class="detail-entry-subtitle">${entry.subtitle}</div>` : ''}
      </div>
      <div class="detail-entry-dates">
        <span class="detail-date-range">${D.fmtShort(start)} → ${D.fmtShort(end)}</span>
        <span class="detail-date-dur">${dur}일${entry.version ? ` · v${entry.version}` : ''}</span>
      </div>
      <div class="detail-entry-status ${statusClass}">${statusLabel}</div>
    `;
    content.appendChild(item);
  });

  panel.classList.add('open');
  overlay.classList.add('open');

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

  /* ── Public API ── */
  return { init, setupRangeControl };

})();

document.addEventListener('DOMContentLoaded', async () => {
  // i18n 먼저 로드 (언어 버튼 + 텍스트)
  if (typeof I18n !== 'undefined') await I18n.init();
  Timeline.init();
  Timeline.setupRangeControl();
});
