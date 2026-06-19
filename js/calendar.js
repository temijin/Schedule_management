(function () {
  'use strict';

  const SESSION_KEY = 'calendar-session-v1';
  const SAVES_KEY = 'calendar-saves-v1';
  const STORAGE_KEY_LEGACY = 'calendar-markings-v2';
  const STORAGE_KEY_V1 = 'calendar-markings-v1';
  const DEFAULT_MAX_SAVES = 100;
  const UPDATE_NEWS_VERSION = '2';
  const UPDATE_NEWS_DISMISS_KEY = 'calendar-update-news-dismissed';
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
  const TITLE_ALIGN_CHAR = '만';
  const WEEKDAY_ALIGN_CHAR = '수';
  const SCHEDULE_ALIGN_MOBILE_MAX = 640;
  const DEFAULT_VIEW_YEAR = 2026;
  const DEFAULT_VIEW_MONTH = 5;
  const DEFAULT_VISIBLE_MONTH_COUNT = 1;
  const MAX_VISIBLE_MONTH_COUNT = 12;

  const OUTLINE_BORDER_COLOR = '#000000';
  const SLASH_LABEL_FONT_SIZE = 18;
  const LEGACY_LABEL_FONT_SIZE = 20;
  const PREVIOUS_DEFAULT_LABEL_SIZE = 14;
  const PREVIOUS_DEFAULT_LABEL_STROKE = 2;
  const SLASH_MODE_LABELS = {
    holiday: '공휴일',
    postpone: '수업연기',
  };
  const SLASH_LABEL_TEXTS = new Set(Object.values(SLASH_MODE_LABELS));
  const SLASH_LABEL_MATCH_EPS = 0.05;

  const DEFAULT_LABEL_STYLE = {
    size: 18,
    weight: 900,
    strokeWidth: 4,
    color: '#111111',
  };

  const LABEL_TEXT_COLORS = [
    '#111111',
    '#87133b',
    '#9f3919',
    '#ac9a00',
    '#146d17',
    '#11436c',
  ];
  const LABEL_TEXT_COLOR_TITLES = ['검정', '분홍', '살구', '노랑', '녹색', '파랑'];

  /** 글자 템플릿 — defaultColor만 바꾸면 배치 시 기본 색상 변경 */
  const LABEL_TEMPLATES = [
    { text: '시작일', defaultColor: '#111111' },
    { text: '종료일', defaultColor: '#111111' },
  ];
  const LABEL_TEMPLATE_BY_TEXT = Object.fromEntries(
    LABEL_TEMPLATES.map((item) => [item.text, item])
  );

  function getLabelTemplateDefaultColor(text) {
    const template = LABEL_TEMPLATE_BY_TEXT[text];
    if (!template) return null;
    return normalizeHexColor(template.defaultColor);
  }

  const TOOL_HINTS = {
    slash: '공휴일·불가 날짜 — 숫자에 줄을 긋습니다.',
    colorBox: '날짜마다 색 정사각형을 칠합니다.',
    transparentBox: '큰박스 — 드래그한 날짜를 굵은 테두리로 묶습니다.',
    label: '달력을 클릭한 위치에 글자를 입력하세요. 텍스트는 드래그로 옮길 수 있습니다.',
    eraser: '지우고 싶은 표시를 클릭하거나 드래그하세요. 다른 도구를 쓸 때도 달력에서 우클릭·드래그로 지울 수 있습니다.',
    pointer: '표시를 드래그하여 위치를 옮깁니다.',
  };

  const TOOL_SHORTCUTS = {
    v: 'pointer',
    r: 'colorBox',
    e: 'transparentBox',
    x: 'slash',
    t: 'label',
  };

  const SLASH_MODES = ['holiday', 'postpone', 'plain'];

  const state = {
    viewYear: 2026,
    viewMonth: 5,
    visibleMonthCount: 1,
    activeTool: 'pointer',
    slashMode: 'holiday',
    activeColor: '#c8e6c9',
    labelStyle: { ...DEFAULT_LABEL_STYLE },
    slashes: {},
    colorGroups: [],
    outlineGroups: [],
    floatingLabels: [],
    labelCoordSpace: 'area',
  };

  let isDragging = false;
  let dragMoved = false;
  let selectionUsesEraser = false;
  let floatingLabelDrag = null;
  let floatingLabelResize = null;
  let selectedFloatingLabelId = null;
  let editingFloatingLabelId = null;
  let copiedFloatingLabel = null;
  let pasteRepeatCount = 0;
  const labelTemplatePlaceCounts = {};
  let markMoveDrag = null;
  let markMoveDropTargetKey = null;
  let copyFlashTimeout = null;
  let selection = new Set();
  let activeSaveId = null;
  let unsavedResolve = null;
  let pendingDeleteId = null;
  let alignResizeTimer = null;
  let isApplyingHistory = false;
  let activePanelKey = null;
  let activePanelScrollTimer = null;

  const undoStack = [];
  const redoStack = [];

  const historyUi = {
    sort: { field: 'date', dir: 'desc' },
    search: '',
  };

  const savesMeta = {
    maxSaves: DEFAULT_MAX_SAVES,
    saves: [],
  };

  const stackEl = document.getElementById('calendar-stack');
  const panelControlsRootEl = document.getElementById('panel-controls-root');
  const inputYear = document.getElementById('input-year');
  const selectMonth = document.getElementById('select-month');
  const inputColor = document.getElementById('input-color');
  const colorOptions = document.getElementById('color-options');
  const labelStyleOptions = document.getElementById('label-style-options');
  const historyTbody = document.getElementById('history-tbody');
  const saveCounterEl = document.getElementById('save-counter');
  const inputMaxSaves = document.getElementById('input-max-saves');
  const inputHistorySearch = document.getElementById('input-history-search');
  const saveDialog = document.getElementById('save-dialog');
  const unsavedDialog = document.getElementById('unsaved-dialog');
  const deleteDialog = document.getElementById('delete-dialog');
  const deleteDialogMessage = document.getElementById('delete-dialog-message');
  const updateNewsDialog = document.getElementById('update-news-dialog');
  const updateNewsDismissCheckbox = document.getElementById('update-news-dismiss');
  const inputSaveName = document.getElementById('input-save-name');
  const inputLabelSize = document.getElementById('input-label-size');
  const inputLabelWeight = document.getElementById('input-label-weight');
  const inputLabelStrokeWidth = document.getElementById('input-label-stroke-width');
  const toolHintEl = document.getElementById('tool-hint');
  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');

  const labelStyleInputEls = () => [inputLabelSize, inputLabelWeight, inputLabelStrokeWidth];

  function panelKey(year, month) {
    return `${year}-${month}`;
  }

  function clamp01(n) {
    return Math.min(1, Math.max(0, n));
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function dateKey(y, m, d) {
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  function parseDateKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function diffDays(fromKey, toKey) {
    const a = parseDateKey(fromKey);
    const b = parseDateKey(toKey);
    return Math.round((b - a) / 86400000);
  }

  function shiftDateKey(key, deltaDays) {
    const d = parseDateKey(key);
    d.setDate(d.getDate() + deltaDays);
    return dateKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  function addMonths(year, month, offset) {
    const d = new Date(year, month - 1 + offset, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }

  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function darkenColor(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, ((n >> 16) & 0xff) - amount);
    const g = Math.max(0, ((n >> 8) & 0xff) - amount);
    const b = Math.max(0, (n & 0xff) - amount);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }

  let colorBoxPreviewEl = null;

  function ensureColorBoxPreviewEl() {
    if (colorBoxPreviewEl) return colorBoxPreviewEl;
    colorBoxPreviewEl = document.createElement('div');
    colorBoxPreviewEl.className = 'color-box-cursor-preview';
    colorBoxPreviewEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(colorBoxPreviewEl);
    return colorBoxPreviewEl;
  }

  function syncColorBoxPreviewStyle() {
    const el = ensureColorBoxPreviewEl();
    el.style.setProperty('--preview-fill', state.activeColor);
    el.style.setProperty('--preview-border', darkenColor(state.activeColor, 40));
  }

  function setColorBoxPreviewVisible(show) {
    ensureColorBoxPreviewEl().style.display = show ? 'block' : 'none';
  }

  function positionColorBoxPreview(clientX, clientY) {
    const el = ensureColorBoxPreviewEl();
    el.style.left = `${clientX}px`;
    el.style.top = `${clientY}px`;
  }

  function hideColorBoxPreview() {
    setColorBoxPreviewVisible(false);
  }

  function isPointerInCalendarToolZone(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return false;
    if (el.closest('.history-column, .sidebar-column, .app-top-bar')) return false;
    if (el.closest('.nav-row, .panel-controls-root')) return false;
    return Boolean(el.closest('.calendar-column'));
  }

  function updateColorBoxPreviewAtPoint(clientX, clientY) {
    if (state.activeTool !== 'colorBox') {
      hideColorBoxPreview();
      return;
    }
    if (!isPointerInCalendarToolZone(clientX, clientY)) {
      hideColorBoxPreview();
      return;
    }
    syncColorBoxPreviewStyle();
    positionColorBoxPreview(clientX, clientY);
    setColorBoxPreviewVisible(true);
  }

  const DEFAULT_TOOL_MARK_METRICS = {
    boxSize: 34,
    boxBorder: 1,
    boxRadius: 3,
    slashLine: 2,
    outlineBorder: 1,
  };

  const PNG_EXPORT_BORDER_PX = 1;
  const PNG_EXPORT_LABEL_STROKE_PX = 4;

  const TOOL_CURSOR_CLASSES = [
    'tool-slash',
    'tool-color-box',
    'tool-transparent-box',
    'tool-eraser',
    'tool-label',
  ];
  const TOOL_CLASS_BY_TOOL = {
    slash: 'tool-slash',
    colorBox: 'tool-color-box',
    transparentBox: 'tool-transparent-box',
    eraser: 'tool-eraser',
    label: 'tool-label',
  };

  let slashCursorCss = null;
  let outlineCursorCss = null;
  let eraserCursorCss = null;
  let cursorMetricsCacheKey = '';

  function parsePx(value, fallback) {
    const n = parseFloat(String(value).trim());
    return Number.isFinite(n) ? n : fallback;
  }

  function getCalendarScale() {
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--calendar-scale'));
    return Number.isFinite(scale) ? scale : 1.43;
  }

  function scaledToolMarkFallbacks() {
    const scale = getCalendarScale();
    return {
      boxSize: 40 * scale,
      boxBorder: 1,
      boxRadius: 3 * scale,
      slashLine: 2,
      outlineBorder: 1,
    };
  }

  function readToolMarkMetrics() {
    const fallback = scaledToolMarkFallbacks();
    const markInner = stackEl?.querySelector('.day-cell:not(.has-outline) .day-inner');
    if (markInner) {
      const rect = markInner.getBoundingClientRect();
      if (rect.width > 0) {
        const cs = getComputedStyle(markInner);
        return {
          boxSize: rect.width,
          boxBorder: fallback.boxBorder,
          boxRadius: parsePx(cs.borderTopLeftRadius, fallback.boxRadius),
          slashLine: fallback.slashLine,
          outlineBorder: fallback.outlineBorder,
        };
      }
    }
    return fallback;
  }

  function toolMarkMetricsKey(m) {
    return `${m.boxSize}|${m.boxBorder}|${m.boxRadius}|${m.slashLine}|${m.outlineBorder}`;
  }

  function invalidateToolCursorCacheIfMetricsChanged() {
    const key = toolMarkMetricsKey(readToolMarkMetrics());
    if (key === cursorMetricsCacheKey) return;
    cursorMetricsCacheKey = key;
    slashCursorCss = null;
    outlineCursorCss = null;
    eraserCursorCss = null;
  }

  function buildCursorFromCanvas(width, height, hotspotX, hotspotY, drawFn) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    drawFn(ctx, width, height);
    return `url("${canvas.toDataURL('image/png')}") ${hotspotX} ${hotspotY}`;
  }

  function pathRoundRect(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function buildSlashCursor() {
    if (slashCursorCss) return slashCursorCss;
    const m = readToolMarkMetrics();
    const size = m.boxSize;
    const hotspot = size / 2;
    slashCursorCss = `${buildCursorFromCanvas(size, size, hotspot, hotspot, (ctx, w, h) => {
      drawSlashInRect(ctx, 0, 0, w, h, m.slashLine);
    })}, crosshair`;
    return slashCursorCss;
  }

  function buildOutlineCursor() {
    if (outlineCursorCss) return outlineCursorCss;
    const m = readToolMarkMetrics();
    const size = m.boxSize;
    const hotspot = size / 2;
    const border = m.outlineBorder;
    outlineCursorCss = `${buildCursorFromCanvas(size, size, hotspot, hotspot, (ctx, w, h) => {
      ctx.strokeStyle = '#000';
      ctx.lineWidth = border;
      const inset = border / 2;
      pathRoundRect(ctx, inset, inset, w - border, h - border, 4);
      ctx.stroke();
    })}, crosshair`;
    return outlineCursorCss;
  }

  function buildEraserCursor() {
    if (eraserCursorCss) return eraserCursorCss;
    const m = readToolMarkMetrics();
    const size = m.boxSize;
    const hotspot = size / 2;
    const scale = size / 20;
    eraserCursorCss = `${buildCursorFromCanvas(size, size, hotspot, hotspot, (ctx) => {
      ctx.fillStyle = '#ffcdd2';
      ctx.strokeStyle = '#c62828';
      ctx.lineWidth = 1.5 * scale;
      ctx.beginPath();
      ctx.moveTo(6 * scale, 14 * scale);
      ctx.lineTo(14 * scale, 6 * scale);
      ctx.lineTo(18 * scale, 10 * scale);
      ctx.lineTo(10 * scale, 18 * scale);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    })}, pointer`;
    return eraserCursorCss;
  }

  function getCursorForTool(tool) {
    switch (tool) {
      case 'slash':
        return buildSlashCursor();
      case 'transparentBox':
        return buildOutlineCursor();
      case 'eraser':
        return buildEraserCursor();
      case 'pointer':
      case 'colorBox':
      case 'label':
        return null;
      default:
        return null;
    }
  }

  function applyToolCursorToElement(el, tool, cursor) {
    if (!el) return;
    el.style.removeProperty('cursor');
    if (tool === 'label') {
      el.style.cursor = 'text';
    } else if (tool === 'colorBox') {
      el.style.cursor = 'none';
    } else if (cursor) {
      el.style.cursor = cursor;
    }
  }

  function syncCalendarToolCursor() {
    invalidateToolCursorCacheIfMetricsChanged();

    const tool = state.activeTool;
    const toolClass = TOOL_CLASS_BY_TOOL[tool];
    const cursor = getCursorForTool(tool);

    if (tool !== 'colorBox') {
      hideColorBoxPreview();
    } else {
      syncColorBoxPreviewStyle();
    }

    applyToolCursorToElement(document.querySelector('.calendar-column'), tool, cursor);

    if (!stackEl) return;

    stackEl.querySelectorAll('.month-grid').forEach((monthGrid) => {
      monthGrid.classList.remove(...TOOL_CURSOR_CLASSES);
      if (toolClass && tool === 'label') {
        monthGrid.classList.add(toolClass);
      }
      applyToolCursorToElement(monthGrid, tool, cursor);
    });
    stackEl.querySelectorAll('.days-grid-wrap').forEach((wrap) => {
      wrap.classList.remove(...TOOL_CURSOR_CLASSES);
      if (toolClass && tool !== 'label') {
        wrap.classList.add(toolClass);
      }
      applyToolCursorToElement(wrap, tool, cursor);
    });
  }

  function uuid() {
    return crypto.randomUUID ? crypto.randomUUID() : `g-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function setsEqual(a, b) {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((v, i) => v === sortedB[i]);
  }

  function normalizeHexColor(color) {
    if (!color || typeof color !== 'string') return DEFAULT_LABEL_STYLE.color;
    const hex = color.trim().replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{3}$/.test(hex)) {
      return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
    }
    if (/^[0-9a-f]{6}$/.test(hex)) {
      return `#${hex}`;
    }
    return DEFAULT_LABEL_STYLE.color;
  }

  function clampLabelStyle(style) {
    const raw = { ...DEFAULT_LABEL_STYLE, ...style };
    const size = Number(raw.size ?? raw.aboveSize ?? raw.belowSize) || DEFAULT_LABEL_STYLE.size;
    let weight = Number(raw.weight ?? raw.aboveWeight ?? raw.belowWeight) || DEFAULT_LABEL_STYLE.weight;
    weight = Math.round(weight / 100) * 100;
    return {
      size: clampLabelSize(size),
      weight: Math.min(900, Math.max(100, weight)),
      strokeWidth: Math.min(8, Math.max(0, Number(raw.strokeWidth) || 0)),
      color: normalizeHexColor(raw.color),
    };
  }

  function clampLabelSize(size) {
    const n = Number(size) || DEFAULT_LABEL_STYLE.size;
    return Math.min(40, Math.max(8, n));
  }

  function clampInteger(value, fallback, min, max) {
    if (value == null || value === '') return fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  function sanitizeViewState(target = state) {
    target.viewYear = clampInteger(target.viewYear, DEFAULT_VIEW_YEAR, 1900, 2100);
    target.viewMonth = clampInteger(target.viewMonth, DEFAULT_VIEW_MONTH, 1, 12);
    target.visibleMonthCount = clampInteger(
      target.visibleMonthCount,
      DEFAULT_VISIBLE_MONTH_COUNT,
      1,
      MAX_VISIBLE_MONTH_COUNT
    );
    return target;
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function asPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function sanitizeGroupList(groups) {
    return asArray(groups).map((group) => {
      const safeGroup = asPlainObject(group);
      return {
        ...safeGroup,
        dates: asArray(safeGroup.dates),
      };
    });
  }

  function sanitizeFloatingLabels(labels) {
    return asArray(labels).map((label) => asPlainObject(label));
  }

  function getFloatingLabelSize(label) {
    return clampLabelSize(label.size ?? state.labelStyle.size);
  }

  function applyLabelStyleToDom() {
    const s = state.labelStyle;
    stackEl.style.setProperty('--label-size', `${s.size}px`);
    stackEl.style.setProperty('--label-weight', String(s.weight));
    stackEl.style.setProperty('--user-label-stroke-width', `${s.strokeWidth}px`);
    if (editingFloatingLabelId) {
      const wrap = stackEl.querySelector(`.floating-label-wrap[data-id="${editingFloatingLabelId}"]`);
      const input = wrap?.querySelector('.floating-label-input');
      if (input) syncFloatingLabelInputWidth(input);
    }
  }

  function syncLabelStyleInputs() {
    inputLabelSize.value = state.labelStyle.size;
    inputLabelWeight.value = state.labelStyle.weight;
    inputLabelStrokeWidth.value = state.labelStyle.strokeWidth;
  }

  function updateLabelStyleFromInputs() {
    recordUndoBeforeChange();
    state.labelStyle = clampLabelStyle({
      size: inputLabelSize.value,
      weight: inputLabelWeight.value,
      strokeWidth: inputLabelStrokeWidth.value,
    });
    syncLabelStyleInputs();
    applyLabelStyleToDom();
    saveSession();
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getSnapshot() {
    return {
      viewYear: state.viewYear,
      viewMonth: state.viewMonth,
      visibleMonthCount: state.visibleMonthCount,
      labelStyle: { ...state.labelStyle },
      slashes: deepClone(state.slashes),
      colorGroups: deepClone(state.colorGroups),
      outlineGroups: deepClone(state.outlineGroups),
      floatingLabels: deepClone(state.floatingLabels),
      labelCoordSpace: state.labelCoordSpace,
    };
  }

  /** 저장 비교용 — 글자 스타일·날짜 순서 등을 맞춰 실제 내용만 비교 */
  function normalizeSnapshot(data) {
    const copy = data ? deepClone(data) : {};
    const view = sanitizeViewState({
      viewYear: copy.viewYear ?? state.viewYear,
      viewMonth: copy.viewMonth ?? state.viewMonth,
      visibleMonthCount: copy.visibleMonthCount ?? state.visibleMonthCount,
    });
    const sortDates = (groups) =>
      sanitizeGroupList(groups).map((g) => ({
        ...g,
        dates: [...g.dates].sort(),
      }));

    return {
      viewYear: view.viewYear,
      viewMonth: view.viewMonth,
      visibleMonthCount: view.visibleMonthCount,
      labelStyle: clampLabelStyle(copy.labelStyle || {}),
      slashes: asPlainObject(copy.slashes),
      colorGroups: sortDates(copy.colorGroups),
      outlineGroups: sortDates(copy.outlineGroups),
      floatingLabels: sanitizeFloatingLabels(copy.floatingLabels).map((l) => ({
        ...l,
        x: clamp01(Number(l.x) || 0),
        y: clamp01(Number(l.y) || 0),
        size: clampLabelSize(l.size),
      })),
    };
  }

  function applySnapshot(data) {
    if (!data) return;
    const d = deepClone(data);
    if (d.viewYear != null) state.viewYear = d.viewYear;
    if (d.viewMonth != null) state.viewMonth = d.viewMonth;
    if (d.visibleMonthCount != null) {
      state.visibleMonthCount = d.visibleMonthCount;
    }
    sanitizeViewState();
    state.labelStyle = clampLabelStyle(d.labelStyle || state.labelStyle);
    state.slashes = asPlainObject(d.slashes);
    state.colorGroups = sanitizeGroupList(d.colorGroups);
    state.outlineGroups = sanitizeGroupList(d.outlineGroups);
    state.floatingLabels = sanitizeFloatingLabels(d.floatingLabels);
    if (d.labelCoordSpace === 'area') {
      state.labelCoordSpace = 'area';
    } else {
      state.labelCoordSpace = 'grid';
    }
    migrateLegacyLabels(d.dateLabels);
    migrateLegacySlashes();
    migrateFloatingLabelsToAreaCoords();
    normalizeLabelStyle();
    normalizeSlashLabelSizes();
    normalizeManualLabelSizes();
    syncAllSlashLabels();
  }

  function normalizeLabelStyle() {
    if (
      state.labelStyle.size === LEGACY_LABEL_FONT_SIZE ||
      state.labelStyle.size === PREVIOUS_DEFAULT_LABEL_SIZE
    ) {
      state.labelStyle.size = DEFAULT_LABEL_STYLE.size;
    }
    if (state.labelStyle.strokeWidth === PREVIOUS_DEFAULT_LABEL_STROKE) {
      state.labelStyle.strokeWidth = DEFAULT_LABEL_STYLE.strokeWidth;
    }
  }

  function normalizeSlashLabelSizes() {
    const slashLabels = new Set(['공휴일', '수업연기']);
    state.floatingLabels.forEach((label) => {
      if (slashLabels.has(label.text)) {
        label.size = SLASH_LABEL_FONT_SIZE;
      }
    });
  }

  function normalizeManualLabelSizes() {
    const slashLabels = new Set(['공휴일', '수업연기']);
    state.floatingLabels.forEach((label) => {
      if (
        !slashLabels.has(label.text) &&
        (label.size === LEGACY_LABEL_FONT_SIZE || label.size === PREVIOUS_DEFAULT_LABEL_SIZE)
      ) {
        label.size = DEFAULT_LABEL_STYLE.size;
      }
    });
  }

  function collectDateGridPositions(key, placement) {
    const [y, m, d] = key.split('-').map(Number);
    const rowFrac = placement === 'below' ? 0.85 : 0.15;
    const positions = [];
    const seen = new Set();

    const addPosition = (panelYear, panelMonth, gridPos) => {
      const panel = panelKey(panelYear, panelMonth);
      const x = (gridPos.col + 0.5) / 7;
      const yPos = (gridPos.row + rowFrac) / gridPos.weekCount;
      const sig = `${panel}|${x.toFixed(3)}|${yPos.toFixed(3)}`;
      if (seen.has(sig)) return;
      seen.add(sig);
      positions.push({ panel, x, y: yPos });
    };

    for (let i = 0; i < state.visibleMonthCount; i++) {
      const { year, month } = addMonths(state.viewYear, state.viewMonth, i);
      const hasNextPanel = i < state.visibleMonthCount - 1;
      const gridPos = findDateInMonthGrid(y, m, d, year, month, hasNextPanel);
      if (gridPos) addPosition(year, month, gridPos);
    }

    const fallbackPanels = [
      { year: y, month: m },
      addMonths(y, m, -1),
      addMonths(y, m, 1),
    ];
    for (const { year, month } of fallbackPanels) {
      const gridPos = findDateInMonthGrid(y, m, d, year, month, false);
      if (gridPos) addPosition(year, month, gridPos);
    }

    return positions;
  }

  function dateKeyToGridFraction(key, placement) {
    return collectDateGridPositions(key, placement)[0] || null;
  }

  function normalizeSlashMode(mode) {
    if (mode === 'holiday' || mode === 'postpone' || mode === 'plain') return mode;
    return 'plain';
  }

  function getWeekCountForPanelKey(key) {
    const [year, month] = key.split('-').map(Number);
    let hasNextPanel = false;
    for (let i = 0; i < state.visibleMonthCount; i++) {
      const vm = addMonths(state.viewYear, state.viewMonth, i);
      if (panelKey(vm.year, vm.month) === key) {
        hasNextPanel = i < state.visibleMonthCount - 1;
        break;
      }
    }
    let cells = buildMonthCells(year, month);
    cells = trimTrailingWeekWhenNextPanelVisible(cells, hasNextPanel);
    return cells.length / 7;
  }

  function getLabelAreaHeaderHeight(layout) {
    return layout.titleFont + layout.titleGap + layout.weekdaysFont + layout.weekdaysGap;
  }

  function gridFractionYToAreaY(yGrid, weekCount, layout) {
    const headerH = getLabelAreaHeaderHeight(layout);
    const gridH = weekCount * layout.cellH;
    const areaH = headerH + gridH;
    if (areaH <= 0) return clamp01(yGrid);
    return clamp01((headerH + yGrid * gridH) / areaH);
  }

  function migrateFloatingLabelsToAreaCoords() {
    if (state.labelCoordSpace === 'area') return;
    const layout = getPngExportLayout();
    state.floatingLabels.forEach((label) => {
      const weekCount = getWeekCountForPanelKey(label.panel);
      label.y = gridFractionYToAreaY(Number(label.y) || 0, weekCount, layout);
    });
    state.labelCoordSpace = 'area';
  }

  function getSlashLabelPosition(dateKey) {
    const pos = dateKeyToGridFraction(dateKey, 'below');
    if (!pos) return null;
    const layout = getPngExportLayout();
    const weekCount = getWeekCountForPanelKey(pos.panel);
    return {
      ...pos,
      y: gridFractionYToAreaY(pos.y, weekCount, layout),
    };
  }

  function isSlashLabelAtDate(label, dateKey) {
    const pos = getSlashLabelPosition(dateKey);
    if (!pos || !SLASH_LABEL_TEXTS.has(label.text)) return false;
    return (
      label.panel === pos.panel &&
      Math.abs(label.x - pos.x) < SLASH_LABEL_MATCH_EPS &&
      Math.abs(label.y - pos.y) < SLASH_LABEL_MATCH_EPS
    );
  }

  function getSlashLabelsForDate(dateKey) {
    return state.floatingLabels.filter((label) => isSlashLabelAtDate(label, dateKey));
  }

  function removeSlashLabelsForDate(dateKey) {
    const layout = getPngExportLayout();
    const positions = collectDateGridPositions(dateKey, 'below').map((pos) => ({
      ...pos,
      y: gridFractionYToAreaY(pos.y, getWeekCountForPanelKey(pos.panel), layout),
    }));
    state.floatingLabels = state.floatingLabels.filter((label) => {
      if (!SLASH_LABEL_TEXTS.has(label.text)) return true;
      return !positions.some(
        (pos) =>
          label.panel === pos.panel &&
          Math.abs(label.x - pos.x) < SLASH_LABEL_MATCH_EPS &&
          Math.abs(label.y - pos.y) < SLASH_LABEL_MATCH_EPS
      );
    });
  }

  function ensureSlashLabelAtDate(dateKey, text) {
    const pos = getSlashLabelPosition(dateKey);
    if (!pos) return;

    const existing = getSlashLabelsForDate(dateKey).find((label) => label.text === text);
    if (existing) {
      existing.size = SLASH_LABEL_FONT_SIZE;
      existing.color = '#111';
      return;
    }

    state.floatingLabels.push({
      id: uuid(),
      panel: pos.panel,
      x: pos.x,
      y: pos.y,
      text,
      color: '#111',
      size: SLASH_LABEL_FONT_SIZE,
    });
  }

  function syncSlashLabelForDate(dateKey, mode) {
    const normalizedMode = normalizeSlashMode(mode);
    if (normalizedMode === 'plain') {
      removeSlashLabelsForDate(dateKey);
      return;
    }

    const targetText = SLASH_MODE_LABELS[normalizedMode];
    removeSlashLabelsForDate(dateKey);
    ensureSlashLabelAtDate(dateKey, targetText);
  }

  function inferSlashModeFromLabels(dateKey) {
    const labels = getSlashLabelsForDate(dateKey);
    if (labels.some((label) => label.text === SLASH_MODE_LABELS.holiday)) return 'holiday';
    if (labels.some((label) => label.text === SLASH_MODE_LABELS.postpone)) return 'postpone';
    return 'plain';
  }

  function migrateLegacySlashes() {
    Object.entries(state.slashes).forEach(([key, slash]) => {
      if (!slash || typeof slash !== 'object') {
        state.slashes[key] = { mode: 'plain' };
        return;
      }

      if (slash.mode) {
        slash.mode = normalizeSlashMode(slash.mode);
        return;
      }

      if (slash.label) {
        const textToMode = {
          [SLASH_MODE_LABELS.holiday]: 'holiday',
          [SLASH_MODE_LABELS.postpone]: 'postpone',
        };
        slash.mode = textToMode[slash.label] || 'plain';
        delete slash.label;
        return;
      }

      slash.mode = inferSlashModeFromLabels(key);
    });
  }

  function syncAllSlashLabels() {
    state.floatingLabels = state.floatingLabels.filter(
      (label) => !SLASH_LABEL_TEXTS.has(label.text)
    );
    Object.entries(state.slashes).forEach(([key, slash]) => {
      if (slash && slash.mode && slash.mode !== 'plain') {
        ensureSlashLabelAtDate(key, SLASH_MODE_LABELS[normalizeSlashMode(slash.mode)]);
      }
    });
  }

  function addFloatingLabelFromLegacy(key, text, placement, color, size) {
    if (!text) return;
    const pos = dateKeyToGridFraction(key, placement || 'above');
    if (!pos) return;
    const exists = state.floatingLabels.some(
      (l) => l.panel === pos.panel && l.text === text && Math.abs(l.x - pos.x) < 0.05
    );
    if (exists) return;
    state.floatingLabels.push({
      id: uuid(),
      panel: pos.panel,
      x: pos.x,
      y: pos.y,
      text,
      color: color || '#111',
      size: size ?? state.labelStyle.size,
    });
  }

  function migrateLegacyLabels(legacyDateLabels) {
    const pending = [];

    Object.entries(legacyDateLabels || {}).forEach(([key, dl]) => {
      if (dl && dl.text) {
        pending.push({
          key,
          text: dl.text,
          placement: dl.placement || 'above',
          color: dl.color,
        });
      }
    });

    Object.entries(state.slashes).forEach(([key, slash]) => {
      if (slash && slash.label) {
        pending.push({ key, text: slash.label, placement: 'below', color: '#111' });
        delete slash.label;
      }
    });

    state.colorGroups.forEach((group) => {
      if (!group.label) return;
      const firstDate = [...group.dates].sort()[0];
      if (firstDate) {
        pending.push({
          key: firstDate,
          text: group.label,
          placement: 'above',
          color: group.borderColor || '#111',
        });
      }
      delete group.label;
    });

    state.outlineGroups.forEach((group) => {
      if (!group.label) return;
      const firstDate = [...group.dates].sort()[0];
      if (firstDate) {
        pending.push({
          key: firstDate,
          text: group.label,
          placement: 'above',
          color: group.borderColor || '#111',
        });
      }
      delete group.label;
    });

    pending.forEach((item) => {
      addFloatingLabelFromLegacy(item.key, item.text, item.placement, item.color);
    });
  }

  function loadSession() {
    try {
      let raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data._activeSaveId != null) {
          const exists = savesMeta.saves.some((s) => s.id === data._activeSaveId);
          activeSaveId = exists ? data._activeSaveId : null;
          delete data._activeSaveId;
        }
        applySnapshot(data);
        saveSession();
        return;
      }

      raw = localStorage.getItem(STORAGE_KEY_LEGACY);
      if (!raw) raw = localStorage.getItem(STORAGE_KEY_V1);
      if (raw) {
        const data = JSON.parse(raw);
        applySnapshot({
          slashes: data.slashes,
          colorGroups: data.colorGroups,
          outlineGroups: data.outlineGroups,
        });
        saveSession();
      }
    } catch (_) {
      /* ignore */
    }
  }

  function saveSession() {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ ...getSnapshot(), _activeSaveId: activeSaveId })
    );
  }

  function loadSavesMeta() {
    try {
      const raw = localStorage.getItem(SAVES_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.maxSaves != null) {
        savesMeta.maxSaves = clampInteger(data.maxSaves, DEFAULT_MAX_SAVES, 1, 500);
      }
      if (Array.isArray(data.saves)) {
        savesMeta.saves = data.saves;
      }
    } catch (_) {
      /* ignore */
    }
  }

  function saveSavesMeta() {
    localStorage.setItem(
      SAVES_KEY,
      JSON.stringify({
        maxSaves: savesMeta.maxSaves,
        saves: savesMeta.saves,
      })
    );
  }

  function trimSavesToMax() {
    while (savesMeta.saves.length > savesMeta.maxSaves) {
      savesMeta.saves.sort((a, b) => new Date(a.savedAt) - new Date(b.savedAt));
      const removed = savesMeta.saves.shift();
      if (removed && removed.id === activeSaveId) activeSaveId = null;
    }
  }

  function formatSavedAtDate(iso) {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    return `${y}-${m}-${day}`;
  }

  function updateSortIcons() {
    ['date', 'name'].forEach((field) => {
      const icon = document.getElementById(`sort-icon-${field}`);
      if (!icon) return;
      if (historyUi.sort.field === field) {
        icon.textContent = historyUi.sort.dir === 'asc' ? '▲' : '▼';
        icon.classList.add('active');
      } else {
        icon.textContent = '⇅';
        icon.classList.remove('active');
      }
    });
  }

  function getFilteredSortedSaves() {
    const q = historyUi.search.trim().toLowerCase();
    let list = [...savesMeta.saves];
    if (q) {
      list = list.filter((entry) => entry.name.toLowerCase().includes(q));
    }
    const { field, dir } = historyUi.sort;
    const sign = dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (field === 'name') {
        return sign * a.name.localeCompare(b.name, 'ko');
      }
      return sign * (new Date(a.savedAt) - new Date(b.savedAt));
    });
    return list;
  }

  function renderHistoryTable() {
    saveCounterEl.textContent = `${savesMeta.saves.length} / ${savesMeta.maxSaves}`;
    inputMaxSaves.value = savesMeta.maxSaves;
    if (inputHistorySearch && inputHistorySearch.value !== historyUi.search) {
      inputHistorySearch.value = historyUi.search;
    }
    historyTbody.innerHTML = '';
    updateSortIcons();

    const list = getFilteredSortedSaves();
    if (list.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="3" class="history-empty">${
        savesMeta.saves.length === 0 ? '저장된 항목이 없습니다' : '검색 결과가 없습니다'
      }</td>`;
      historyTbody.appendChild(tr);
      return;
    }

    list.forEach((entry) => {
      const tr = document.createElement('tr');
      tr.className = 'history-row';
      if (entry.id === activeSaveId) tr.classList.add('active');
      tr.dataset.id = entry.id;
      tr.innerHTML = `
        <td class="history-date">${formatSavedAtDate(entry.savedAt)}</td>
        <td><button type="button" class="history-name" data-id="${entry.id}">${escapeHtml(entry.name)}</button></td>
        <td class="col-delete"><button type="button" class="history-delete-btn" data-id="${entry.id}" aria-label="삭제">✕</button></td>
      `;
      historyTbody.appendChild(tr);
    });
  }

  function deleteSaveCore(id) {
    savesMeta.saves = savesMeta.saves.filter((s) => s.id !== id);
    if (activeSaveId === id) activeSaveId = null;
    saveSavesMeta();
    saveSession();
    renderHistoryTable();
  }

  function openDeleteDialog(id) {
    const entry = savesMeta.saves.find((s) => s.id === id);
    if (!entry) return;
    if (id !== activeSaveId) {
      deleteSaveCore(id);
      return;
    }
    pendingDeleteId = id;
    if (deleteDialogMessage) {
      deleteDialogMessage.textContent = `「${entry.name}」 항목을 삭제하시겠습니까?`;
    }
    deleteDialog.showModal();
  }

  function closeDeleteDialog(confirmed) {
    deleteDialog.close();
    if (confirmed && pendingDeleteId) {
      deleteSaveCore(pendingDeleteId);
    }
    pendingDeleteId = null;
  }

  function isUpdateNewsDismissed() {
    try {
      return localStorage.getItem(UPDATE_NEWS_DISMISS_KEY) === UPDATE_NEWS_VERSION;
    } catch (_) {
      return false;
    }
  }

  function dismissUpdateNews() {
    try {
      localStorage.setItem(UPDATE_NEWS_DISMISS_KEY, UPDATE_NEWS_VERSION);
    } catch (_) {
      /* ignore */
    }
  }

  function closeUpdateNewsDialog() {
    if (!updateNewsDialog) return;
    if (updateNewsDismissCheckbox?.checked) {
      dismissUpdateNews();
    }
    updateNewsDialog.close();
    if (updateNewsDismissCheckbox) {
      updateNewsDismissCheckbox.checked = false;
    }
  }

  function showUpdateNewsDialogIfNeeded() {
    if (!updateNewsDialog || isUpdateNewsDismissed()) return;
    updateNewsDialog.showModal();
  }

  function bindUpdateNewsDialog() {
    if (!updateNewsDialog) return;
    const closeBtn = document.getElementById('btn-update-news-close');
    closeBtn?.addEventListener('click', closeUpdateNewsDialog);
    updateNewsDialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      closeUpdateNewsDialog();
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function snapshotsEqual(a, b) {
    return (
      JSON.stringify(normalizeSnapshot(a)) === JSON.stringify(normalizeSnapshot(b))
    );
  }

  function updateUndoRedoButtons() {
    if (btnUndo) btnUndo.disabled = undoStack.length === 0;
    if (btnRedo) btnRedo.disabled = redoStack.length === 0;
  }

  function recordUndoBeforeChange() {
    if (isApplyingHistory) return;
    const snap = getSnapshot();
    const last = undoStack[undoStack.length - 1];
    if (last && snapshotsEqual(last, snap)) return;
    undoStack.push(snap);
    redoStack.length = 0;
    updateUndoRedoButtons();
  }

  function resetUndoRedoHistory() {
    undoStack.length = 0;
    redoStack.length = 0;
    updateUndoRedoButtons();
  }

  function undo() {
    if (undoStack.length === 0) return;
    isApplyingHistory = true;
    redoStack.push(getSnapshot());
    applySnapshot(undoStack.pop());
    saveSession();
    render();
    isApplyingHistory = false;
    updateUndoRedoButtons();
  }

  function redo() {
    if (redoStack.length === 0) return;
    isApplyingHistory = true;
    undoStack.push(getSnapshot());
    applySnapshot(redoStack.pop());
    saveSession();
    render();
    isApplyingHistory = false;
    updateUndoRedoButtons();
  }

  function shouldIgnoreUndoShortcut(e) {
    const el = e.target;
    if (!el || !el.closest) return false;
    if (el.closest('.floating-label-input')) return true;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function shouldIgnoreToolShortcut(e) {
    if (shouldIgnoreUndoShortcut(e)) return true;
    if (e.ctrlKey || e.altKey || e.metaKey) return true;
    if (saveDialog?.open || unsavedDialog?.open || deleteDialog?.open || updateNewsDialog?.open) return true;
    return false;
  }

  function selectTool(tool) {
    if (tool !== state.activeTool) {
      markMoveDrag = null;
      markMoveDropTargetKey = null;
      clearMarkMovePreview();
    }
    state.activeTool = tool;
    if (tool !== 'colorBox') {
      hideColorBoxPreview();
    }
    updateToolbar();
  }

  function cycleNext(items, current, normalize = (value) => value) {
    if (items.length === 0) return current;
    const normalizedCurrent = normalize(current);
    const index = items.findIndex((item) => normalize(item) === normalizedCurrent);
    const nextIndex = index < 0 ? 0 : (index + 1) % items.length;
    return items[nextIndex];
  }

  function getColorBoxSwatchColors() {
    if (!colorOptions) return [];
    return Array.from(colorOptions.querySelectorAll('.swatch[data-color]'), (btn) => btn.dataset.color);
  }

  function handleToolShortcut(tool) {
    if (tool === 'colorBox' && state.activeTool === 'colorBox') {
      const colors = getColorBoxSwatchColors();
      if (colors.length === 0) return;
      const nextColor = cycleNext(colors, getActivePickerColor(), normalizeHexColor);
      setActivePickerColor(nextColor);
      inputColor.value = nextColor;
      updateToolbar();
      return;
    }

    if (tool === 'slash' && state.activeTool === 'slash') {
      state.slashMode = cycleNext(SLASH_MODES, state.slashMode, normalizeSlashMode);
      updateToolbar();
      return;
    }

    if (tool === 'label' && state.activeTool === 'label') {
      const nextColor = cycleNext(LABEL_TEXT_COLORS, getDisplayedLabelColor(), normalizeHexColor);
      applyLabelColor(nextColor);
      return;
    }

    selectTool(tool);
  }

  function hasUnsavedChanges() {
    if (!activeSaveId) return false;
    const entry = savesMeta.saves.find((s) => s.id === activeSaveId);
    if (!entry) return false;
    return !snapshotsEqual(getSnapshot(), entry.data);
  }

  function updateActiveSave() {
    const entry = savesMeta.saves.find((s) => s.id === activeSaveId);
    if (!entry) return;
    entry.data = getSnapshot();
    entry.savedAt = new Date().toISOString();
    saveSavesMeta();
    renderHistoryTable();
  }

  function showUnsavedDialog() {
    return new Promise((resolve) => {
      unsavedResolve = resolve;
      unsavedDialog.showModal();
    });
  }

  function closeUnsavedDialog(result) {
    unsavedDialog.close();
    if (unsavedResolve) {
      unsavedResolve(result);
      unsavedResolve = null;
    }
  }

  async function confirmUnsavedChangesThen(proceed) {
    if (!hasUnsavedChanges()) {
      proceed();
      return;
    }
    const choice = await showUnsavedDialog();
    if (choice === 'cancel') return;
    if (choice === 'save') {
      updateActiveSave();
      saveSession();
    }
    proceed();
  }

  function namedSave(name) {
    const entry = {
      id: uuid(),
      name,
      savedAt: new Date().toISOString(),
      data: getSnapshot(),
    };
    savesMeta.saves.push(entry);
    trimSavesToMax();
    activeSaveId = entry.id;
    saveSavesMeta();
    renderHistoryTable();
  }

  function loadNamedSaveCore(id) {
    const entry = savesMeta.saves.find((s) => s.id === id);
    if (!entry) return;
    applySnapshot(entry.data);
    activeSaveId = id;
    entry.data = getSnapshot();
    saveSavesMeta();
    saveSession();
    render();
    renderHistoryTable();
    resetUndoRedoHistory();
  }

  function loadNamedSave(id) {
    if (id === activeSaveId) return;
    confirmUnsavedChangesThen(() => loadNamedSaveCore(id));
  }

  let pendingPngBlob = null;

  function getDefaultSaveBaseName() {
    if (activeSaveId) {
      const entry = savesMeta.saves.find((s) => s.id === activeSaveId);
      if (entry?.name) return entry.name;
    }
    return `${state.viewYear}년 ${state.viewMonth}월 일정`;
  }

  function stripPngExtension(name) {
    return String(name).replace(/\.png$/i, '').trim();
  }

  function sanitizeFileBaseName(name) {
    const cleaned = String(name).replace(/[<>:"/\\|?*]/g, '_').trim();
    return cleaned || getDefaultSaveBaseName();
  }

  function getPngExportLayout() {
    const scale = getCalendarScale();
    const m = readToolMarkMetrics();
    let cellW = 52 * scale;
    let cellH = 58 * scale;
    let cardPadX = 15 * scale;
    let cardWidth = cellW * 7 + cardPadX * 2;
    let cardPadTop = 20 * scale;
    let cardPadBottom = 12 * scale;
    let titleFont = 20;
    let titleGap = 30 * scale;
    let weekdaysFont = 20;
    let weekdaysGap = 6 * scale;
    let textSize = 16 * scale;
    let panelMargin = 12 * scale;

    const panel = stackEl?.querySelector('.month-panel');
    const card = panel?.querySelector('.month-card');
    const cell = panel?.querySelector('.day-cell');
    const titleEl = panel?.querySelector('.month-title');
    const weekdaysEl = panel?.querySelector('.weekdays');
    const dayNumberEl = panel?.querySelector('.day-number');

    if (cell) {
      const cellRect = cell.getBoundingClientRect();
      if (cellRect.width > 0) cellW = cellRect.width;
      if (cellRect.height > 0) cellH = cellRect.height;
    }
    if (card) {
      const cardRect = card.getBoundingClientRect();
      if (cardRect.width > 0) cardWidth = cardRect.width;
      const cardStyle = getComputedStyle(card);
      cardPadTop = parsePx(cardStyle.paddingTop, cardPadTop);
      cardPadBottom = parsePx(cardStyle.paddingBottom, cardPadBottom);
      cardPadX = parsePx(cardStyle.paddingLeft, cardPadX);
    }
    if (titleEl) {
      const titleStyle = getComputedStyle(titleEl);
      titleFont = parsePx(titleStyle.fontSize, titleFont);
      titleGap = parsePx(titleStyle.marginBottom, titleGap);
    }
    if (weekdaysEl) {
      const weekdaysStyle = getComputedStyle(weekdaysEl);
      weekdaysFont = parsePx(weekdaysStyle.fontSize, weekdaysFont);
      weekdaysGap = parsePx(weekdaysStyle.marginBottom, weekdaysGap);
    }
    if (dayNumberEl) {
      textSize = parsePx(getComputedStyle(dayNumberEl).fontSize, textSize);
    }
    const panels = stackEl?.querySelectorAll('.month-panel');
    if (panels && panels.length > 1) {
      const firstCard = panels[0]?.querySelector('.month-card');
      const secondCard = panels[1]?.querySelector('.month-card');
      if (firstCard && secondCard) {
        const gap = secondCard.getBoundingClientRect().top - firstCard.getBoundingClientRect().bottom;
        if (gap > 0) panelMargin = gap;
      }
    }

    return {
      scale,
      cellW,
      cellH,
      calendarWidth: cellW * 7,
      cardPadX,
      cardWidth,
      cardPadTop,
      cardPadBottom,
      titleFont,
      titleGap,
      weekdaysFont,
      weekdaysGap,
      textSize,
      markBox: m.boxSize,
      markBoxBorder: PNG_EXPORT_BORDER_PX,
      markBoxRadius: m.boxRadius,
      slashLine: m.slashLine,
      outlinePadX: 4,
      outlinePadY: 6,
      outlineBorder: PNG_EXPORT_BORDER_PX,
      panelMargin,
      pixelRatio: 2,
    };
  }

  function getColorGroupFromSnapshot(snap, key) {
    return snap.colorGroups.find((g) => g.dates.includes(key)) || null;
  }

  function getOutlineGroupFromSnapshot(snap, key) {
    return snap.outlineGroups.find((g) => g.dates.includes(key)) || null;
  }

  function slashModeFromSnapshot(snap, key) {
    const slash = snap.slashes[key];
    if (!slash || typeof slash !== 'object') return 'plain';
    return normalizeSlashMode(slash.mode);
  }

  function hasVisibleSlash(snap, key) {
    const mode = slashModeFromSnapshot(snap, key);
    return mode !== 'plain';
  }

  function measureMonthPanelHeight(layout, weekCount) {
    return (
      layout.cardPadTop +
      layout.cardPadBottom +
      layout.titleFont +
      layout.titleGap +
      layout.weekdaysFont +
      layout.weekdaysGap +
      weekCount * layout.cellH
    );
  }

  function drawSlashInRect(ctx, x, y, w, h, lineWidth) {
    ctx.save();
    ctx.fillStyle = '#333';
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(-Math.PI / 4);
    ctx.fillRect(-w / 2, -lineWidth / 2, w, lineWidth);
    ctx.restore();
  }

  function drawStrokedLabelText(ctx, text, x, y, fontSize, fontWeight, fillColor, strokeWidth) {
    const font = `${fontWeight} ${fontSize}px "BM JUA", "Malgun Gothic", sans-serif`;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (strokeWidth > 0) {
      ctx.lineWidth = strokeWidth;
      ctx.strokeStyle = '#fff';
      ctx.lineJoin = 'round';
      ctx.strokeText(text, x, y);
    }
    ctx.fillStyle = fillColor;
    ctx.fillText(text, x, y);
  }

  function getSlashDrawRect(cellX, cellY, layout) {
    const boxX = cellX + (layout.cellW - layout.markBox) / 2;
    const boxY = cellY + (layout.cellH - layout.markBox) / 2;
    return { x: boxX, y: boxY, w: layout.markBox, h: layout.markBox };
  }

  function drawMonthPanelToCanvas(ctx, snap, year, month, hasNextPanel, originX, originY, layout) {
    let cells = buildMonthCells(year, month);
    cells = trimTrailingWeekWhenNextPanelVisible(cells, hasNextPanel);
    const weekCount = cells.length / 7;
    const panelMaps = buildPanelGridMaps(cells);
    const panelHeight = measureMonthPanelHeight(layout, weekCount);
    const gridTop =
      originY + layout.cardPadTop + layout.titleFont + layout.titleGap + layout.weekdaysFont + layout.weekdaysGap;
    const gridLeft = originX + layout.cardPadX;

    ctx.fillStyle = '#fff';
    ctx.fillRect(originX, originY, layout.cardWidth, panelHeight);
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    ctx.strokeRect(originX + 0.5, originY + 0.5, layout.cardWidth - 1, panelHeight - 1);

    ctx.fillStyle = '#111';
    ctx.font = `700 ${layout.titleFont}px "Malgun Gothic", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const titleX = gridLeft + (layout.cellW - layout.textSize) / 2;
    ctx.fillText(`${year}년 ${month}월`, titleX, originY + layout.cardPadTop);

    ctx.font = `700 ${layout.weekdaysFont}px "Malgun Gothic", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const weekdaysY = originY + layout.cardPadTop + layout.titleFont + layout.titleGap;
    WEEKDAYS.forEach((label, i) => {
      ctx.fillText(label, gridLeft + i * layout.cellW + layout.cellW / 2, weekdaysY);
    });

    cells.forEach((cell, index) => {
      const row = Math.floor(index / 7);
      const col = index % 7;
      const key = dateKey(cell.year, cell.month, cell.day);
      const cellX = gridLeft + col * layout.cellW;
      const cellY = gridTop + row * layout.cellH;
      const colorGroup = getColorGroupFromSnapshot(snap, key);
      const hasOutline = Boolean(getOutlineGroupFromSnapshot(snap, key) && panelMaps.keyToPos[key]);

      if (colorGroup) {
        const boxX = cellX + (layout.cellW - layout.markBox) / 2;
        const boxY = cellY + (layout.cellH - layout.markBox) / 2;
        ctx.fillStyle = colorGroup.color;
        pathRoundRect(ctx, boxX, boxY, layout.markBox, layout.markBox, layout.markBoxRadius);
        ctx.fill();
        ctx.strokeStyle = colorGroup.borderColor || darkenColor(colorGroup.color, 40);
        ctx.lineWidth = layout.markBoxBorder;
        ctx.stroke();
      }

      let numberColor = '#111';
      if (!cell.isCurrentMonth) {
        numberColor = colorGroup ? '#929292' : '#d0d0d0';
      }
      ctx.fillStyle = numberColor;
      ctx.font = `400 ${layout.textSize}px "Malgun Gothic", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(cell.day), cellX + layout.cellW / 2, cellY + layout.cellH / 2);

      if (hasVisibleSlash(snap, key)) {
        const slashRect = getSlashDrawRect(cellX, cellY, layout);
        drawSlashInRect(ctx, slashRect.x, slashRect.y, slashRect.w, slashRect.h, layout.slashLine);
      }
    });

    snap.outlineGroups.forEach((group) => {
      getConnectedComponentsInPanel(group.dates, panelMaps).forEach((component) => {
        let minR = Infinity;
        let maxR = -1;
        let minC = Infinity;
        let maxC = -1;
        component.forEach((key) => {
          const { row, col } = panelMaps.keyToPos[key];
          minR = Math.min(minR, row);
          maxR = Math.max(maxR, row);
          minC = Math.min(minC, col);
          maxC = Math.max(maxC, col);
        });
        const x = gridLeft + minC * layout.cellW + layout.outlinePadX;
        const y = gridTop + minR * layout.cellH + layout.outlinePadY;
        const w = (maxC - minC + 1) * layout.cellW - layout.outlinePadX * 2;
        const h = (maxR - minR + 1) * layout.cellH - layout.outlinePadY * 2;
        ctx.strokeStyle = group.borderColor || OUTLINE_BORDER_COLOR;
        ctx.lineWidth = layout.outlineBorder;
        pathRoundRect(ctx, x, y, w, h, 4);
        ctx.stroke();
      });
    });

    const panelKeyStr = panelKey(year, month);
    const labelAreaTop = originY + layout.cardPadTop;
    const labelAreaH =
      layout.titleFont +
      layout.titleGap +
      layout.weekdaysFont +
      layout.weekdaysGap +
      weekCount * layout.cellH;
    snap.floatingLabels
      .filter((label) => label.panel === panelKeyStr && label.text)
      .forEach((label) => {
        const x = gridLeft + clamp01(Number(label.x) || 0) * layout.calendarWidth;
        const y = labelAreaTop + clamp01(Number(label.y) || 0) * labelAreaH;
        const fontSize = clampLabelSize(label.size ?? snap.labelStyle.size);
        const fontWeight = snap.labelStyle.weight;
        const fillColor = normalizeHexColor(label.color);
        drawStrokedLabelText(
          ctx,
          label.text,
          x,
          y,
          fontSize,
          fontWeight,
          fillColor,
          PNG_EXPORT_LABEL_STROKE_PX
        );
      });

    return panelHeight;
  }

  function renderSnapshotToPng(snapshot) {
    const snap = normalizeSnapshot(snapshot);
    const layout = getPngExportLayout();
    const view = sanitizeViewState({
      viewYear: snap.viewYear,
      viewMonth: snap.viewMonth,
      visibleMonthCount: snap.visibleMonthCount,
    });

    let totalHeight = 0;
    const panelHeights = [];
    for (let i = 0; i < view.visibleMonthCount; i++) {
      const { year, month } = addMonths(view.viewYear, view.viewMonth, i);
      const hasNextPanel = i < view.visibleMonthCount - 1;
      let cells = buildMonthCells(year, month);
      cells = trimTrailingWeekWhenNextPanelVisible(cells, hasNextPanel);
      const weekCount = cells.length / 7;
      const h = measureMonthPanelHeight(layout, weekCount);
      panelHeights.push(h);
      totalHeight += h;
      if (i < view.visibleMonthCount - 1) {
        totalHeight += layout.panelMargin;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(layout.cardWidth * layout.pixelRatio);
    canvas.height = Math.ceil(totalHeight * layout.pixelRatio);
    const ctx = canvas.getContext('2d');
    ctx.scale(layout.pixelRatio, layout.pixelRatio);
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, layout.cardWidth, totalHeight);

    let y = 0;
    for (let i = 0; i < view.visibleMonthCount; i++) {
      const { year, month } = addMonths(view.viewYear, view.viewMonth, i);
      const hasNextPanel = i < view.visibleMonthCount - 1;
      y += drawMonthPanelToCanvas(ctx, snap, year, month, hasNextPanel, 0, y, layout);
      if (hasNextPanel) y += layout.panelMargin;
    }

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('PNG 생성 실패'));
      }, 'image/png');
    });
  }

  function saveHistoryBeforePng() {
    if (activeSaveId) {
      updateActiveSave();
    } else {
      namedSave(sanitizeFileBaseName(getDefaultSaveBaseName()));
    }
    saveSession();
  }

  async function writePngWithPicker(blob, suggestedBaseName) {
    const base = sanitizeFileBaseName(suggestedBaseName);
    const handle = await window.showSaveFilePicker({
      suggestedName: `${base}.png`,
      startIn: 'desktop',
      id: 'calendar-schedule-save',
      types: [
        {
          description: 'PNG 이미지',
          accept: { 'image/png': ['.png'] },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return stripPngExtension(handle.name || `${base}.png`);
  }

  function downloadPngBlob(blob, fileName) {
    const safe = sanitizeFileBaseName(fileName);
    const fullName = `${safe}.png`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fullName;
    a.click();
    URL.revokeObjectURL(url);
    return safe;
  }

  function syncHistoryAfterPngSave(baseName) {
    const name = sanitizeFileBaseName(baseName);
    if (activeSaveId) {
      const entry = savesMeta.saves.find((s) => s.id === activeSaveId);
      if (entry && entry.name !== name) {
        entry.name = name;
        saveSavesMeta();
        renderHistoryTable();
      }
    }
    saveSession();
  }

  function openSaveDialogForPngFallback(blob, suggestedBaseName) {
    pendingPngBlob = blob;
    inputSaveName.value = suggestedBaseName;
    const title = saveDialog.querySelector('.save-dialog-title');
    if (title) title.textContent = '다른 이름으로 저장';
    const label = saveDialog.querySelector('.save-dialog-label');
    if (label) label.textContent = '파일 이름';
    saveDialog.showModal();
    inputSaveName.focus();
  }

  async function saveCurrent() {
    saveHistoryBeforePng();

    let blob;
    try {
      blob = await renderSnapshotToPng(getSnapshot());
    } catch (err) {
      console.error('PNG render failed:', err);
      alert('이미지 파일 저장에 실패했습니다. 일정은 왼쪽 히스토리에 저장되었습니다.');
      return;
    }

    const suggested = getDefaultSaveBaseName();

    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const savedName = await writePngWithPicker(blob, suggested);
        syncHistoryAfterPngSave(savedName);
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }

    openSaveDialogForPngFallback(blob, suggested);
  }

  function createNewCore() {
    state.slashes = {};
    state.colorGroups = [];
    state.outlineGroups = [];
    state.floatingLabels = [];
    state.visibleMonthCount = 1;
    activeSaveId = null;
    saveSession();
    render();
    renderHistoryTable();
    resetUndoRedoHistory();
  }

  function createNew() {
    confirmUnsavedChangesThen(createNewCore);
  }

  function getColorGroupForDate(key) {
    return state.colorGroups.find((g) => g.dates.includes(key)) || null;
  }

  function getOutlineGroupForDate(key) {
    return state.outlineGroups.find((g) => g.dates.includes(key)) || null;
  }

  function removeDateFromColorGroups(key) {
    state.colorGroups.forEach((g) => {
      g.dates = g.dates.filter((d) => d !== key);
    });
    state.colorGroups = state.colorGroups.filter((g) => g.dates.length > 0);
  }

  function removeDateFromOutlineGroups(key) {
    state.outlineGroups.forEach((g) => {
      g.dates = g.dates.filter((d) => d !== key);
    });
    state.outlineGroups = state.outlineGroups.filter((g) => g.dates.length > 0);
  }

  function collectMarkMovePayload(sourceKey) {
    const outlineGroup = getOutlineGroupForDate(sourceKey);
    if (outlineGroup) {
      return { sourceKey, moveType: 'outline', groupId: outlineGroup.id };
    }
    const colorGroup = getColorGroupForDate(sourceKey);
    if (colorGroup) {
      return { sourceKey, moveType: 'color', groupId: colorGroup.id };
    }
    const slash = state.slashes[sourceKey];
    if (slash) {
      return { sourceKey, moveType: 'slash', slashMode: normalizeSlashMode(slash.mode) };
    }
    return null;
  }

  function buildPanelMapsFromGrid(gridEl) {
    const cells = gridEl.querySelectorAll('.day-cell');
    const keyToPos = {};
    const gridKeys = [];
    cells.forEach((cell, index) => {
      const key = cell.dataset.date;
      if (!key) return;
      const row = Math.floor(index / 7);
      const col = index % 7;
      keyToPos[key] = { row, col };
      if (!gridKeys[row]) gridKeys[row] = [];
      gridKeys[row][col] = key;
    });
    return { keyToPos, gridKeys };
  }

  function clearMarkMovePreview() {
    document.querySelectorAll('.day-cell.move-preview-cell, .day-cell.move-preview-invalid').forEach((el) => {
      el.classList.remove('move-preview-cell', 'move-preview-invalid');
    });
    document.querySelectorAll('.outline-overlay.mark-move-preview').forEach((el) => {
      el.remove();
    });
  }

  function getShiftedDatesForPreview(payload, sourceKey, targetKey) {
    const deltaDays = diffDays(sourceKey, targetKey);
    if (deltaDays === 0) return [];
    if (payload.moveType === 'slash') {
      return [targetKey];
    }
    const groups = payload.moveType === 'outline' ? state.outlineGroups : state.colorGroups;
    const group = groups.find((g) => g.id === payload.groupId);
    if (!group) return [];
    return group.dates.map((d) => shiftDateKey(d, deltaDays));
  }

  function highlightPreviewCells(dates, invalid) {
    if (!stackEl) return;
    dates.forEach((key) => {
      const cell = stackEl.querySelector(`.day-cell[data-date="${key}"]`);
      if (!cell) return;
      cell.classList.add(invalid ? 'move-preview-invalid' : 'move-preview-cell');
    });
  }

  function renderOutlineMovePreview(shiftedDates, invalid) {
    if (!stackEl) return;
    stackEl.querySelectorAll('.month-panel').forEach((panel) => {
      const grid = panel.querySelector('.days-grid');
      const overlayLayer = panel.querySelector('.overlay-layer');
      if (!grid || !overlayLayer) return;
      const panelMaps = buildPanelMapsFromGrid(grid);
      getConnectedComponentsInPanel(shiftedDates, panelMaps).forEach((component) => {
        let minR = Infinity;
        let maxR = -1;
        let minC = Infinity;
        let maxC = -1;
        component.forEach((key) => {
          const { row, col } = panelMaps.keyToPos[key];
          minR = Math.min(minR, row);
          maxR = Math.max(maxR, row);
          minC = Math.min(minC, col);
          maxC = Math.max(maxC, col);
        });
        const overlay = document.createElement('div');
        overlay.className = invalid
          ? 'outline-overlay mark-move-preview mark-move-preview-invalid'
          : 'outline-overlay mark-move-preview';
        overlay.style.gridColumn = `${minC + 1} / ${maxC + 2}`;
        overlay.style.gridRow = `${minR + 1} / ${maxR + 2}`;
        overlay.style.setProperty('--outline-border', OUTLINE_BORDER_COLOR);
        overlayLayer.appendChild(overlay);
      });
    });
  }

  function updateMarkMoveDropPreview() {
    clearMarkMovePreview();
    if (!markMoveDrag || !markMoveDropTargetKey || !stackEl) return;
    const { sourceKey } = markMoveDrag;
    const targetKey = markMoveDropTargetKey;
    const shiftedDates = getShiftedDatesForPreview(markMoveDrag, sourceKey, targetKey);
    if (shiftedDates.length === 0) return;
    const invalid = !canApplyMarkMove(markMoveDrag, sourceKey, targetKey);
    if (markMoveDrag.moveType === 'outline') {
      renderOutlineMovePreview(shiftedDates, invalid);
    } else {
      highlightPreviewCells(shiftedDates, invalid);
    }
  }

  function canMoveColorGroup(groupId, deltaDays) {
    const group = state.colorGroups.find((g) => g.id === groupId);
    if (!group) return false;
    return group.dates.every((d) => {
      const key = shiftDateKey(d, deltaDays);
      const existing = getColorGroupForDate(key);
      return !existing || existing.id === groupId;
    });
  }

  function canMoveOutlineGroup(groupId, deltaDays) {
    const group = state.outlineGroups.find((g) => g.id === groupId);
    if (!group) return false;
    return group.dates.every((d) => {
      const key = shiftDateKey(d, deltaDays);
      const existing = getOutlineGroupForDate(key);
      return !existing || existing.id === groupId;
    });
  }

  function moveColorGroup(groupId, deltaDays) {
    const index = state.colorGroups.findIndex((g) => g.id === groupId);
    if (index < 0 || !canMoveColorGroup(groupId, deltaDays)) return false;
    const group = state.colorGroups[index];
    state.colorGroups[index] = {
      ...group,
      dates: group.dates.map((d) => shiftDateKey(d, deltaDays)).sort(),
    };
    return true;
  }

  function moveOutlineGroup(groupId, deltaDays) {
    const index = state.outlineGroups.findIndex((g) => g.id === groupId);
    if (index < 0 || !canMoveOutlineGroup(groupId, deltaDays)) return false;
    const group = state.outlineGroups[index];
    state.outlineGroups[index] = {
      ...group,
      dates: group.dates.map((d) => shiftDateKey(d, deltaDays)).sort(),
    };
    return true;
  }

  function moveSlash(sourceKey, targetKey) {
    if (sourceKey === targetKey) return false;
    const slash = state.slashes[sourceKey];
    if (!slash || state.slashes[targetKey]) return false;
    const mode = normalizeSlashMode(slash.mode);
    delete state.slashes[sourceKey];
    removeSlashLabelsForDate(sourceKey);
    state.slashes[targetKey] = { mode };
    syncSlashLabelForDate(targetKey, mode);
    return true;
  }

  function canApplyMarkMove(payload, sourceKey, targetKey) {
    const deltaDays = diffDays(sourceKey, targetKey);
    if (deltaDays === 0) return false;
    if (payload.moveType === 'outline') {
      return canMoveOutlineGroup(payload.groupId, deltaDays);
    }
    if (payload.moveType === 'color') {
      return canMoveColorGroup(payload.groupId, deltaDays);
    }
    if (payload.moveType === 'slash') {
      return Boolean(state.slashes[sourceKey] && !state.slashes[targetKey]);
    }
    return false;
  }

  function applyMarkMove(payload, sourceKey, targetKey) {
    if (!canApplyMarkMove(payload, sourceKey, targetKey)) return false;
    const deltaDays = diffDays(sourceKey, targetKey);
    recordUndoBeforeChange();
    let changed = false;
    if (payload.moveType === 'outline') {
      changed = moveOutlineGroup(payload.groupId, deltaDays);
    } else if (payload.moveType === 'color') {
      changed = moveColorGroup(payload.groupId, deltaDays);
    } else if (payload.moveType === 'slash') {
      changed = moveSlash(sourceKey, targetKey);
    }
    if (!changed) return false;
    saveSession();
    render();
    return true;
  }

  function startMarkMoveDrag(sourceKey) {
    const payload = collectMarkMovePayload(sourceKey);
    if (!payload) return;
    markMoveDrag = payload;
    markMoveDropTargetKey = sourceKey;
    updateMarkMoveDropPreview();
  }

  function onMarkMoveOver(e) {
    if (!markMoveDrag) return;
    const cell = e.target.closest('.day-cell');
    if (!cell) return;
    markMoveDropTargetKey = cell.dataset.date;
    updateMarkMoveDropPreview();
  }

  function endMarkMoveDrag() {
    if (!markMoveDrag) return;
    const payload = markMoveDrag;
    const sourceKey = payload.sourceKey;
    const targetKey = markMoveDropTargetKey;
    markMoveDrag = null;
    markMoveDropTargetKey = null;
    clearMarkMovePreview();
    if (!targetKey || targetKey === sourceKey) return;
    applyMarkMove(payload, sourceKey, targetKey);
  }

  function buildMonthCells(year, month) {
    const firstDow = new Date(year, month - 1, 1).getDay();
    const totalDays = daysInMonth(year, month);
    const prev = addMonths(year, month, -1);
    const prevDays = daysInMonth(prev.year, prev.month);
    const cells = [];

    for (let i = firstDow - 1; i >= 0; i--) {
      const day = prevDays - i;
      cells.push({
        year: prev.year,
        month: prev.month,
        day,
        isCurrentMonth: false,
      });
    }

    for (let d = 1; d <= totalDays; d++) {
      cells.push({ year, month, day: d, isCurrentMonth: true });
    }

    const next = addMonths(year, month, 1);
    let nd = 1;
    while (cells.length % 7 !== 0) {
      cells.push({
        year: next.year,
        month: next.month,
        day: nd++,
        isCurrentMonth: false,
      });
    }

    return cells;
  }

  function trimTrailingWeekWhenNextPanelVisible(cells, hasNextPanel) {
    if (!hasNextPanel || cells.length < 7) return cells;
    const lastRow = cells.slice(-7);
    if (lastRow.some((cell) => !cell.isCurrentMonth)) {
      return cells.slice(0, -7);
    }
    return cells;
  }

  function findDateInMonthGrid(targetYear, targetMonth, targetDay, panelYear, panelMonth, hasNextPanel) {
    let cells = buildMonthCells(panelYear, panelMonth);
    cells = trimTrailingWeekWhenNextPanelVisible(cells, hasNextPanel);
    const idx = cells.findIndex(
      (cell) =>
        cell.year === targetYear && cell.month === targetMonth && cell.day === targetDay
    );
    if (idx < 0) return null;
    return {
      row: Math.floor(idx / 7),
      col: idx % 7,
      weekCount: cells.length / 7,
    };
  }

  function buildPanelGridMaps(cells) {
    const keyToPos = {};
    const gridKeys = [];

    cells.forEach((cell, index) => {
      const row = Math.floor(index / 7);
      const col = index % 7;
      const key = dateKey(cell.year, cell.month, cell.day);
      keyToPos[key] = { row, col };
      if (!gridKeys[row]) gridKeys[row] = [];
      gridKeys[row][col] = key;
    });

    return { keyToPos, gridKeys };
  }

  function getConnectedComponentsInPanel(groupDates, panelMaps) {
    const panelDates = groupDates.filter((d) => panelMaps.keyToPos[d]);
    if (panelDates.length === 0) return [];

    const dateSet = new Set(panelDates);
    const visited = new Set();
    const components = [];
    const { gridKeys } = panelMaps;

    panelDates.forEach((startKey) => {
      if (visited.has(startKey)) return;

      const component = [];
      const queue = [startKey];
      visited.add(startKey);

      while (queue.length) {
        const key = queue.shift();
        component.push(key);
        const { row, col } = panelMaps.keyToPos[key];
        [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]].forEach(
          ([r, c]) => {
            const neighborKey = gridKeys[r]?.[c];
            if (neighborKey && dateSet.has(neighborKey) && !visited.has(neighborKey)) {
              visited.add(neighborKey);
              queue.push(neighborKey);
            }
          }
        );
      }

      components.push(component);
    });

    return components;
  }

  function appendOutlineOverlays(overlayLayer, panelMaps) {
    state.outlineGroups.forEach((group) => {
      getConnectedComponentsInPanel(group.dates, panelMaps).forEach((component) => {
        let minR = Infinity;
        let maxR = -1;
        let minC = Infinity;
        let maxC = -1;

        component.forEach((key) => {
          const { row, col } = panelMaps.keyToPos[key];
          minR = Math.min(minR, row);
          maxR = Math.max(maxR, row);
          minC = Math.min(minC, col);
          maxC = Math.max(maxC, col);
        });

        const overlay = document.createElement('div');
        overlay.className = 'outline-overlay';
        overlay.style.gridColumn = `${minC + 1} / ${maxC + 2}`;
        overlay.style.gridRow = `${minR + 1} / ${maxR + 2}`;
        overlay.style.setProperty('--outline-border', OUTLINE_BORDER_COLOR);
        overlayLayer.appendChild(overlay);
      });
    });
  }

  function applyMarkingsToCell(cellEl, key, panelMaps) {
    cellEl.classList.remove('has-slash', 'has-color', 'has-outline');
    cellEl.style.removeProperty('--box-bg');
    cellEl.style.removeProperty('--box-border');

    const outlineWrap = cellEl.querySelector('.outline-wrap');
    outlineWrap.classList.remove('outline-top', 'outline-right', 'outline-bottom', 'outline-left');
    outlineWrap.style.removeProperty('--outline-border');

    const slash = state.slashes[key];
    if (slash) {
      cellEl.classList.add('has-slash');
    }

    const colorGroup = getColorGroupForDate(key);
    if (colorGroup) {
      cellEl.classList.add('has-color');
      cellEl.style.setProperty('--box-bg', colorGroup.color);
      cellEl.style.setProperty('--box-border', colorGroup.borderColor);
    }

    const outlineGroup = getOutlineGroupForDate(key);
    if (outlineGroup && panelMaps.keyToPos[key]) {
      cellEl.classList.add('has-outline');
    }
  }

  function appendFloatingLabels(labelsLayer, year, month) {
    const key = panelKey(year, month);
    state.floatingLabels
      .filter((l) => l.panel === key)
      .forEach((label) => {
        labelsLayer.appendChild(createFloatingLabelWrap(label));
      });
  }

  let floatingLabelMeasureCanvas = null;

  function syncFloatingLabelInputWidth(input) {
    if (!input) return;
    const style = getComputedStyle(input);
    const fontSize = parseFloat(style.fontSize) || DEFAULT_LABEL_STYLE.size;
    const fontWeight = style.fontWeight || String(state.labelStyle.weight);
    const fontFamily = style.fontFamily || 'inherit';
    const text = input.value || '\u00A0';

    if (!floatingLabelMeasureCanvas) {
      floatingLabelMeasureCanvas = document.createElement('canvas');
    }
    const ctx = floatingLabelMeasureCanvas.getContext('2d');
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    const textWidth = ctx.measureText(text).width;

    const padX = 8;
    const border = 2;
    const minWidth = fontSize * 1.5;
    input.style.width = `${Math.ceil(Math.max(minWidth, textWidth + padX + border))}px`;
  }

  function createFloatingLabelInputElement(label) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'floating-label-input';
    input.value = label.text;
    input.style.color = label.color || '#111';
    input.style.fontSize = `${getFloatingLabelSize(label)}px`;
    syncFloatingLabelInputWidth(input);
    return input;
  }

  function bindFloatingLabelInputEvents(input, id) {
    if (input.dataset.bound === '1') return;
    input.dataset.bound = '1';
    input.addEventListener('input', () => syncFloatingLabelInputWidth(input));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitFloatingLabelEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelFloatingLabelEdit();
      }
      e.stopPropagation();
    });
    input.addEventListener('mousedown', (e) => e.stopPropagation());
    input.addEventListener('blur', () => {
      const blurId = id;
      setTimeout(() => {
        if (editingFloatingLabelId !== blurId) return;
        commitFloatingLabelEdit();
      }, 0);
    });
  }

  function restoreFloatingLabelText(wrap, label) {
    if (!wrap || !label) return;
    wrap.classList.remove('is-editing');
    const input = wrap.querySelector('.floating-label-input');
    const textEl = document.createElement('span');
    textEl.className = 'floating-label-text';
    textEl.textContent = label.text;
    textEl.style.color = label.color || '#111';
    textEl.style.fontSize = `${getFloatingLabelSize(label)}px`;
    if (input) {
      input.replaceWith(textEl);
    } else {
      const existing = wrap.querySelector('.floating-label-text');
      if (existing) {
        existing.textContent = label.text;
        existing.style.color = normalizeHexColor(label.color);
      } else {
        wrap.insertBefore(textEl, wrap.firstChild);
      }
    }
  }

  function isFloatingLabelEditing() {
    return editingFloatingLabelId != null;
  }

  function startFloatingLabelEdit(id) {
    if (editingFloatingLabelId === id) return;
    if (editingFloatingLabelId) commitFloatingLabelEdit();

    const label = getFloatingLabelById(id);
    if (!label) return;

    editingFloatingLabelId = id;
    selectFloatingLabel(id);

    const wrap = stackEl.querySelector(`.floating-label-wrap[data-id="${id}"]`);
    if (!wrap) return;

    wrap.classList.add('is-editing');
    const textEl = wrap.querySelector('.floating-label-text');
    if (!textEl) return;

    const input = createFloatingLabelInputElement(label);
    textEl.replaceWith(input);
    bindFloatingLabelInputEvents(input, id);
    syncFloatingLabelInputWidth(input);
    input.focus();
    input.select();
  }

  function commitFloatingLabelEdit() {
    if (!editingFloatingLabelId) return;
    const id = editingFloatingLabelId;
    const wrap = stackEl.querySelector(`.floating-label-wrap[data-id="${id}"]`);
    const input = wrap?.querySelector('.floating-label-input');
    editingFloatingLabelId = null;

    if (!input) return;

    const text = input.value.trim();
    if (!text) {
      eraseFloatingLabel(id);
      return;
    }

    recordUndoBeforeChange();
    const label = getFloatingLabelById(id);
    if (!label) return;

    label.text = text;
    restoreFloatingLabelText(wrap, label);
    saveSession();
    clearFloatingLabelSelection();
  }

  function cancelFloatingLabelEdit() {
    if (!editingFloatingLabelId) return;
    const id = editingFloatingLabelId;
    const label = getFloatingLabelById(id);
    const wrap = stackEl.querySelector(`.floating-label-wrap[data-id="${id}"]`);
    editingFloatingLabelId = null;
    if (wrap && label) {
      restoreFloatingLabelText(wrap, label);
    }
    clearFloatingLabelSelection();
  }

  function focusEditingFloatingLabelInput() {
    if (!editingFloatingLabelId) return;
    const wrap = stackEl.querySelector(`.floating-label-wrap[data-id="${editingFloatingLabelId}"]`);
    const input = wrap?.querySelector('.floating-label-input');
    if (!input) return;
    bindFloatingLabelInputEvents(input, editingFloatingLabelId);
    syncFloatingLabelInputWidth(input);
    input.focus();
  }

  function createFloatingLabelWrap(label) {
    const isEditing = label.id === editingFloatingLabelId;
    const wrap = document.createElement('div');
    wrap.className = 'floating-label-wrap';
    if (label.id === selectedFloatingLabelId || isEditing) {
      wrap.classList.add('is-selected');
    }
    if (isEditing) {
      wrap.classList.add('is-editing');
    }
    if (SLASH_LABEL_TEXTS.has(label.text)) {
      wrap.classList.add('is-slash-label');
    }
    wrap.dataset.id = label.id;
    wrap.style.left = `${label.x * 100}%`;
    wrap.style.top = `${label.y * 100}%`;

    if (isEditing) {
      wrap.appendChild(createFloatingLabelInputElement(label));
    } else {
      const textEl = document.createElement('span');
      textEl.className = 'floating-label-text';
      textEl.textContent = label.text;
      textEl.style.color = label.color || '#111';
      textEl.style.fontSize = `${getFloatingLabelSize(label)}px`;
      wrap.appendChild(textEl);
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'floating-label-delete';
    deleteBtn.setAttribute('aria-label', '삭제');
    deleteBtn.textContent = '×';

    const resizeHandle = document.createElement('span');
    resizeHandle.className = 'floating-label-resize';
    resizeHandle.setAttribute('aria-hidden', 'true');

    wrap.appendChild(deleteBtn);
    wrap.appendChild(resizeHandle);
    return wrap;
  }

  function syncFloatingLabelSelection() {
    stackEl.querySelectorAll('.floating-label-wrap').forEach((el) => {
      el.classList.toggle('is-selected', el.dataset.id === selectedFloatingLabelId);
    });
  }

  function selectFloatingLabel(id) {
    selectedFloatingLabelId = id;
    syncFloatingLabelSelection();
  }

  function clearFloatingLabelSelection() {
    if (!selectedFloatingLabelId) return;
    selectedFloatingLabelId = null;
    syncFloatingLabelSelection();
  }

  function getFloatingLabelWrapAtPoint(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    return el?.closest('.floating-label-wrap') || null;
  }

  function isPointerOnFloatingLabelText(clientX, clientY, id) {
    const wrap = getFloatingLabelWrapAtPoint(clientX, clientY);
    if (!wrap || wrap.dataset.id !== id) return false;
    const el = document.elementFromPoint(clientX, clientY);
    return Boolean(el?.closest('.floating-label-text, .floating-label-input'));
  }

  function handleFloatingLabelOutsidePointer(e) {
    if (e.target.closest('.text-tool-body')) {
      if (e.target.closest('.swatch[data-color]')) {
        e.preventDefault();
      }
      return;
    }

    if (isFloatingLabelEditing()) {
      const editingWrap = e.target.closest('.floating-label-wrap');
      if (!editingWrap || editingWrap.dataset.id !== editingFloatingLabelId) {
        commitFloatingLabelEdit();
      }
    }

    if (getFloatingLabelWrapAtPoint(e.clientX, e.clientY)) {
      return;
    }

    clearFloatingLabelSelection();
  }

  function getFloatingLabelById(id) {
    return state.floatingLabels.find((l) => l.id === id) || null;
  }

  function getFloatingLabelPasteOffset(label, repeatCount) {
    const STEP_X = 12;
    const STEP_Y = 8;
    const n = repeatCount + 1;
    const monthGrid = getMonthGridForPanelKey(label.panel);
    const rect = monthGrid?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return { x: 0.012 * n, y: 0.008 * n };
    }
    return {
      x: (STEP_X * n) / rect.width,
      y: (STEP_Y * n) / rect.height,
    };
  }

  function showCopyFeedback(labelId) {
    if (copyFlashTimeout) {
      clearTimeout(copyFlashTimeout);
      copyFlashTimeout = null;
    }
    const wrap = stackEl.querySelector(`.floating-label-wrap[data-id="${labelId}"]`);
    if (!wrap) return;
    wrap.classList.add('is-copy-flash');
    copyFlashTimeout = setTimeout(() => {
      const el = stackEl.querySelector(`.floating-label-wrap[data-id="${labelId}"]`);
      el?.classList.remove('is-copy-flash');
      copyFlashTimeout = null;
    }, 600);
  }

  function copySelectedFloatingLabel() {
    if (!selectedFloatingLabelId || isFloatingLabelEditing()) return false;
    const label = getFloatingLabelById(selectedFloatingLabelId);
    if (!label || !label.text.trim()) return false;

    copiedFloatingLabel = {
      text: label.text,
      color: label.color,
      size: getFloatingLabelSize(label),
      panel: label.panel,
      x: label.x,
      y: label.y,
    };
    pasteRepeatCount = 0;
    showCopyFeedback(selectedFloatingLabelId);
    return true;
  }

  function pasteFloatingLabel() {
    if (!copiedFloatingLabel) return false;

    recordUndoBeforeChange();
    const { x: offsetX, y: offsetY } = getFloatingLabelPasteOffset(copiedFloatingLabel, pasteRepeatCount);
    const id = uuid();
    state.floatingLabels.push({
      id,
      panel: copiedFloatingLabel.panel,
      x: clamp01(copiedFloatingLabel.x + offsetX),
      y: clamp01(copiedFloatingLabel.y + offsetY),
      text: copiedFloatingLabel.text,
      color: copiedFloatingLabel.color,
      size: copiedFloatingLabel.size,
    });
    pasteRepeatCount += 1;
    selectedFloatingLabelId = id;
    saveSession();
    render();
    return true;
  }

  function getMonthGridForPanelKey(key) {
    const panels = stackEl.querySelectorAll('.month-panel');
    for (const panel of panels) {
      const year = Number(panel.dataset.year);
      const month = Number(panel.dataset.month);
      if (panelKey(year, month) === key) {
        return panel.querySelector('.month-grid');
      }
    }
    return null;
  }

  function getMonthGridAtPoint(clientX, clientY) {
    const grids = stackEl.querySelectorAll('.month-grid');
    for (const monthGrid of grids) {
      const rect = monthGrid.getBoundingClientRect();
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return monthGrid;
      }
    }
    return null;
  }

  function getLabelAreaRects(monthGrid) {
    const gridWrap = monthGrid?.querySelector('.days-grid-wrap');
    if (!monthGrid || !gridWrap) return null;
    return {
      areaRect: monthGrid.getBoundingClientRect(),
      gridWrapRect: gridWrap.getBoundingClientRect(),
    };
  }

  function pointToLabelCoords(clientX, clientY, monthGrid) {
    const rect = monthGrid.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height),
    };
  }

  function getPanelKeyFromMonthGrid(monthGrid) {
    const panel = monthGrid.closest('.month-panel');
    if (!panel) return null;
    return panelKey(Number(panel.dataset.year), Number(panel.dataset.month));
  }

  function getDaysGridWrapAtPoint(clientX, clientY) {
    const wraps = stackEl.querySelectorAll('.days-grid-wrap');
    for (const wrap of wraps) {
      const rect = wrap.getBoundingClientRect();
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return wrap;
      }
    }
    return null;
  }

  function getPanelKeyFromGridWrap(gridWrap) {
    const panel = gridWrap.closest('.month-panel');
    if (!panel) return null;
    return panelKey(Number(panel.dataset.year), Number(panel.dataset.month));
  }

  function getLabelsLayerForPanelKey(key) {
    const panels = stackEl.querySelectorAll('.month-panel');
    for (const panel of panels) {
      const year = Number(panel.dataset.year);
      const month = Number(panel.dataset.month);
      if (panelKey(year, month) === key) {
        return panel.querySelector('.labels-layer');
      }
    }
    return null;
  }

  function ensureFloatingLabelInCorrectLayer(label) {
    const el = stackEl.querySelector(`.floating-label-wrap[data-id="${label.id}"]`);
    if (!el) return;
    const layer = getLabelsLayerForPanelKey(label.panel);
    if (layer && el.parentElement !== layer) {
      layer.appendChild(el);
    }
  }

  function setFloatingLabelPositionFromPoint(label, clientX, clientY) {
    const monthGrid = getMonthGridAtPoint(clientX, clientY);
    if (!monthGrid) return false;

    const coords = pointToLabelCoords(clientX, clientY, monthGrid);
    if (!coords) return false;

    const key = getPanelKeyFromMonthGrid(monthGrid);
    if (!key) return false;

    label.panel = key;
    label.x = coords.x;
    label.y = coords.y;
    ensureFloatingLabelInCorrectLayer(label);
    return true;
  }

  function updateFloatingLabelElement(label) {
    ensureFloatingLabelInCorrectLayer(label);
    const el = stackEl.querySelector(`.floating-label-wrap[data-id="${label.id}"]`);
    if (!el) return;
    el.style.left = `${label.x * 100}%`;
    el.style.top = `${label.y * 100}%`;
    const fontSize = `${getFloatingLabelSize(label)}px`;
    const color = label.color || DEFAULT_LABEL_STYLE.color;
    const textEl = el.querySelector('.floating-label-text');
    const inputEl = el.querySelector('.floating-label-input');
    if (textEl) {
      textEl.style.fontSize = fontSize;
      textEl.style.color = color;
    }
    if (inputEl) {
      inputEl.style.fontSize = fontSize;
      inputEl.style.color = color;
      syncFloatingLabelInputWidth(inputEl);
    }
  }

  function nudgeFloatingLabel(label, dxPx, dyPx) {
    const monthGrid = getMonthGridForPanelKey(label.panel);
    const rect = monthGrid?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;

    label.x = clamp01(label.x + dxPx / rect.width);
    label.y = clamp01(label.y + dyPx / rect.height);
    updateFloatingLabelElement(label);
    return true;
  }

  function moveSelectedFloatingLabelByArrow(e) {
    const arrowKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
    if (!arrowKeys.has(e.key)) return false;
    if (shouldIgnoreUndoShortcut(e)) return false;
    if (isFloatingLabelEditing()) return false;
    if (!selectedFloatingLabelId) return false;

    const label = getFloatingLabelById(selectedFloatingLabelId);
    if (!label) return false;

    const step = e.shiftKey ? 10 : 1;
    let dx = 0;
    let dy = 0;
    switch (e.key) {
      case 'ArrowLeft':
        dx = -step;
        break;
      case 'ArrowRight':
        dx = step;
        break;
      case 'ArrowUp':
        dy = -step;
        break;
      case 'ArrowDown':
        dy = step;
        break;
      default:
        break;
    }

    recordUndoBeforeChange();
    if (!nudgeFloatingLabel(label, dx, dy)) return false;
    saveSession();
    e.preventDefault();
    return true;
  }

  function createFloatingLabelAt(e) {
    const monthGrid = e.target.closest('.month-grid');
    const panel = monthGrid?.closest('.month-panel');
    if (!monthGrid || !panel) return;

    const year = Number(panel.dataset.year);
    const month = Number(panel.dataset.month);
    const coords = pointToLabelCoords(e.clientX, e.clientY, monthGrid);
    if (!coords) return;

    const id = uuid();
    recordUndoBeforeChange();
    state.floatingLabels.push({
      id,
      panel: panelKey(year, month),
      x: coords.x,
      y: coords.y,
      text: '',
      color: state.labelStyle.color,
      size: state.labelStyle.size,
    });
    selectedFloatingLabelId = id;
    editingFloatingLabelId = id;
    saveSession();
    render();
  }

  function eraseFloatingLabel(id) {
    recordUndoBeforeChange();
    if (selectedFloatingLabelId === id) {
      selectedFloatingLabelId = null;
    }
    if (editingFloatingLabelId === id) {
      editingFloatingLabelId = null;
    }
    state.floatingLabels = state.floatingLabels.filter((l) => l.id !== id);
    saveSession();
    render();
  }

  function startFloatingLabelDrag(e, wrapEl) {
    e.preventDefault();
    e.stopPropagation();
    const id = wrapEl.dataset.id;
    const label = getFloatingLabelById(id);
    if (!label) return;

    floatingLabelDrag = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      onText: Boolean(e.target.closest('.floating-label-text')),
      eraserIntent: isEraserPointer(e) || state.activeTool === 'eraser',
    };
  }

  function startFloatingLabelResize(e, wrapEl) {
    e.preventDefault();
    e.stopPropagation();
    const id = wrapEl.dataset.id;
    const label = getFloatingLabelById(id);
    if (!label) return;

    recordUndoBeforeChange();
    selectFloatingLabel(id);
    floatingLabelResize = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      startSize: getFloatingLabelSize(label),
    };
  }

  function onFloatingLabelMove(e) {
    if (!floatingLabelDrag) return;
    const label = getFloatingLabelById(floatingLabelDrag.id);
    if (!label) return;

    const pixelDx = e.clientX - floatingLabelDrag.startX;
    const pixelDy = e.clientY - floatingLabelDrag.startY;
    if (!floatingLabelDrag.moved) {
      if (Math.abs(pixelDx) + Math.abs(pixelDy) < 4) return;
      floatingLabelDrag.moved = true;
      recordUndoBeforeChange();
    }

    if (setFloatingLabelPositionFromPoint(label, e.clientX, e.clientY)) {
      updateFloatingLabelElement(label);
    }
  }

  function onFloatingLabelResizeMove(e) {
    if (!floatingLabelResize) return;
    const label = getFloatingLabelById(floatingLabelResize.id);
    if (!label) return;

    const dx = e.clientX - floatingLabelResize.startX;
    const dy = e.clientY - floatingLabelResize.startY;
    const delta = Math.max(dx, dy);
    label.size = clampLabelSize(floatingLabelResize.startSize + delta * 0.4);
    updateFloatingLabelElement(label);
  }

  function onFloatingLabelPointerMove(e) {
    onFloatingLabelMove(e);
    onFloatingLabelResizeMove(e);
  }

  function endFloatingLabelDrag(e) {
    if (!floatingLabelDrag) return;
    const drag = floatingLabelDrag;
    floatingLabelDrag = null;

    if (drag.moved) {
      saveSession();
      return;
    }

    if (
      drag.onText &&
      state.activeTool !== 'eraser' &&
      !drag.eraserIntent &&
      e &&
      isPointerOnFloatingLabelText(e.clientX, e.clientY, drag.id)
    ) {
      return;
    }

    clearFloatingLabelSelection();
  }

  function endFloatingLabelResize() {
    if (!floatingLabelResize) return;
    floatingLabelResize = null;
    saveSession();
  }

  function renderMonthPanel(year, month, hasNextPanel) {
    const panel = document.createElement('section');
    panel.className = 'month-panel';
    panel.dataset.year = year;
    panel.dataset.month = month;

    const title = document.createElement('h2');
    title.className = 'month-title';
    title.textContent = `${year}년 ${month}월`;

    const weekdays = document.createElement('div');
    weekdays.className = 'weekdays';
    weekdays.innerHTML = WEEKDAYS.map((d) => `<span>${d}</span>`).join('');

    const gridWrap = document.createElement('div');
    gridWrap.className = 'days-grid-wrap';

    const grid = document.createElement('div');
    grid.className = 'days-grid';

    const overlayLayer = document.createElement('div');
    overlayLayer.className = 'overlay-layer';
    overlayLayer.setAttribute('aria-hidden', 'true');

    let cells = buildMonthCells(year, month);
    cells = trimTrailingWeekWhenNextPanelVisible(cells, hasNextPanel);
    const weekCount = cells.length / 7;
    gridWrap.style.setProperty('--calendar-week-count', weekCount);
    const panelMaps = buildPanelGridMaps(cells);

    cells.forEach((cell) => {
      const key = dateKey(cell.year, cell.month, cell.day);
      const dayCell = document.createElement('div');
      dayCell.className = 'day-cell';
      dayCell.dataset.date = key;
      if (!cell.isCurrentMonth) dayCell.classList.add('other-month');

      dayCell.innerHTML = `
        <div class="outline-wrap">
          <div class="day-inner">
            <span class="day-number">${cell.day}</span>
            <span class="slash"></span>
          </div>
        </div>
      `;

      applyMarkingsToCell(dayCell, key, panelMaps);
      grid.appendChild(dayCell);
    });

    appendOutlineOverlays(overlayLayer, panelMaps);

    gridWrap.appendChild(grid);
    gridWrap.appendChild(overlayLayer);

    const monthGrid = document.createElement('div');
    monthGrid.className = 'month-grid';
    monthGrid.append(title, weekdays, gridWrap);

    const labelsLayer = document.createElement('div');
    labelsLayer.className = 'labels-layer';
    appendFloatingLabels(labelsLayer, year, month);
    monthGrid.appendChild(labelsLayer);

    const card = document.createElement('div');
    card.className = 'month-card';
    card.appendChild(monthGrid);
    panel.appendChild(card);
    return panel;
  }

  function renderPanelControls() {
    const controls = document.createElement('div');
    controls.className = 'panel-controls';

    const minusBtn = document.createElement('button');
    minusBtn.type = 'button';
    minusBtn.className = 'panel-btn-minus';
    minusBtn.textContent = '−';
    minusBtn.title = '마지막 달 접기';
    minusBtn.disabled = state.visibleMonthCount <= 1;
    minusBtn.addEventListener('click', () => {
      if (state.visibleMonthCount > 1) {
        recordUndoBeforeChange();
        state.visibleMonthCount--;
        saveSession();
        render();
      }
    });

    const plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.className = 'add-month-btn';
    plusBtn.title = '다음 달 추가';
    plusBtn.setAttribute('aria-label', '다음 달 추가');
    plusBtn.innerHTML = `
      <span class="add-month-icon">+</span>
      <span class="add-month-label">다음 달 추가</span>
    `;
    plusBtn.addEventListener('click', () => {
      recordUndoBeforeChange();
      state.visibleMonthCount++;
      saveSession();
      render();
    });

    if (state.visibleMonthCount > 1) controls.appendChild(minusBtn);
    controls.appendChild(plusBtn);

    return controls;
  }

  function getCharCenterX(el, char) {
    const textNode = el.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return null;
    const index = textNode.textContent.indexOf(char);
    if (index === -1) return null;
    const range = document.createRange();
    range.setStart(textNode, index);
    range.setEnd(textNode, index + char.length);
    const rect = range.getBoundingClientRect();
    return rect.left + rect.width / 2;
  }

  function getElementCenterX(el) {
    const rect = el.getBoundingClientRect();
    return rect.left + rect.width / 2;
  }

  function alignScheduleGroup() {
    const scheduleGroup = document.querySelector('.schedule-group');
    const titleEl = document.querySelector('.app-title');
    if (!scheduleGroup || !titleEl) return;

    if (window.innerWidth <= SCHEDULE_ALIGN_MOBILE_MAX) {
      scheduleGroup.style.setProperty('--schedule-align-offset', '0px');
      return;
    }

    scheduleGroup.style.setProperty('--schedule-align-offset', '0px');
    void scheduleGroup.offsetWidth;

    const titleCenterX = getCharCenterX(titleEl, TITLE_ALIGN_CHAR);
    const weekdayRow = document.querySelector('.weekdays');
    const suSpan = weekdayRow
      ? Array.from(weekdayRow.querySelectorAll('span')).find(
          (span) => span.textContent === WEEKDAY_ALIGN_CHAR
        )
      : null;

    if (titleCenterX == null || !suSpan) {
      scheduleGroup.style.setProperty('--schedule-align-offset', '0px');
      return;
    }

    const offset = titleCenterX - getElementCenterX(suSpan);
    scheduleGroup.style.setProperty('--schedule-align-offset', `${offset}px`);
  }

  function scheduleAlignScheduleGroup() {
    requestAnimationFrame(() => {
      requestAnimationFrame(alignScheduleGroup);
    });
  }

  function render() {
    clearMarkMovePreview();
    sanitizeViewState();
    syncAllSlashLabels();
    stackEl.innerHTML = '';

    for (let i = 0; i < state.visibleMonthCount; i++) {
      const { year, month } = addMonths(state.viewYear, state.viewMonth, i);
      const hasNextPanel = i < state.visibleMonthCount - 1;
      stackEl.appendChild(renderMonthPanel(year, month, hasNextPanel));
    }

    if (panelControlsRootEl) {
      panelControlsRootEl.innerHTML = '';
      panelControlsRootEl.appendChild(renderPanelControls());
    }

    inputYear.value = state.viewYear;
    selectMonth.value = state.viewMonth;
    syncLabelStyleInputs();
    applyLabelStyleToDom();
    updateToolbar();
    focusEditingFloatingLabelInput();
    scheduleAlignScheduleGroup();
    syncActivePanelKeyAfterRender();
  }

  function getActivePickerColor() {
    return state.activeColor;
  }

  function setActivePickerColor(color) {
    state.activeColor = color;
  }

  function getActiveLabelColor() {
    return state.labelStyle.color;
  }

  function getDisplayedLabelColor() {
    const id = selectedFloatingLabelId || editingFloatingLabelId;
    if (id) {
      const label = getFloatingLabelById(id);
      if (label && !SLASH_LABEL_TEXTS.has(label.text)) {
        return normalizeHexColor(label.color);
      }
    }
    return normalizeHexColor(getActiveLabelColor());
  }

  function applyLabelColor(color) {
    const normalized = normalizeHexColor(
      clampLabelStyle({ ...state.labelStyle, color }).color
    );
    state.labelStyle.color = normalized;

    const targetId = selectedFloatingLabelId || editingFloatingLabelId;
    if (targetId) {
      const label = getFloatingLabelById(targetId);
      if (label && !SLASH_LABEL_TEXTS.has(label.text)) {
        const currentColor = normalizeHexColor(label.color);
        if (currentColor !== normalized) {
          recordUndoBeforeChange();
          label.color = normalized;
          updateFloatingLabelElement(label);
          saveSession();
        }
      }
    }

    updateToolbar();
  }

  function getPrimaryPanelKey() {
    return panelKey(state.viewYear, state.viewMonth);
  }

  function getPanelKeyFromMonthPanel(panelEl) {
    if (!panelEl) return null;
    return panelKey(Number(panelEl.dataset.year), Number(panelEl.dataset.month));
  }

  function isPanelKeyCurrentlyVisible(key) {
    if (!stackEl || !key) return false;
    return Array.from(stackEl.querySelectorAll('.month-panel')).some(
      (panel) => getPanelKeyFromMonthPanel(panel) === key
    );
  }

  function setActivePanelKey(key) {
    if (!key) return;
    activePanelKey = key;
  }

  function getPanelKeyFromViewport() {
    if (!stackEl) return getPrimaryPanelKey();
    const panels = stackEl.querySelectorAll('.month-panel');
    if (panels.length === 0) return getPrimaryPanelKey();
    if (panels.length === 1) return getPanelKeyFromMonthPanel(panels[0]) || getPrimaryPanelKey();

    const scrollRoot = document.querySelector('.calendar-column');
    const rootRect = scrollRoot?.getBoundingClientRect();
    if (!rootRect) return getPanelKeyFromMonthPanel(panels[0]) || getPrimaryPanelKey();

    const viewCenterY = rootRect.top + rootRect.height / 2;
    let bestPanel = panels[0];
    let bestDist = Infinity;

    panels.forEach((panel) => {
      const rect = panel.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      const dist = Math.abs(centerY - viewCenterY);
      if (dist < bestDist) {
        bestDist = dist;
        bestPanel = panel;
      }
    });

    return getPanelKeyFromMonthPanel(bestPanel) || getPrimaryPanelKey();
  }

  function getTargetPanelKeyForTemplates() {
    if (activePanelKey && isPanelKeyCurrentlyVisible(activePanelKey)) {
      return activePanelKey;
    }
    return getPanelKeyFromViewport();
  }

  function syncActivePanelKeyAfterRender() {
    if (activePanelKey && isPanelKeyCurrentlyVisible(activePanelKey)) return;
    activePanelKey = getPanelKeyFromViewport();
  }

  function updateActivePanelFromPointer(e) {
    const panel = e.target.closest('.month-panel');
    if (!panel) return;
    setActivePanelKey(getPanelKeyFromMonthPanel(panel));
  }

  function placeFloatingLabelTemplate(text) {
    if (!text) return;

    const panel = getTargetPanelKeyForTemplates();
    const baseX = 0.12;
    const baseY = 0.08;
    const repeatIndex = labelTemplatePlaceCounts[text] || 0;
    labelTemplatePlaceCounts[text] = repeatIndex + 1;

    const offset =
      repeatIndex === 0
        ? { x: 0, y: 0 }
        : getFloatingLabelPasteOffset({ panel, x: baseX, y: baseY }, repeatIndex - 1);

    const id = uuid();
    recordUndoBeforeChange();
    state.floatingLabels.push({
      id,
      panel,
      x: clamp01(baseX + offset.x),
      y: clamp01(baseY + offset.y),
      text,
      color: getLabelTemplateDefaultColor(text) || DEFAULT_LABEL_STYLE.color,
      size: state.labelStyle.size,
    });
    selectedFloatingLabelId = id;
    editingFloatingLabelId = null;
    saveSession();
    render();
  }

  function bindLabelTemplates() {
    const root = document.getElementById('label-template-options');
    if (!root) return;
    root.innerHTML = LABEL_TEMPLATES.map(
      (item) =>
        `<button type="button" class="label-template-btn" data-tool="label" data-label-template="${item.text}" title="달력에 '${item.text}' 텍스트 배치">${item.text}</button>`
    ).join('');

    if (root.dataset.bound === '1') return;
    root.dataset.bound = '1';
    root.addEventListener('mousedown', (e) => {
      const btn = e.target.closest('.label-template-btn[data-label-template]');
      if (!btn) return;
      e.preventDefault();
      const text = btn.dataset.labelTemplate;
      state.activeTool = 'label';
      hideColorBoxPreview();
      placeFloatingLabelTemplate(text);
      updateToolbar();
      syncCalendarToolCursor();
    });
  }

  function bindLabelColorSwatches() {
    const root = document.getElementById('label-color-options');
    if (!root) return;
    root.innerHTML = LABEL_TEXT_COLORS.map(
      (swatchColor, index) =>
        `<button type="button" class="swatch" data-tool="label" data-color="${swatchColor}" style="--swatch:${swatchColor}" title="${LABEL_TEXT_COLOR_TITLES[index]}"><span class="swatch-letter" aria-hidden="true">T</span></button>`
    ).join('');

    if (root.dataset.bound === '1') return;
    root.dataset.bound = '1';
    root.addEventListener('mousedown', (e) => {
      const btn = e.target.closest('.swatch[data-color]');
      if (!btn) return;
      e.preventDefault();
      state.activeTool = 'label';
      hideColorBoxPreview();
      applyLabelColor(btn.dataset.color);
    });
  }

  function isToolControlActive(btn) {
    const tool = btn.dataset.tool;
    if (tool === 'slash') {
      return state.activeTool === 'slash' && btn.dataset.slashMode === state.slashMode;
    }
    if (tool === 'colorBox') {
      return state.activeTool === 'colorBox' && btn.dataset.color === getActivePickerColor();
    }
    if (tool === 'label' && btn.dataset.color) {
      return state.activeTool === 'label' && btn.dataset.color === getDisplayedLabelColor();
    }
    return state.activeTool === tool;
  }

  function updateToolbar() {
    document.querySelectorAll('.tool-icon-btn, .swatch[data-tool], .label-template-btn').forEach((btn) => {
      btn.classList.toggle('active', isToolControlActive(btn));
    });

    if (toolHintEl) {
      toolHintEl.textContent = TOOL_HINTS[state.activeTool] || '';
    }

    const pickerColor = getActivePickerColor();
    inputColor.value = pickerColor;

    if (labelStyleOptions) {
      labelStyleOptions.hidden = true;
    }

    syncCalendarToolCursor();
  }

  function isEraserPointer(e) {
    return Boolean(e && e.button === 2);
  }

  function isEraserInteraction() {
    return selectionUsesEraser || state.activeTool === 'eraser';
  }

  function clearSelectionPreview() {
    document.querySelectorAll('.day-cell.selecting, .day-cell.erasing').forEach((el) => {
      el.classList.remove('selecting', 'erasing');
    });
    selection.clear();
  }

  function updateSelectionPreview() {
    const isEraser = isEraserInteraction();
    document.querySelectorAll('.day-cell').forEach((el) => {
      const inSelection = selection.has(el.dataset.date);
      el.classList.toggle('selecting', !isEraser && inSelection);
      el.classList.toggle('erasing', isEraser && inSelection);
    });
  }

  function applySlashToSelection(dates) {
    const mode = normalizeSlashMode(state.slashMode);
    dates.forEach((d) => {
      state.slashes[d] = { mode };
      syncSlashLabelForDate(d, mode);
    });
  }

  function applyColorBoxToSelection(dates) {
    const color = state.activeColor;
    const borderColor = darkenColor(color, 40);

    dates.forEach((d) => removeDateFromColorGroups(d));

    state.colorGroups.push({
      id: uuid(),
      color,
      borderColor,
      dates: [...dates].sort(),
    });
  }

  function applyOutlineToSelection(dates) {
    const sorted = [...dates].sort();

    const existing = state.outlineGroups.find((g) => setsEqual(g.dates, sorted));
    if (existing) {
      return;
    }

    dates.forEach((d) => removeDateFromOutlineGroups(d));

    state.outlineGroups.push({
      id: uuid(),
      borderColor: OUTLINE_BORDER_COLOR,
      dates: sorted,
    });
  }

  function eraseSelection(dates) {
    dates.forEach((d) => {
      delete state.slashes[d];
      removeSlashLabelsForDate(d);
      removeDateFromColorGroups(d);
      removeDateFromOutlineGroups(d);
    });
  }

  function commitSelection() {
    const dates = [...selection].sort();
    if (dates.length === 0) return;

    const tool = selectionUsesEraser ? 'eraser' : state.activeTool;
    recordUndoBeforeChange();

    switch (tool) {
      case 'slash':
        applySlashToSelection(dates);
        break;
      case 'colorBox':
        applyColorBoxToSelection(dates);
        break;
      case 'transparentBox':
        applyOutlineToSelection(dates);
        break;
      case 'eraser':
        eraseSelection(dates);
        break;
      default:
        break;
    }

    saveSession();
    render();
  }

  function onMouseDown(e) {
    const cell = e.target.closest('.day-cell');
    if (!cell) return;
    e.preventDefault();
    selectionUsesEraser = isEraserPointer(e);
    isDragging = true;
    dragMoved = false;
    selection.clear();
    selection.add(cell.dataset.date);
    updateSelectionPreview();
  }

  function onMouseOver(e) {
    if (!isDragging) return;
    const cell = e.target.closest('.day-cell');
    if (!cell) return;
    if (!selection.has(cell.dataset.date)) {
      dragMoved = true;
    }
    selection.add(cell.dataset.date);
    updateSelectionPreview();
  }

  function onMouseUp() {
    if (!isDragging) return;
    isDragging = false;
    commitSelection();
    clearSelectionPreview();
    selectionUsesEraser = false;
  }

  function initMonthSelect() {
    selectMonth.innerHTML = MONTHS.map(
      (m) => `<option value="${m}">${m}월</option>`
    ).join('');
  }

  function bindEvents() {
    if (btnUndo) btnUndo.addEventListener('click', undo);
    if (btnRedo) btnRedo.addEventListener('click', redo);

    document.addEventListener('keydown', (e) => {
      if (moveSelectedFloatingLabelByArrow(e)) return;

      if (!shouldIgnoreToolShortcut(e)) {
        const shortcutTool = TOOL_SHORTCUTS[e.key.toLowerCase()];
        if (shortcutTool) {
          e.preventDefault();
          handleToolShortcut(shortcutTool);
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        const modKey = e.key.toLowerCase();
        if (modKey === 'c' || modKey === 'v') {
          if (shouldIgnoreUndoShortcut(e)) return;
          if (modKey === 'c') {
            if (copySelectedFloatingLabel()) e.preventDefault();
          } else if (pasteFloatingLabel()) {
            e.preventDefault();
          }
          return;
        }
      }

      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      if (shouldIgnoreUndoShortcut(e)) return;
      e.preventDefault();
      if (e.shiftKey) {
        redo();
      } else {
        undo();
      }
    });

    inputYear.addEventListener('change', () => {
      const y = parseInt(inputYear.value, 10);
      if (y >= 1900 && y <= 2100) {
        recordUndoBeforeChange();
        state.viewYear = y;
        activePanelKey = panelKey(state.viewYear, state.viewMonth);
        saveSession();
        render();
      }
    });

    selectMonth.addEventListener('change', () => {
      recordUndoBeforeChange();
      state.viewMonth = parseInt(selectMonth.value, 10);
      activePanelKey = panelKey(state.viewYear, state.viewMonth);
      saveSession();
      render();
    });

    document.getElementById('btn-new').addEventListener('click', createNew);
    document.getElementById('btn-save').addEventListener('click', saveCurrent);

    bindLabelColorSwatches();
    bindLabelTemplates();

    document.querySelectorAll('[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.tool === 'label' && btn.dataset.color) return;
        if (btn.dataset.tool === 'label' && btn.dataset.labelTemplate) return;
        state.activeTool = btn.dataset.tool;
        if (btn.dataset.slashMode) {
          state.slashMode = btn.dataset.slashMode;
        }
        if (btn.dataset.color) {
          setActivePickerColor(btn.dataset.color);
          inputColor.value = btn.dataset.color;
        }
        updateToolbar();
      });
    });

    inputColor.addEventListener('input', () => {
      setActivePickerColor(inputColor.value);
      state.activeTool = 'colorBox';
      updateToolbar();
    });

    labelStyleInputEls().forEach((el) => {
      if (!el) return;
      el.addEventListener('change', updateLabelStyleFromInputs);
      el.addEventListener('input', updateLabelStyleFromInputs);
    });

    document.addEventListener('mousemove', onFloatingLabelPointerMove);
    document.addEventListener('mousedown', handleFloatingLabelOutsidePointer, true);

    document.getElementById('save-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = inputSaveName.value.trim();
      if (!name) {
        alert('파일 이름을 입력해 주세요.');
        return;
      }

      let blob = pendingPngBlob;
      if (!blob) {
        try {
          blob = await renderSnapshotToPng(getSnapshot());
        } catch (err) {
          console.error('PNG render failed:', err);
          alert('이미지 파일 저장에 실패했습니다. 일정은 왼쪽 히스토리에 저장되었습니다.');
          return;
        }
      }

      const baseName = downloadPngBlob(blob, name);
      pendingPngBlob = null;
      syncHistoryAfterPngSave(baseName);
      saveDialog.close();
    });

    document.getElementById('btn-save-cancel').addEventListener('click', () => {
      pendingPngBlob = null;
      saveDialog.close();
    });

    document.getElementById('btn-unsaved-save').addEventListener('click', () => {
      closeUnsavedDialog('save');
    });
    document.getElementById('btn-unsaved-discard').addEventListener('click', () => {
      closeUnsavedDialog('discard');
    });
    document.getElementById('btn-unsaved-cancel').addEventListener('click', () => {
      closeUnsavedDialog('cancel');
    });
    unsavedDialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      closeUnsavedDialog('cancel');
    });

    document.getElementById('btn-apply-max').addEventListener('click', () => {
      let max = parseInt(inputMaxSaves.value, 10);
      if (Number.isNaN(max) || max < 1) max = 1;
      if (max > 500) max = 500;
      savesMeta.maxSaves = max;
      inputMaxSaves.value = max;
      trimSavesToMax();
      saveSavesMeta();
      renderHistoryTable();
    });

    if (inputHistorySearch) {
      inputHistorySearch.addEventListener('input', () => {
        historyUi.search = inputHistorySearch.value;
        renderHistoryTable();
      });
    }

    document.querySelectorAll('.sort-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const field = btn.dataset.sort;
        if (historyUi.sort.field === field) {
          historyUi.sort.dir = historyUi.sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          historyUi.sort.field = field;
          historyUi.sort.dir = field === 'name' ? 'asc' : 'desc';
        }
        renderHistoryTable();
      });
    });

    if (historyTbody) {
      historyTbody.addEventListener('click', (e) => {
        const nameBtn = e.target.closest('.history-name');
        if (nameBtn) {
          loadNamedSave(nameBtn.dataset.id);
          return;
        }
        const deleteBtn = e.target.closest('.history-delete-btn');
        if (deleteBtn) {
          openDeleteDialog(deleteBtn.dataset.id);
        }
      });
    }

    document.getElementById('btn-delete-confirm').addEventListener('click', () => {
      closeDeleteDialog(true);
    });
    document.getElementById('btn-delete-cancel').addEventListener('click', () => {
      closeDeleteDialog(false);
    });
    deleteDialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      closeDeleteDialog(false);
    });

    bindUpdateNewsDialog();

    document.addEventListener('mousemove', (e) => {
      updateColorBoxPreviewAtPoint(e.clientX, e.clientY);
    });
    document.addEventListener('mouseleave', hideColorBoxPreview);

    const calendarColumnEl = document.querySelector('.calendar-column');
    calendarColumnEl?.addEventListener(
      'scroll',
      () => {
        clearTimeout(activePanelScrollTimer);
        activePanelScrollTimer = setTimeout(() => {
          activePanelKey = getPanelKeyFromViewport();
        }, 100);
      },
      { passive: true }
    );

    stackEl.addEventListener('mousedown', (e) => {
      updateActivePanelFromPointer(e);

      const wrapEl = e.target.closest('.floating-label-wrap');
      if (wrapEl) {
        const id = wrapEl.dataset.id;

        if (e.target.closest('.floating-label-input')) {
          selectFloatingLabel(id);
          return;
        }

        if (e.target.closest('.floating-label-delete')) {
          e.preventDefault();
          e.stopPropagation();
          eraseFloatingLabel(id);
          return;
        }

        if (e.target.closest('.floating-label-resize')) {
          startFloatingLabelResize(e, wrapEl);
          return;
        }

        if (state.activeTool === 'eraser' || isEraserPointer(e)) {
          eraseFloatingLabel(id);
          return;
        }

        selectFloatingLabel(id);
        startFloatingLabelDrag(e, wrapEl);
        return;
      }

      if (state.activeTool === 'label' && !isEraserPointer(e)) {
        const monthGrid = e.target.closest('.month-grid');
        if (monthGrid) {
          e.preventDefault();
          createFloatingLabelAt(e);
        }
        return;
      }

      if (state.activeTool === 'pointer' && !isEraserPointer(e)) {
        const cell = e.target.closest('.day-cell');
        if (cell) {
          e.preventDefault();
          startMarkMoveDrag(cell.dataset.date);
        }
        return;
      }

      onMouseDown(e);
    });
    stackEl.addEventListener('dblclick', (e) => {
      const textEl = e.target.closest('.floating-label-text');
      if (!textEl) return;
      const wrapEl = textEl.closest('.floating-label-wrap');
      if (!wrapEl) return;
      e.preventDefault();
      startFloatingLabelEdit(wrapEl.dataset.id);
    });
    stackEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
    stackEl.addEventListener('mouseover', (e) => {
      if (markMoveDrag) {
        onMarkMoveOver(e);
        return;
      }
      onMouseOver(e);
    });
    document.addEventListener('mouseup', (e) => {
      endMarkMoveDrag();
      endFloatingLabelDrag(e);
      endFloatingLabelResize();
      onMouseUp();
    });

    window.addEventListener('resize', () => {
      clearTimeout(alignResizeTimer);
      alignResizeTimer = setTimeout(alignScheduleGroup, 100);
    });
  }

  function init() {
    initMonthSelect();
    loadSavesMeta();
    loadSession();
    state.labelStyle = clampLabelStyle(state.labelStyle);
    syncLabelStyleInputs();
    applyLabelStyleToDom();
    bindEvents();
    render();
    renderHistoryTable();
    resetUndoRedoHistory();
    showUpdateNewsDialogIfNeeded();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(scheduleAlignScheduleGroup);
    }
  }

  init();
})();
