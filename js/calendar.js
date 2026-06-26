(function () {
  'use strict';

  const SESSION_KEY = 'calendar-session-v1';
  const SAVES_KEY = 'calendar-saves-v1';
  const STORAGE_KEY_LEGACY = 'calendar-markings-v2';
  const STORAGE_KEY_V1 = 'calendar-markings-v1';
  const DEFAULT_MAX_SAVES = 100;
  const UPDATE_NEWS_VERSION = '10';
  const UPDATE_NEWS_DISMISS_KEY = 'calendar-update-news-dismissed';
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
  const WEEKDAY_ALIGN_CHAR = '수';
  const SCHEDULE_ALIGN_MOBILE_MAX = 640;
  const now = new Date();
  const DEFAULT_VIEW_YEAR = now.getFullYear();
  const DEFAULT_VIEW_MONTH = now.getMonth() + 1;
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
  const FLOATING_LABEL_SNAP_THRESHOLD_PX = 6;

  const DEFAULT_LABEL_STYLE = {
    size: 18,
    weight: 900,
    strokeWidth: 4,
    color: '#111111',
    align: 'center',
  };
  const LABEL_ALIGNS = ['left', 'center', 'right'];

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
    { text: '종료일', defaultColor: LABEL_TEXT_COLORS[2] },
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
    viewYear: DEFAULT_VIEW_YEAR,
    viewMonth: DEFAULT_VIEW_MONTH,
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
    documentTitle: '',
  };

  let isDragging = false;
  let dragMoved = false;
  let selectionUsesEraser = false;
  let floatingLabelDrag = null;
  let floatingLabelResize = null;
  let selectedFloatingLabelIds = new Set();
  let primaryFloatingLabelId = null;
  let editingFloatingLabelId = null;
  let copiedFloatingLabel = null;
  let pasteRepeatCount = 0;
  const labelTemplatePlaceCounts = {};
  let markMoveDrag = null;
  let markMoveDropTargetKey = null;
  let labelMarqueeDrag = null;
  let labelMarqueeEl = null;
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
  const inputDocumentTitle = document.getElementById('input-document-title');

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

  function getCurrentViewDate() {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }

  function applyCurrentViewDefaults(target = state) {
    const currentView = getCurrentViewDate();
    target.viewYear = currentView.year;
    target.viewMonth = currentView.month;
    return target;
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
    boxRadius: 0,
    slashLine: 2,
    outlineBorder: 1,
  };

  const PNG_EXPORT_BORDER_PX = 1;
  const PNG_EXPORT_LABEL_STROKE_PX = 4;
  const JPG_EXPORT_QUALITY = 0.92;
  const JPG_EXPORT_SIZE_SCALE = 0.8;

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

  function getCalendarDisplayScale() {
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--calendar-display-scale'));
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  function getCalendarUiScale() {
    const uiScale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--calendar-ui-scale'));
    if (Number.isFinite(uiScale) && uiScale > 0) return uiScale;
    return getCalendarScale() * getCalendarDisplayScale();
  }

  function getToolSlashLinePx() {
    const rootStyle = getComputedStyle(document.documentElement);
    return parsePx(rootStyle.getPropertyValue('--tool-slash-line'), 2);
  }

  function scaledToolMarkFallbacks() {
    const scale = getCalendarUiScale();
    return {
      boxSize: 40 * scale,
      boxBorder: 1,
      boxRadius: 0,
      slashLine: getToolSlashLinePx(),
      outlineBorder: 1,
    };
  }

  function readToolMarkMetrics() {
    const fallback = scaledToolMarkFallbacks();
    const markInner = stackEl?.querySelector('.day-cell:not(.has-outline) .day-inner');
    if (markInner) {
      const layoutWidth = markInner.offsetWidth;
      if (layoutWidth > 0) {
        const cs = getComputedStyle(markInner);
        return {
          boxSize: layoutWidth,
          boxBorder: fallback.boxBorder,
          boxRadius: parsePx(cs.borderTopLeftRadius, fallback.boxRadius),
          slashLine: getToolSlashLinePx(),
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
      pathRoundRect(ctx, inset, inset, w - border, h - border, 0);
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

  function normalizeLabelAlign(align) {
    return LABEL_ALIGNS.includes(align) ? align : DEFAULT_LABEL_STYLE.align;
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
      align: normalizeLabelAlign(raw.align),
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

  function getFloatingLabelAlign(label) {
    return normalizeLabelAlign(label?.align);
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
      ...state.labelStyle,
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
      documentTitle: state.documentTitle,
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
        align: normalizeLabelAlign(l.align),
      })),
      documentTitle: String(copy.documentTitle || ''),
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
    state.floatingLabels = sanitizeFloatingLabels(d.floatingLabels).map((label) => ({
      ...label,
      align: normalizeLabelAlign(label.align),
    }));
    if (d.labelCoordSpace === 'area') {
      state.labelCoordSpace = 'area';
    } else {
      state.labelCoordSpace = 'grid';
    }
    if (d.documentTitle != null) {
      state.documentTitle = String(d.documentTitle);
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
    const rowFrac =
      placement === 'below' ? 0.85 : placement === 'center' ? 0.5 : 0.15;
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

  function getVisiblePanelKeys() {
    const keys = [];
    for (let i = 0; i < state.visibleMonthCount; i++) {
      const { year, month } = addMonths(state.viewYear, state.viewMonth, i);
      keys.push(panelKey(year, month));
    }
    return keys;
  }

  function dateKeyToGridFraction(key, placement) {
    const positions = collectDateGridPositions(key, placement);
    if (positions.length === 0) return null;

    const visiblePanelKeys = new Set(getVisiblePanelKeys());
    const visiblePositions = positions.filter((pos) => visiblePanelKeys.has(pos.panel));
    if (visiblePositions.length === 0) return null;

    const [dateYear, dateMonth] = key.split('-').map(Number);
    const owningPanel = visiblePositions.find((pos) => {
      const [panelYear, panelMonth] = pos.panel.split('-').map(Number);
      if (panelYear !== dateYear || panelMonth !== dateMonth) return false;
      const hasNextPanel = getHasNextPanelForPanelKey(pos.panel);
      return isDateInPanelGrid(key, pos.panel, hasNextPanel);
    });
    return owningPanel || visiblePositions[0];
  }

  function normalizeSlashMode(mode) {
    if (mode === 'holiday' || mode === 'postpone' || mode === 'plain') return mode;
    return 'plain';
  }

  function getHasNextPanelForPanelKey(panelKeyStr) {
    for (let i = 0; i < state.visibleMonthCount; i++) {
      const { year, month } = addMonths(state.viewYear, state.viewMonth, i);
      if (panelKey(year, month) === panelKeyStr) {
        return i < state.visibleMonthCount - 1;
      }
    }
    return false;
  }

  function getWeekCountForPanelKey(key) {
    const [year, month] = key.split('-').map(Number);
    const hasNextPanel = getHasNextPanelForPanelKey(key);
    let cells = buildMonthCells(year, month);
    cells = trimTrailingWeekWhenNextPanelVisible(cells, hasNextPanel);
    return cells.length / 7;
  }

  function getLabelAreaHeaderHeight(layout) {
    return layout.titleFont + layout.titleGap + layout.weekdaysFont + layout.weekdaysGap;
  }

  function getMonthGridAreaHeight(weekCount, layout) {
    return getLabelAreaHeaderHeight(layout) + weekCount * layout.cellH;
  }

  function getWeekCountFromDom(panelKeyStr) {
    const monthGrid = getMonthGridForPanelKey(panelKeyStr);
    const raw = monthGrid
      ?.querySelector('.days-grid-wrap')
      ?.style.getPropertyValue('--calendar-week-count');
    const count = Number(raw);
    return count > 0 ? count : null;
  }

  function ensureFloatingLabelPixelAnchor(label) {
    if (!label?.anchorDate || SLASH_LABEL_TEXTS.has(label.text)) return;
    if (label.anchorOffsetPxY != null && Number.isFinite(label.anchorOffsetPxY)) return;

    const gridH = getMonthGridHeightForLabelAnchor(label);
    if (label.anchorOffsetY != null && Number.isFinite(label.anchorOffsetY)) {
      label.anchorOffsetPxY = label.anchorOffsetY * gridH;
    }
  }

  function getDateAreaCenterFromDom(dateKeyStr, panelKeyStr) {
    const monthGrid = getMonthGridForPanelKey(panelKeyStr);
    const cell = monthGrid?.querySelector(`.day-cell[data-date="${dateKeyStr}"]`);
    if (!cell || !monthGrid) return null;

    const gridRect = monthGrid.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    if (gridRect.width <= 0 || gridRect.height <= 0) return null;

    return {
      panel: panelKeyStr,
      x: clamp01((cellRect.left + cellRect.width / 2 - gridRect.left) / gridRect.width),
      y: clamp01((cellRect.top + cellRect.height / 2 - gridRect.top) / gridRect.height),
    };
  }

  function findAnchorDateForFloatingLabelFromDom(label) {
    const monthGrid = getMonthGridForPanelKey(label.panel);
    if (!monthGrid) return null;

    const point = labelCoordsToClientPoint(label);
    if (!point) return null;

    for (const cell of monthGrid.querySelectorAll('.day-cell')) {
      const rect = cell.getBoundingClientRect();
      if (
        point.x >= rect.left &&
        point.x <= rect.right &&
        point.y >= rect.top &&
        point.y <= rect.bottom
      ) {
        return {
          dateKey: cell.dataset.date,
          hasNextPanel: getHasNextPanelForPanelKey(label.panel),
        };
      }
    }
    return null;
  }

  function getMonthGridHeightForLabelAnchor(label) {
    const monthGrid = getMonthGridForPanelKey(label?.panel);
    const gridRect = monthGrid?.getBoundingClientRect();
    if (gridRect && gridRect.height > 0) return gridRect.height;

    const weekCount = getWeekCountForPanelKey(label?.panel);
    const layout = getPngExportLayout();
    return getMonthGridAreaHeight(weekCount, layout);
  }

  function setFloatingLabelAnchorOffsets(label, center, weekCount, layout) {
    if (!label || !center) return;
    const gridH = getMonthGridHeightForLabelAnchor(label);
    label.anchorOffsetX = label.x - center.x;
    label.anchorOffsetPxY = (label.y - center.y) * gridH;
    label.anchorWeekCount = weekCount;
    delete label.anchorOffsetY;
  }

  function gridFractionYToAreaY(yGrid, weekCount, layout) {
    const headerH = getLabelAreaHeaderHeight(layout);
    const gridH = weekCount * layout.cellH;
    const areaH = headerH + gridH;
    if (areaH <= 0) return clamp01(yGrid);
    return clamp01((headerH + yGrid * gridH) / areaH);
  }

  function getDateAreaCenter(dateKey, panelYear, panelMonth, hasNextPanel) {
    const panelKeyStr = panelKey(panelYear, panelMonth);
    const domCenter = getDateAreaCenterFromDom(dateKey, panelKeyStr);
    if (domCenter) return domCenter;

    const [y, m, d] = dateKey.split('-').map(Number);
    const gridPos = findDateInMonthGrid(y, m, d, panelYear, panelMonth, hasNextPanel);
    if (!gridPos) return null;
    const layout = getPngExportLayout();
    const x = (gridPos.col + 0.5) / 7;
    const yGrid = (gridPos.row + 0.5) / gridPos.weekCount;
    return {
      panel: panelKey(panelYear, panelMonth),
      x,
      y: gridFractionYToAreaY(yGrid, gridPos.weekCount, layout),
    };
  }

  function getDateCellAreaBounds(panelYear, panelMonth, hasNextPanel, row, col, weekCount) {
    const layout = getPngExportLayout();
    const x0 = col / 7;
    const x1 = (col + 1) / 7;
    const yGrid0 = row / weekCount;
    const yGrid1 = (row + 1) / weekCount;
    return {
      x0,
      x1,
      y0: gridFractionYToAreaY(yGrid0, weekCount, layout),
      y1: gridFractionYToAreaY(yGrid1, weekCount, layout),
    };
  }

  function isDateInPanelGrid(dateKeyStr, panelKeyStr, hasNextPanel) {
    const [y, m, d] = dateKeyStr.split('-').map(Number);
    const [panelYear, panelMonth] = panelKeyStr.split('-').map(Number);
    return Boolean(findDateInMonthGrid(y, m, d, panelYear, panelMonth, hasNextPanel));
  }

  function findAnchorDateForFloatingLabel(label, hasNextPanelOverride = null) {
    if (!label?.panel) return null;

    const domMatch = findAnchorDateForFloatingLabelFromDom(label);
    if (domMatch) {
      if (hasNextPanelOverride != null) {
        return { ...domMatch, hasNextPanel: hasNextPanelOverride };
      }
      return domMatch;
    }

    const [panelYear, panelMonth] = label.panel.split('-').map(Number);
    const x = Number(label.x);
    const y = Number(label.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    const hasNextPanel =
      hasNextPanelOverride ?? getHasNextPanelForPanelKey(label.panel);
    let cells = buildMonthCells(panelYear, panelMonth);
    cells = trimTrailingWeekWhenNextPanelVisible(cells, hasNextPanel);
    const weekCount = cells.length / 7;

    for (let idx = 0; idx < cells.length; idx++) {
      const row = Math.floor(idx / 7);
      const col = idx % 7;
      const bounds = getDateCellAreaBounds(
        panelYear,
        panelMonth,
        hasNextPanel,
        row,
        col,
        weekCount
      );
      if (x >= bounds.x0 && x <= bounds.x1 && y >= bounds.y0 && y <= bounds.y1) {
        const cell = cells[idx];
        return {
          dateKey: dateKey(cell.year, cell.month, cell.day),
          hasNextPanel,
        };
      }
    }
    return null;
  }

  function anchorFloatingLabelToDate(label, dateKeyStr, panelYear, panelMonth) {
    if (!label || !dateKeyStr) return;
    const hasNextPanel = getHasNextPanelForPanelKey(panelKey(panelYear, panelMonth));
    const weekCount = getWeekCountForPanelKey(panelKey(panelYear, panelMonth));
    const layout = getPngExportLayout();
    const center = getDateAreaCenter(dateKeyStr, panelYear, panelMonth, hasNextPanel);
    label.anchorDate = dateKeyStr;
    delete label.panelAnchorX;
    delete label.panelAnchorPxY;
    if (center) {
      setFloatingLabelAnchorOffsets(label, center, weekCount, layout);
    } else {
      delete label.anchorOffsetX;
      delete label.anchorOffsetPxY;
      delete label.anchorWeekCount;
      delete label.anchorOffsetY;
    }
  }

  function captureFreeFloatingPanelAnchor(label) {
    if (!label || SLASH_LABEL_TEXTS.has(label.text)) return;
    const gridH = getMonthGridHeightForLabelAnchor(label);
    label.panelAnchorX = clamp01(Number(label.x) || 0);
    label.panelAnchorPxY = clamp01(Number(label.y) || 0) * gridH;
    delete label.anchorDate;
    delete label.anchorOffsetX;
    delete label.anchorOffsetPxY;
    delete label.anchorWeekCount;
    delete label.anchorOffsetY;
  }

  function ensureFreeFloatingPanelAnchor(label) {
    if (!label || label.anchorDate || SLASH_LABEL_TEXTS.has(label.text)) return;
    if (
      label.panelAnchorPxY != null &&
      Number.isFinite(label.panelAnchorPxY) &&
      label.panelAnchorX != null &&
      Number.isFinite(label.panelAnchorX)
    ) {
      return;
    }
    const gridH = getMonthGridHeightForLabelAnchor(label);
    label.panelAnchorX = clamp01(Number(label.x) || 0);
    label.panelAnchorPxY = clamp01(Number(label.y) || 0) * gridH;
  }

  function layoutFreeFloatingLabelFromPanelAnchor(label) {
    if (!label || label.anchorDate || SLASH_LABEL_TEXTS.has(label.text)) return false;

    const visibleKeys = getVisiblePanelKeys();
    if (visibleKeys.length === 0) return false;
    if (!visibleKeys.includes(label.panel)) {
      label.panel = visibleKeys[visibleKeys.length - 1];
    }

    ensureFreeFloatingPanelAnchor(label);

    const gridH = getMonthGridHeightForLabelAnchor(label);
    if (gridH <= 0) return false;

    const prevX = label.x;
    const prevY = label.y;
    label.x = clamp01(label.panelAnchorX);
    label.y = clamp01(label.panelAnchorPxY / gridH);
    return prevX !== label.x || prevY !== label.y;
  }

  function storeFloatingLabelOffsetsFromPosition(label) {
    if (!label?.anchorDate) return;

    const [panelYear, panelMonth] = label.panel.split('-').map(Number);
    const hasNextPanel = getHasNextPanelForPanelKey(label.panel);
    const center = getDateAreaCenter(label.anchorDate, panelYear, panelMonth, hasNextPanel);
    if (!center) return;

    const gridH = getMonthGridHeightForLabelAnchor(label);
    label.anchorOffsetX = label.x - center.x;
    label.anchorOffsetPxY = (label.y - center.y) * gridH;
    label.anchorWeekCount = getWeekCountForPanelKey(label.panel);
    delete label.anchorOffsetY;
  }

  function captureFloatingLabelAnchor(label) {
    if (!label || SLASH_LABEL_TEXTS.has(label.text)) return;

    const match = findAnchorDateForFloatingLabel(label);
    if (!match) {
      captureFreeFloatingPanelAnchor(label);
      return;
    }

    label.anchorDate = match.dateKey;
    delete label.panelAnchorX;
    delete label.panelAnchorPxY;
    storeFloatingLabelOffsetsFromPosition(label);
  }

  function applyFloatingLabelAnchor(label) {
    if (!label?.anchorDate || SLASH_LABEL_TEXTS.has(label.text)) return false;

    ensureFloatingLabelPixelAnchor(label);

    const gridPos = dateKeyToGridFraction(label.anchorDate, 'center');
    if (!gridPos) return false;

    const visiblePanelKeys = new Set(getVisiblePanelKeys());
    if (!visiblePanelKeys.has(gridPos.panel)) return false;

    const [panelYear, panelMonth] = gridPos.panel.split('-').map(Number);
    const hasNextPanel = getHasNextPanelForPanelKey(gridPos.panel);
    const center = getDateAreaCenter(label.anchorDate, panelYear, panelMonth, hasNextPanel);
    if (!center) return false;

    const gridH = getMonthGridHeightForLabelAnchor({ ...label, panel: gridPos.panel });
    const weekCount = getWeekCountForPanelKey(gridPos.panel);

    label.panel = gridPos.panel;
    label.x = clamp01(center.x + (Number(label.anchorOffsetX) || 0));
    if (label.anchorOffsetPxY != null && Number.isFinite(label.anchorOffsetPxY)) {
      label.y = clamp01(center.y + label.anchorOffsetPxY / gridH);
    } else {
      label.y = clamp01(center.y + (Number(label.anchorOffsetY) || 0));
    }
    label.anchorWeekCount = weekCount;
    return true;
  }

  function floatingLabelNeedsAnchorRelayout(label) {
    if (!label?.anchorDate) return false;

    const visiblePanelKeys = getVisiblePanelKeys();
    if (!visiblePanelKeys.includes(label.panel)) return true;

    const gridPos = dateKeyToGridFraction(label.anchorDate, 'center');
    if (!gridPos || !visiblePanelKeys.includes(gridPos.panel)) return true;

    const weekCount = getWeekCountForPanelKey(gridPos.panel);
    return label.anchorWeekCount == null || label.anchorWeekCount !== weekCount;
  }

  function layoutManualFloatingLabelsFromAnchors() {
    let changed = false;

    state.floatingLabels.forEach((label) => {
      if (SLASH_LABEL_TEXTS.has(label.text)) return;

      const prevPanel = label.panel;
      const prevX = label.x;
      const prevY = label.y;

      if (label.anchorDate) {
        ensureFloatingLabelPixelAnchor(label);
        if (floatingLabelNeedsAnchorRelayout(label)) {
          applyFloatingLabelAnchor(label);
        }
      } else {
        layoutFreeFloatingLabelFromPanelAnchor(label);
      }

      if (prevPanel !== label.panel || prevX !== label.x || prevY !== label.y) {
        changed = true;
      }
    });

    return changed;
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

  function getDateKeyForSlashLabel(label) {
    if (!label || !SLASH_LABEL_TEXTS.has(label.text)) return null;
    if (label.slashDateKey && state.slashes[label.slashDateKey]) {
      const mode = normalizeSlashMode(state.slashes[label.slashDateKey].mode);
      if (SLASH_MODE_LABELS[mode] === label.text) return label.slashDateKey;
    }
    return Object.keys(state.slashes).find((key) => isSlashLabelAtDate(label, key)) || null;
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
      existing.slashDateKey = dateKey;
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
      align: DEFAULT_LABEL_STYLE.align,
      slashDateKey: dateKey,
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
      align: DEFAULT_LABEL_STYLE.align,
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
    return (
      !snapshotsEqual(getSnapshot(), entry.data) ||
      state.documentTitle.trim() !== String(entry.name || '').trim()
    );
  }

  function updateActiveSave() {
    const entry = savesMeta.saves.find((s) => s.id === activeSaveId);
    if (!entry) return;
    entry.data = getSnapshot();
    entry.savedAt = new Date().toISOString();
    const name = sanitizeFileBaseName(getDefaultSaveBaseName());
    if (entry.name !== name) {
      entry.name = name;
    }
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
    const saveName = sanitizeFileBaseName(name);
    state.documentTitle = saveName;
    syncDocumentTitleInput();
    updatePageTitle();
    const entry = {
      id: uuid(),
      name: saveName,
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
    state.documentTitle = entry.name || '';
    entry.data = getSnapshot();
    syncDocumentTitleInput();
    updatePageTitle();
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
    const title = state.documentTitle.trim();
    if (title) return title;
    if (activeSaveId) {
      const entry = savesMeta.saves.find((s) => s.id === activeSaveId);
      if (entry?.name) return entry.name;
    }
    return `${state.viewYear}년 ${state.viewMonth}월 일정`;
  }

  function stripImageExtension(name) {
    return String(name).replace(/\.(png|jpe?g)$/i, '').trim();
  }

  function sanitizeFileBaseName(name) {
    const cleaned = String(name).replace(/[<>:"/\\|?*]/g, '_').trim();
    return cleaned || getDefaultSaveBaseName();
  }

  function gridColOrigin(gridLeft, col, layout) {
    return gridLeft + col * (layout.cellW + layout.colGap);
  }

  function getPngExportLayout() {
    const scale = getCalendarUiScale();
    const displayScale = getCalendarDisplayScale();
    const m = readToolMarkMetrics();
    let cellW = (17 + 39) * displayScale;
    let cellH = (17 + 39) * displayScale;
    let cardPadX = 15 * scale;
    let cardWidth = cellW * 7 + cardPadX * 2;
    let cardPadTop = 20 * scale;
    let cardPadBottom = 12 * scale;
    let titleFont = 17 * displayScale;
    let titleGap = 39 * displayScale;
    let weekdaysFont = 17 * displayScale;
    let weekdaysGap = 19.5 * displayScale;
    let textSize = 17 * displayScale;
    let colGap = 0;
    let panelMargin = 4 * scale;

    const panel = stackEl?.querySelector('.month-panel');
    const card = panel?.querySelector('.month-card');
    const cell = panel?.querySelector('.day-cell');
    const titleEl = panel?.querySelector('.month-title');
    const weekdaysEl = panel?.querySelector('.weekdays');
    const dayNumberEl = panel?.querySelector('.day-number');
    const gridEl = panel?.querySelector('.days-grid');

    if (gridEl) {
      const gridStyle = getComputedStyle(gridEl);
      colGap = parsePx(gridStyle.columnGap, colGap);
    }

    if (cell) {
      if (cell.offsetWidth > 0) cellW = cell.offsetWidth;
      if (cell.offsetHeight > 0) cellH = cell.offsetHeight;
    }
    if (card) {
      if (card.offsetWidth > 0) cardWidth = card.offsetWidth;
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
        const firstRect = firstCard.getBoundingClientRect();
        const secondRect = secondCard.getBoundingClientRect();
        const gap = secondRect.top - firstRect.bottom;
        if (gap > 0) panelMargin = gap;
      } else if (panels[0]) {
        panelMargin = parsePx(getComputedStyle(panels[0]).marginBottom, panelMargin);
      }
    } else if (panel) {
      panelMargin = parsePx(getComputedStyle(panel).marginBottom, panelMargin);
    }

    return {
      scale,
      cellW,
      cellH,
      colGap,
      calendarWidth: cellW * 7 + colGap * 6,
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
      outlinePadY: 4,
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

  function drawStrokedLabelText(ctx, text, x, y, fontSize, fontWeight, fillColor, strokeWidth, align = DEFAULT_LABEL_STYLE.align) {
    const font = `${fontWeight} ${fontSize}px "BM JUA", "Malgun Gothic", sans-serif`;
    ctx.font = font;
    const normalizedAlign = normalizeLabelAlign(align);
    ctx.textAlign = normalizedAlign;
    ctx.textBaseline = 'middle';
    const lines = String(text).split('\n');
    const lineHeight = fontSize * 1.2;
    const totalHeight = lines.length * lineHeight;
    const startY = y - (totalHeight - lineHeight) / 2;
    const maxLineWidth = lines.reduce(
      (max, line) => Math.max(max, ctx.measureText(line || '\u00A0').width),
      0
    );
    const drawX =
      normalizedAlign === 'left'
        ? x - maxLineWidth / 2
        : normalizedAlign === 'right'
          ? x + maxLineWidth / 2
          : x;

    if (strokeWidth > 0) {
      ctx.lineWidth = strokeWidth;
      ctx.strokeStyle = '#fff';
      ctx.lineJoin = 'round';
    }
    ctx.fillStyle = fillColor;

    lines.forEach((line, i) => {
      const lineY = startY + i * lineHeight;
      if (strokeWidth > 0) {
        ctx.strokeText(line, drawX, lineY);
      }
      ctx.fillText(line, drawX, lineY);
    });
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
      ctx.fillText(label, gridColOrigin(gridLeft, i, layout) + layout.cellW / 2, weekdaysY);
    });

    cells.forEach((cell, index) => {
      const row = Math.floor(index / 7);
      const col = index % 7;
      const key = dateKey(cell.year, cell.month, cell.day);
      const cellX = gridColOrigin(gridLeft, col, layout);
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
        const x = gridColOrigin(gridLeft, minC, layout) + layout.outlinePadX;
        const y = gridTop + minR * layout.cellH + layout.outlinePadY;
        const w =
          (maxC - minC + 1) * layout.cellW + (maxC - minC) * layout.colGap - layout.outlinePadX * 2;
        const h = (maxR - minR + 1) * layout.cellH - layout.outlinePadY * 2;
        ctx.strokeStyle = group.borderColor || OUTLINE_BORDER_COLOR;
        ctx.lineWidth = layout.outlineBorder;
        pathRoundRect(ctx, x, y, w, h, 0);
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
          PNG_EXPORT_LABEL_STROKE_PX,
          getFloatingLabelAlign(label)
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

    const exportScale = layout.pixelRatio * JPG_EXPORT_SIZE_SCALE;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(layout.cardWidth * exportScale);
    canvas.height = Math.ceil(totalHeight * exportScale);
    const ctx = canvas.getContext('2d');
    ctx.scale(exportScale, exportScale);
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
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('JPG 생성 실패'));
        },
        'image/jpeg',
        JPG_EXPORT_QUALITY
      );
    });
  }

  function saveHistoryBeforePng() {
    const name = sanitizeFileBaseName(getDefaultSaveBaseName());
    if (activeSaveId) {
      const entry = savesMeta.saves.find((s) => s.id === activeSaveId);
      if (entry && entry.name !== name) {
        entry.name = name;
        saveSavesMeta();
        renderHistoryTable();
      }
      updateActiveSave();
    } else {
      namedSave(name);
    }
    saveSession();
  }

  async function writeJpgWithPicker(blob, suggestedBaseName) {
    const base = sanitizeFileBaseName(suggestedBaseName);
    const handle = await window.showSaveFilePicker({
      suggestedName: `${base}.jpg`,
      startIn: 'desktop',
      id: 'calendar-schedule-save',
      types: [
        {
          description: 'JPEG 이미지',
          accept: { 'image/jpeg': ['.jpg', '.jpeg'] },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return stripImageExtension(handle.name || `${base}.jpg`);
  }

  function downloadJpgBlob(blob, fileName) {
    const safe = sanitizeFileBaseName(fileName);
    const fullName = `${safe}.jpg`;
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
    state.documentTitle = name;
    syncDocumentTitleInput();
    updatePageTitle();
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
        const savedName = await writeJpgWithPicker(blob, suggested);
        syncHistoryAfterPngSave(savedName);
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }

    openSaveDialogForPngFallback(blob, suggested);
  }

  function createNewCore() {
    applyCurrentViewDefaults();
    state.slashes = {};
    state.colorGroups = [];
    state.outlineGroups = [];
    state.floatingLabels = [];
    state.visibleMonthCount = 1;
    state.documentTitle = '';
    activeSaveId = null;
    activePanelKey = panelKey(state.viewYear, state.viewMonth);
    syncDocumentTitleInput();
    updatePageTitle();
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
      return {
        sourceKey,
        moveType: 'color',
        color: colorGroup.color,
        borderColor: colorGroup.borderColor,
      };
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
    document
      .querySelectorAll(
        '.day-cell.move-preview-cell, .day-cell.move-preview-invalid, .day-cell.mark-move-preview-color, .day-cell.mark-move-preview-slash'
      )
      .forEach((el) => {
        el.classList.remove(
          'move-preview-cell',
          'move-preview-invalid',
          'mark-move-preview-color',
          'mark-move-preview-slash'
        );
        el.style.removeProperty('--preview-box-bg');
        el.style.removeProperty('--preview-box-border');
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
    if (payload.moveType === 'color') {
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

  function renderColorMovePreview(dates, invalid, payload) {
    if (!stackEl) return;
    const color = payload.color || '#c8e6c9';
    const borderColor = payload.borderColor || darkenColor(color, 40);
    dates.forEach((key) => {
      const cell = stackEl.querySelector(`.day-cell[data-date="${key}"]`);
      if (!cell) return;
      cell.classList.add(
        invalid ? 'move-preview-invalid' : 'move-preview-cell',
        'mark-move-preview-color'
      );
      cell.style.setProperty('--preview-box-bg', color);
      cell.style.setProperty('--preview-box-border', borderColor);
    });
  }

  function renderSlashMovePreview(dates, invalid) {
    if (!stackEl) return;
    dates.forEach((key) => {
      const cell = stackEl.querySelector(`.day-cell[data-date="${key}"]`);
      if (!cell) return;
      cell.classList.add(
        invalid ? 'move-preview-invalid' : 'move-preview-cell',
        'mark-move-preview-slash'
      );
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
    } else if (markMoveDrag.moveType === 'color') {
      renderColorMovePreview(shiftedDates, invalid, markMoveDrag);
    } else if (markMoveDrag.moveType === 'slash') {
      renderSlashMovePreview(shiftedDates, invalid);
    } else {
      highlightPreviewCells(shiftedDates, invalid);
    }
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

  function canMoveColorBox(sourceKey, targetKey) {
    if (sourceKey === targetKey) return false;
    return Boolean(getColorGroupForDate(sourceKey) && !getColorGroupForDate(targetKey));
  }

  function canCopyColorBox(sourceKey, targetKey) {
    if (sourceKey === targetKey) return false;
    return Boolean(getColorGroupForDate(sourceKey) && !getColorGroupForDate(targetKey));
  }

  function moveColorBox(sourceKey, targetKey, payload) {
    if (!canMoveColorBox(sourceKey, targetKey)) return false;
    const sourceGroup = getColorGroupForDate(sourceKey);
    const color = payload.color || sourceGroup.color;
    const borderColor = payload.borderColor || sourceGroup.borderColor || darkenColor(color, 40);
    removeDateFromColorGroups(sourceKey);
    state.colorGroups.push({
      id: uuid(),
      color,
      borderColor,
      dates: [targetKey],
    });
    return true;
  }

  function copyColorBox(sourceKey, targetKey, payload) {
    if (!canCopyColorBox(sourceKey, targetKey)) return false;
    const sourceGroup = getColorGroupForDate(sourceKey);
    const color = payload.color || sourceGroup.color;
    const borderColor = payload.borderColor || sourceGroup.borderColor || darkenColor(color, 40);
    state.colorGroups.push({
      id: uuid(),
      color,
      borderColor,
      dates: [targetKey],
    });
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

  function canCopyOutlineGroup(groupId, deltaDays) {
    const group = state.outlineGroups.find((g) => g.id === groupId);
    if (!group) return false;
    return group.dates.every((d) => !getOutlineGroupForDate(shiftDateKey(d, deltaDays)));
  }

  function copyOutlineGroup(groupId, deltaDays) {
    const group = state.outlineGroups.find((g) => g.id === groupId);
    if (!group || !canCopyOutlineGroup(groupId, deltaDays)) return false;
    state.outlineGroups.push({
      id: uuid(),
      borderColor: group.borderColor || OUTLINE_BORDER_COLOR,
      dates: group.dates.map((d) => shiftDateKey(d, deltaDays)).sort(),
    });
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

  function canCopySlash(sourceKey, targetKey) {
    if (sourceKey === targetKey) return false;
    return Boolean(state.slashes[sourceKey] && !state.slashes[targetKey]);
  }

  function copySlash(sourceKey, targetKey, payload) {
    if (!canCopySlash(sourceKey, targetKey)) return false;
    const slash = state.slashes[sourceKey];
    const mode = normalizeSlashMode(payload.slashMode || slash.mode);
    state.slashes[targetKey] = { mode };
    syncSlashLabelForDate(targetKey, mode);
    return true;
  }

  function canApplyMarkMove(payload, sourceKey, targetKey) {
    const deltaDays = diffDays(sourceKey, targetKey);
    if (deltaDays === 0) return false;
    if (payload.copyMode) {
      if (payload.moveType === 'outline') {
        return canCopyOutlineGroup(payload.groupId, deltaDays);
      }
      if (payload.moveType === 'color') {
        return canCopyColorBox(sourceKey, targetKey);
      }
      if (payload.moveType === 'slash') {
        return canCopySlash(sourceKey, targetKey);
      }
      return false;
    }
    if (payload.moveType === 'outline') {
      return canMoveOutlineGroup(payload.groupId, deltaDays);
    }
    if (payload.moveType === 'color') {
      return canMoveColorBox(sourceKey, targetKey);
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
    if (payload.copyMode && payload.moveType === 'outline') {
      changed = copyOutlineGroup(payload.groupId, deltaDays);
    } else if (payload.copyMode && payload.moveType === 'color') {
      changed = copyColorBox(sourceKey, targetKey, payload);
    } else if (payload.copyMode && payload.moveType === 'slash') {
      changed = copySlash(sourceKey, targetKey, payload);
    } else if (payload.moveType === 'outline') {
      changed = moveOutlineGroup(payload.groupId, deltaDays);
    } else if (payload.moveType === 'color') {
      changed = moveColorBox(sourceKey, targetKey, payload);
    } else if (payload.moveType === 'slash') {
      changed = moveSlash(sourceKey, targetKey);
    }
    if (!changed) return false;
    saveSession();
    render();
    return true;
  }

  function startMarkMoveDrag(sourceKey, e) {
    const payload = collectMarkMovePayload(sourceKey);
    if (!payload) return;
    markMoveDrag = { ...payload, copyMode: Boolean(e?.altKey) };
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
    const lineHeight = fontSize * 1.2;
    const lines = (input.value || '\u00A0').split('\n');

    if (!floatingLabelMeasureCanvas) {
      floatingLabelMeasureCanvas = document.createElement('canvas');
    }
    const ctx = floatingLabelMeasureCanvas.getContext('2d');
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    let maxWidth = 0;
    lines.forEach((line) => {
      const lineText = line || '\u00A0';
      maxWidth = Math.max(maxWidth, ctx.measureText(lineText).width);
    });

    const strokeWidth = stackEl
      ? parseFloat(getComputedStyle(stackEl).getPropertyValue('--user-label-stroke-width')) ||
        state.labelStyle.strokeWidth ||
        0
      : state.labelStyle.strokeWidth || 0;
    const padX = 8 + strokeWidth * 2 + 4;
    const border = 2;
    const minWidth = fontSize * 1.5;
    input.style.width = `${Math.ceil(Math.max(minWidth, maxWidth + padX + border))}px`;
    input.style.height = `${Math.ceil(lines.length * lineHeight + border)}px`;
  }

  function createFloatingLabelInputElement(label) {
    const input = document.createElement('textarea');
    input.className = 'floating-label-input';
    input.draggable = false;
    input.rows = 1;
    input.wrap = 'off';
    input.value = label.text;
    input.style.color = label.color || '#111';
    input.style.fontSize = `${getFloatingLabelSize(label)}px`;
    input.style.textAlign = getFloatingLabelAlign(label);
    syncFloatingLabelInputWidth(input);
    return input;
  }

  function bindFloatingLabelInputEvents(input, id) {
    if (input.dataset.bound === '1') return;
    input.dataset.bound = '1';
    input.addEventListener('input', () => syncFloatingLabelInputWidth(input));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        commitFloatingLabelEdit();
      } else if (
        e.code === 'NumpadEnter' ||
        (e.key === 'Enter' && (e.ctrlKey || e.metaKey))
      ) {
        e.preventDefault();
        commitFloatingLabelEdit();
      }
      e.stopPropagation();
    });
    input.addEventListener('mousedown', (e) => e.stopPropagation());
    input.addEventListener('dragstart', (e) => e.preventDefault());
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
    textEl.style.textAlign = getFloatingLabelAlign(label);
    if (input) {
      input.replaceWith(textEl);
    } else {
      const existing = wrap.querySelector('.floating-label-text');
      if (existing) {
        existing.textContent = label.text;
        existing.style.color = normalizeHexColor(label.color);
        existing.style.textAlign = getFloatingLabelAlign(label);
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
    if (editingFloatingLabelId) commitFloatingLabelEdit({ switchToPointer: false });

    const label = getFloatingLabelById(id);
    if (!label) return;
    if (SLASH_LABEL_TEXTS.has(label.text)) return;

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
    selectTool('pointer');
    input.focus();
    input.select();
  }

  function commitFloatingLabelEdit({ switchToPointer = true } = {}) {
    if (!editingFloatingLabelId) return;
    const id = editingFloatingLabelId;
    const wrap = stackEl.querySelector(`.floating-label-wrap[data-id="${id}"]`);
    const input = wrap?.querySelector('.floating-label-input');
    editingFloatingLabelId = null;

    if (!input) return;

    const text = input.value.trim();
    if (!text) {
      eraseFloatingLabel(id);
      if (switchToPointer) selectTool('pointer');
      return;
    }

    recordUndoBeforeChange();
    const label = getFloatingLabelById(id);
    if (!label) return;

    label.text = text;
    restoreFloatingLabelText(wrap, label);
    saveSession();
    clearFloatingLabelSelection();
    if (switchToPointer) selectTool('pointer');
  }

  function focusEditingFloatingLabelInput() {
    if (!editingFloatingLabelId) return;
    const wrap = stackEl.querySelector(`.floating-label-wrap[data-id="${editingFloatingLabelId}"]`);
    const input = wrap?.querySelector('.floating-label-input');
    if (!input) return;
    bindFloatingLabelInputEvents(input, editingFloatingLabelId);
    syncFloatingLabelInputWidth(input);
    selectTool('pointer');
    input.focus();
  }

  function createFloatingLabelWrap(label) {
    const isEditing = label.id === editingFloatingLabelId;
    const wrap = document.createElement('div');
    wrap.className = 'floating-label-wrap';
    const isSlashLabel = SLASH_LABEL_TEXTS.has(label.text);
    if (isSlashLabel) {
      wrap.classList.add('is-slash-label');
    } else {
      if (selectedFloatingLabelIds.has(label.id) || isEditing) {
        wrap.classList.add('is-selected');
      }
      if (isEditing) {
        wrap.classList.add('is-editing');
      }
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
      textEl.style.textAlign = getFloatingLabelAlign(label);
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
      el.classList.toggle('is-selected', selectedFloatingLabelIds.has(el.dataset.id));
    });
    syncLabelGroupAlignButtons();
  }

  function isFloatingLabelSelected(id) {
    return selectedFloatingLabelIds.has(id);
  }

  function selectFloatingLabel(id) {
    selectedFloatingLabelIds.clear();
    selectedFloatingLabelIds.add(id);
    primaryFloatingLabelId = id;
    syncFloatingLabelSelection();
  }

  function toggleFloatingLabelInSelection(id) {
    if (selectedFloatingLabelIds.has(id)) {
      selectedFloatingLabelIds.delete(id);
      if (primaryFloatingLabelId === id) {
        primaryFloatingLabelId = selectedFloatingLabelIds.size
          ? [...selectedFloatingLabelIds].at(-1)
          : null;
      }
    } else {
      selectedFloatingLabelIds.add(id);
      primaryFloatingLabelId = id;
    }
    syncFloatingLabelSelection();
  }

  function clearFloatingLabelSelection() {
    if (selectedFloatingLabelIds.size === 0) return;
    selectedFloatingLabelIds.clear();
    primaryFloatingLabelId = null;
    syncFloatingLabelSelection();
  }

  function ensureLabelMarqueeElement() {
    if (labelMarqueeEl) return labelMarqueeEl;
    labelMarqueeEl = document.createElement('div');
    labelMarqueeEl.className = 'label-marquee-select';
    labelMarqueeEl.hidden = true;
    labelMarqueeEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(labelMarqueeEl);
    return labelMarqueeEl;
  }

  function canStartLabelMarqueeFromTarget(e) {
    if (state.activeTool !== 'pointer' || isEraserPointer(e)) return false;
    if (e.target.closest('.floating-label-wrap')) return false;
    if (e.target.closest('.month-panel-remove-btn, .add-month-btn, .panel-controls-root')) {
      return false;
    }
    return Boolean(e.target.closest('#calendar-stack'));
  }

  function startLabelMarqueeDrag(e) {
    e.preventDefault();
    labelMarqueeDrag = {
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
      moved: false,
    };
    updateLabelMarqueeRect();
  }

  function updateLabelMarqueeRect() {
    if (!labelMarqueeDrag) return;

    const { startX, startY, currentX, currentY } = labelMarqueeDrag;
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    if (width + height >= 4) {
      labelMarqueeDrag.moved = true;
    }

    const el = ensureLabelMarqueeElement();
    el.hidden = false;
    el.style.display = 'block';
    el.style.left = `${Math.min(startX, currentX)}px`;
    el.style.top = `${Math.min(startY, currentY)}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;

    if (labelMarqueeDrag.moved) {
      selectFloatingLabelsInMarquee();
    }
  }

  function rectsIntersect(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function selectFloatingLabelsInMarquee() {
    if (!labelMarqueeEl || labelMarqueeEl.hidden) return;

    const marqueeRect = labelMarqueeEl.getBoundingClientRect();
    if (marqueeRect.width <= 0 && marqueeRect.height <= 0) return;

    const selected = [];
    stackEl.querySelectorAll('.floating-label-wrap:not(.is-slash-label)').forEach((wrap) => {
      if (rectsIntersect(marqueeRect, wrap.getBoundingClientRect())) {
        selected.push(wrap.dataset.id);
      }
    });

    selectedFloatingLabelIds.clear();
    selected.forEach((id) => selectedFloatingLabelIds.add(id));
    primaryFloatingLabelId = selected.length ? selected.at(-1) : null;
    syncFloatingLabelSelection();
  }

  function onLabelMarqueeMove(e) {
    if (!labelMarqueeDrag) return;
    labelMarqueeDrag.currentX = e.clientX;
    labelMarqueeDrag.currentY = e.clientY;
    updateLabelMarqueeRect();
  }

  function endLabelMarqueeDrag() {
    if (!labelMarqueeDrag) return;

    if (labelMarqueeDrag.moved) {
      selectFloatingLabelsInMarquee();
    }

    labelMarqueeDrag = null;
    if (labelMarqueeEl) {
      labelMarqueeEl.hidden = true;
      labelMarqueeEl.style.display = 'none';
    }
  }

  function focusFloatingLabelInSelection(id) {
    if (!selectedFloatingLabelIds.has(id)) return false;
    primaryFloatingLabelId = id;
    return true;
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
      if (e.target.closest('.swatch[data-color], .label-align-btn[data-label-align], .label-align-btn[data-label-group-align]')) {
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
    if (!primaryFloatingLabelId || isFloatingLabelEditing()) return false;
    const label = getFloatingLabelById(primaryFloatingLabelId);
    if (!label || !label.text.trim()) return false;

    copiedFloatingLabel = {
      text: label.text,
      color: label.color,
      size: getFloatingLabelSize(label),
      align: getFloatingLabelAlign(label),
      panel: label.panel,
      x: label.x,
      y: label.y,
    };
    pasteRepeatCount = 0;
    showCopyFeedback(primaryFloatingLabelId);
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
      align: copiedFloatingLabel.align,
    });
    pasteRepeatCount += 1;
    selectFloatingLabel(id);
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

  function pointToLabelCoords(clientX, clientY, monthGrid, { clamp = true } = {}) {
    const rect = monthGrid.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    if (!clamp) return { x, y };
    return { x: clamp01(x), y: clamp01(y) };
  }

  function labelCoordsToClientPoint(label) {
    const monthGrid = getMonthGridForPanelKey(label.panel);
    const rect = monthGrid?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: rect.left + clamp01(Number(label.x) || 0) * rect.width,
      y: rect.top + clamp01(Number(label.y) || 0) * rect.height,
      monthGrid,
      rect,
    };
  }

  function updateFloatingLabelWrapPosition(label) {
    const wrap = stackEl.querySelector(`.floating-label-wrap[data-id="${label.id}"]`);
    if (!wrap) return;
    wrap.style.left = `${label.x * 100}%`;
    wrap.style.top = `${label.y * 100}%`;
    ensureFloatingLabelInCorrectLayer(label);
  }

  function syncFloatingLabelWrapPositionsFromState() {
    state.floatingLabels.forEach((label) => {
      if (SLASH_LABEL_TEXTS.has(label.text)) return;
      const wrap = stackEl.querySelector(`.floating-label-wrap[data-id="${label.id}"]`);
      if (!wrap) {
        const layer = getLabelsLayerForPanelKey(label.panel);
        if (!layer) return;
        layer.appendChild(createFloatingLabelWrap(label));
      }
      updateFloatingLabelWrapPosition(label);
    });
  }

  function getPanelKeyFromMonthGrid(monthGrid) {
    const panel = monthGrid.closest('.month-panel');
    if (!panel) return null;
    return panelKey(Number(panel.dataset.year), Number(panel.dataset.month));
  }

  function getCalendarCenterSnapLines(monthGrid) {
    const rects = getLabelAreaRects(monthGrid);
    const panel = getPanelKeyFromMonthGrid(monthGrid);
    if (!rects || !panel || rects.areaRect.width <= 0 || rects.areaRect.height <= 0) return [];

    const gridCenterY =
      (rects.gridWrapRect.top + rects.gridWrapRect.height / 2 - rects.areaRect.top) /
      rects.areaRect.height;
    const yValue = clamp01(gridCenterY);

    return [
      {
        axis: 'x',
        value: 0.5,
        clientValue: rects.areaRect.left + rects.areaRect.width * 0.5,
        panel,
        source: 'calendar',
      },
      {
        axis: 'y',
        value: yValue,
        clientValue: rects.areaRect.top + rects.areaRect.height * yValue,
        panel,
        source: 'calendar',
      },
    ];
  }

  function getColorBoxSnapCandidates() {
    if (!stackEl) return [];
    const candidates = [];
    stackEl.querySelectorAll('.day-cell.has-color').forEach((cell) => {
      const monthGrid = cell.closest('.month-grid');
      const panel = monthGrid ? getPanelKeyFromMonthGrid(monthGrid) : null;
      const boxEl = cell.querySelector('.day-inner');
      const boxRect = boxEl?.getBoundingClientRect();
      const areaRect = monthGrid?.getBoundingClientRect();
      if (!panel || !boxRect || !areaRect || areaRect.width <= 0 || areaRect.height <= 0) return;

      const clientX = boxRect.left + boxRect.width / 2;
      const clientY = boxRect.top + boxRect.height / 2;
      candidates.push({
        axis: 'x',
        value: clamp01((clientX - areaRect.left) / areaRect.width),
        clientValue: clientX,
        panel,
        source: 'color',
      });
      candidates.push({
        axis: 'y',
        value: clamp01((clientY - areaRect.top) / areaRect.height),
        clientValue: clientY,
        panel,
        source: 'color',
      });
    });
    return candidates;
  }

  function getFloatingLabelSnapCandidates(activeLabel, monthGrid) {
    const panel = getPanelKeyFromMonthGrid(monthGrid);
    if (!panel) return [];
    const candidates = [...getCalendarCenterSnapLines(monthGrid), ...getColorBoxSnapCandidates()];

    state.floatingLabels.forEach((label) => {
      if (label.id === activeLabel.id || !label.text) return;
      const point = labelCoordsToClientPoint(label);
      if (!point) return;
      const candidatePanel = label.panel;
      candidates.push({
        axis: 'x',
        value: clamp01(Number(label.x) || 0),
        clientValue: point.x,
        panel: candidatePanel,
        source: 'label',
      });
      candidates.push({
        axis: 'y',
        value: clamp01(Number(label.y) || 0),
        clientValue: point.y,
        panel: candidatePanel,
        source: 'label',
      });
    });

    return candidates;
  }

  function getSnappedFloatingLabelCoords(label, coords, monthGrid, options = {}) {
    const rect = monthGrid.getBoundingClientRect();
    const axes = options.axes || ['x', 'y'];
    const clamp = options.clamp !== false;
    const snapped = { ...coords };
    const guides = [];
    const best = { x: null, y: null };

    getFloatingLabelSnapCandidates(label, monthGrid).forEach((candidate) => {
      if (!axes.includes(candidate.axis)) return;
      const currentClient =
        candidate.axis === 'x'
          ? rect.left + coords.x * rect.width
          : rect.top + coords.y * rect.height;
      const distancePx = Math.abs(currentClient - candidate.clientValue);
      if (distancePx > FLOATING_LABEL_SNAP_THRESHOLD_PX) return;
      const current = best[candidate.axis];
      if (!current || distancePx < current.distancePx) {
        best[candidate.axis] = { ...candidate, distancePx };
      }
    });

    ['x', 'y'].forEach((axis) => {
      const match = best[axis];
      if (!match) return;
      const raw =
        axis === 'x'
          ? (match.clientValue - rect.left) / rect.width
          : (match.clientValue - rect.top) / rect.height;
      snapped[axis] = clamp ? clamp01(raw) : raw;
      guides.push({ axis, value: clamp ? clamp01(match.value) : match.value, panel: match.panel });
    });

    return { coords: snapped, guides };
  }

  function getConstrainedFloatingLabelCoords(coords, drag, e, panelKeyStr) {
    if (!e.shiftKey || panelKeyStr !== drag.startPanel) {
      return { coords, axes: ['x', 'y'] };
    }

    const horizontal = Math.abs(e.clientX - drag.startX) >= Math.abs(e.clientY - drag.startY);
    if (horizontal) {
      return {
        coords: { ...coords, y: clamp01(Number(drag.startLabelY) || 0) },
        axes: ['x'],
      };
    }

    return {
      coords: { ...coords, x: clamp01(Number(drag.startLabelX) || 0) },
      axes: ['y'],
    };
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

  function clearFloatingLabelSnapGuides() {
    stackEl.querySelectorAll('.floating-label-snap-guide').forEach((el) => el.remove());
  }

  function renderFloatingLabelSnapGuides(guides) {
    clearFloatingLabelSnapGuides();
    guides.forEach((guide) => {
      const layer = getLabelsLayerForPanelKey(guide.panel);
      if (!layer) return;
      const el = document.createElement('div');
      el.className = `floating-label-snap-guide snap-guide-${guide.axis}`;
      if (guide.axis === 'x') {
        el.style.left = `${guide.value * 100}%`;
      } else {
        el.style.top = `${guide.value * 100}%`;
      }
      layer.appendChild(el);
    });
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

  function setFloatingLabelPositionFromPointWithSnap(label, e, drag) {
    const deltaY = e.clientY - drag.startY;
    const monthGrid = getGroupDragTargetGrid(
      e.clientX,
      e.clientY,
      drag.startPanel,
      deltaY
    );
    if (!monthGrid) {
      clearFloatingLabelSnapGuides();
      return false;
    }

    const coords = pointToLabelCoords(e.clientX, e.clientY, monthGrid, { clamp: false });
    if (!coords) {
      clearFloatingLabelSnapGuides();
      return false;
    }

    const key = getPanelKeyFromMonthGrid(monthGrid);
    if (!key) {
      clearFloatingLabelSnapGuides();
      return false;
    }

    const constrained = getConstrainedFloatingLabelCoords(coords, drag, e, key);
    const snapped = getSnappedFloatingLabelCoords(label, constrained.coords, monthGrid, {
      axes: constrained.axes,
      clamp: false,
    });
    label.panel = key;
    label.x = snapped.coords.x;
    label.y = snapped.coords.y;
    ensureFloatingLabelInCorrectLayer(label);
    renderFloatingLabelSnapGuides(snapped.guides);
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
    const align = getFloatingLabelAlign(label);
    const textEl = el.querySelector('.floating-label-text');
    const inputEl = el.querySelector('.floating-label-input');
    if (textEl) {
      textEl.style.fontSize = fontSize;
      textEl.style.color = color;
      textEl.style.textAlign = align;
    }
    if (inputEl) {
      inputEl.style.fontSize = fontSize;
      inputEl.style.color = color;
      inputEl.style.textAlign = align;
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

  function getConstrainedGroupPixelDelta(pixelDx, pixelDy, drag, e) {
    const monthGrid = getMonthGridAtPoint(e.clientX, e.clientY);
    const key = monthGrid ? getPanelKeyFromMonthGrid(monthGrid) : drag.startPanel;
    if (!e.shiftKey || key !== drag.startPanel) {
      return { pixelDx, pixelDy };
    }

    const horizontal = Math.abs(pixelDx) >= Math.abs(pixelDy);
    if (horizontal) {
      return { pixelDx, pixelDy: 0 };
    }

    return { pixelDx: 0, pixelDy };
  }

  function buildFloatingLabelDragGroupStarts(dragId) {
    const ids = selectedFloatingLabelIds.has(dragId)
      ? [...selectedFloatingLabelIds].filter((id) => {
          const label = getFloatingLabelById(id);
          return label && !SLASH_LABEL_TEXTS.has(label.text);
        })
      : [dragId];

    return ids
      .map((id) => {
        const label = getFloatingLabelById(id);
        if (!label) return null;
        const point = labelCoordsToClientPoint(label);
        return {
          id,
          x: label.x,
          y: label.y,
          panel: label.panel,
          clientX: point?.x ?? null,
          clientY: point?.y ?? null,
        };
      })
      .filter(Boolean);
  }

  function getMonthGridRectsForLabelX(clientX) {
    return [...stackEl.querySelectorAll('.month-grid')]
      .map((grid) => ({ grid, rect: grid.getBoundingClientRect() }))
      .filter(
        ({ rect }) =>
          clientX >= rect.left &&
          clientX <= rect.right &&
          rect.width > 0 &&
          rect.height > 0
      );
  }

  function getGroupDragTargetGrid(cursorX, cursorY, startPanelKey, deltaY = 0) {
    const column = getMonthGridRectsForLabelX(cursorX).sort((a, b) => a.rect.top - b.rect.top);
    if (column.length === 0) {
      return getMonthGridAtPoint(cursorX, cursorY) || getMonthGridForPanelKey(startPanelKey);
    }

    const direct = getMonthGridAtPoint(cursorX, cursorY);
    if (direct) {
      const index = column.findIndex(({ grid }) => grid === direct);
      if (index >= 0) {
        const { rect } = column[index];
        const edgeThreshold = Math.max(10, rect.height * 0.03);
        if (deltaY > 0 && index < column.length - 1) {
          if (rect.bottom - cursorY <= edgeThreshold) {
            return column[index + 1].grid;
          }
        }
        if (deltaY < 0 && index > 0) {
          if (cursorY - rect.top <= edgeThreshold) {
            return column[index - 1].grid;
          }
        }
      }
      return direct;
    }

    for (let i = 0; i < column.length - 1; i++) {
      const { rect: upperRect, grid: upperGrid } = column[i];
      const { rect: lowerRect, grid: lowerGrid } = column[i + 1];
      if (cursorY > upperRect.bottom && cursorY < lowerRect.top) {
        return deltaY >= 0 ? lowerGrid : upperGrid;
      }
    }

    if (cursorY < column[0].rect.top) return column[0].grid;
    return column[column.length - 1].grid;
  }

  function finalizeFloatingLabelPositionAfterDrag(label) {
    const monthGrid = getMonthGridForPanelKey(label.panel);
    const rect = monthGrid?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    const clientX = rect.left + label.x * rect.width;
    const clientY = rect.top + label.y * rect.height;
    const targetGrid =
      getMonthGridAtPoint(clientX, clientY) ||
      getGroupDragTargetGrid(clientX, clientY, label.panel, 0) ||
      monthGrid;
    const targetRect = targetGrid.getBoundingClientRect();
    const targetPanel = getPanelKeyFromMonthGrid(targetGrid);

    if (targetPanel) label.panel = targetPanel;
    label.x = clamp01((clientX - targetRect.left) / targetRect.width);
    label.y = clamp01((clientY - targetRect.top) / targetRect.height);
    ensureFloatingLabelInCorrectLayer(label);
    updateFloatingLabelElement(label);
  }

  function constrainGroupPixelDelta(groupStarts, pixelDx, pixelDy) {
    let minDx = -Infinity;
    let maxDx = Infinity;
    let minDy = -Infinity;
    let maxDy = Infinity;

    for (const start of groupStarts) {
      if (start.clientX == null || start.clientY == null) continue;

      let gridRects = getMonthGridRectsForLabelX(start.clientX);
      if (gridRects.length === 0) {
        const monthGrid =
          getMonthGridAtPoint(start.clientX, start.clientY) ||
          getMonthGridForPanelKey(start.panel);
        const rect = monthGrid?.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
          gridRects = [{ grid: monthGrid, rect }];
        }
      }

      if (gridRects.length === 0) continue;

      let labelMinDx = Infinity;
      let labelMaxDx = -Infinity;
      let labelMinDy = Infinity;
      let labelMaxDy = -Infinity;

      gridRects.forEach(({ rect }) => {
        labelMinDx = Math.min(labelMinDx, rect.left - start.clientX);
        labelMaxDx = Math.max(labelMaxDx, rect.right - start.clientX);
        labelMinDy = Math.min(labelMinDy, rect.top - start.clientY);
        labelMaxDy = Math.max(labelMaxDy, rect.bottom - start.clientY);
      });

      minDx = Math.max(minDx, labelMinDx);
      maxDx = Math.min(maxDx, labelMaxDx);
      minDy = Math.max(minDy, labelMinDy);
      maxDy = Math.min(maxDy, labelMaxDy);
    }

    if (!Number.isFinite(minDy) || !Number.isFinite(minDx) || minDy > maxDy || minDx > maxDx) {
      return { pixelDx: 0, pixelDy: 0 };
    }

    return {
      pixelDx: Math.max(minDx, Math.min(maxDx, pixelDx)),
      pixelDy: Math.max(minDy, Math.min(maxDy, pixelDy)),
    };
  }

  function moveFloatingLabelGroupFromPixelDelta(drag, pixelDx, pixelDy, cursorX, cursorY) {
    if (!drag.groupStarts?.length) return;

    const constrained = constrainGroupPixelDelta(drag.groupStarts, pixelDx, pixelDy);
    pixelDx = constrained.pixelDx;
    pixelDy = constrained.pixelDy;

    const targetGrid = getGroupDragTargetGrid(
      cursorX,
      cursorY,
      drag.startPanel,
      pixelDy
    );
    const rect = targetGrid?.getBoundingClientRect();
    const targetPanel = targetGrid ? getPanelKeyFromMonthGrid(targetGrid) : null;
    if (!targetGrid || !targetPanel || !rect || rect.width <= 0 || rect.height <= 0) return;

    drag.groupStarts.forEach((start) => {
      const label = getFloatingLabelById(start.id);
      if (!label || SLASH_LABEL_TEXTS.has(label.text)) return;
      if (start.clientX == null || start.clientY == null) return;

      const cx = start.clientX + pixelDx;
      const cy = start.clientY + pixelDy;

      label.panel = targetPanel;
      label.x = (cx - rect.left) / rect.width;
      label.y = (cy - rect.top) / rect.height;
      ensureFloatingLabelInCorrectLayer(label);
      updateFloatingLabelElement(label);
    });
  }

  function moveSelectedFloatingLabelByArrow(e) {
    const arrowKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
    if (!arrowKeys.has(e.key)) return false;
    if (shouldIgnoreUndoShortcut(e)) return false;
    if (isFloatingLabelEditing()) return false;
    if (selectedFloatingLabelIds.size === 0) return false;

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

    const labels = [...selectedFloatingLabelIds]
      .map((id) => getFloatingLabelById(id))
      .filter((label) => label && !SLASH_LABEL_TEXTS.has(label.text));
    if (labels.length === 0) return false;

    recordUndoBeforeChange();
    let moved = false;
    labels.forEach((label) => {
      if (nudgeFloatingLabel(label, dx, dy)) {
        captureFloatingLabelAnchor(label);
        moved = true;
      }
    });
    if (!moved) return false;
    saveSession();
    e.preventDefault();
    return true;
  }

  function deleteSelectedFloatingLabelByKey(e) {
    if (e.key !== 'Delete') return false;
    if (shouldIgnoreUndoShortcut(e)) return false;
    if (isFloatingLabelEditing()) return false;
    if (saveDialog?.open || unsavedDialog?.open || deleteDialog?.open || updateNewsDialog?.open) {
      return false;
    }
    if (selectedFloatingLabelIds.size === 0) return false;

    const ids = [...selectedFloatingLabelIds].filter((id) => {
      const label = getFloatingLabelById(id);
      return label && !SLASH_LABEL_TEXTS.has(label.text);
    });
    if (ids.length === 0) return false;

    recordUndoBeforeChange();
    ids.forEach((id) => {
      selectedFloatingLabelIds.delete(id);
      if (primaryFloatingLabelId === id) {
        primaryFloatingLabelId = null;
      }
      if (editingFloatingLabelId === id) {
        editingFloatingLabelId = null;
      }
    });
    const idSet = new Set(ids);
    state.floatingLabels = state.floatingLabels.filter((l) => !idSet.has(l.id));
    if (selectedFloatingLabelIds.size && !primaryFloatingLabelId) {
      primaryFloatingLabelId = [...selectedFloatingLabelIds].at(-1);
    }
    saveSession();
    render();
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
    const label = {
      id,
      panel: panelKey(year, month),
      x: coords.x,
      y: coords.y,
      text: '',
      color: state.labelStyle.color,
      size: state.labelStyle.size,
      align: state.labelStyle.align,
    };
    const cell = e.target.closest('.day-cell');
    if (cell?.dataset.date) {
      anchorFloatingLabelToDate(label, cell.dataset.date, year, month);
    } else {
      captureFreeFloatingPanelAnchor(label);
    }
    state.floatingLabels.push(label);
    selectFloatingLabel(id);
    editingFloatingLabelId = id;
    saveSession();
    render();
  }

  function eraseFloatingLabel(id) {
    recordUndoBeforeChange();
    selectedFloatingLabelIds.delete(id);
    if (primaryFloatingLabelId === id) {
      primaryFloatingLabelId = selectedFloatingLabelIds.size
        ? [...selectedFloatingLabelIds].at(-1)
        : null;
    }
    if (editingFloatingLabelId === id) {
      editingFloatingLabelId = null;
    }
    state.floatingLabels = state.floatingLabels.filter((l) => l.id !== id);
    saveSession();
    render();
  }

  function startFloatingLabelDrag(e, wrapEl) {
    if (isFloatingLabelEditing()) return;
    e.preventDefault();
    e.stopPropagation();
    let id = wrapEl.dataset.id;
    let label = getFloatingLabelById(id);
    if (!label) return;
    let undoRecorded = false;

    if (SLASH_LABEL_TEXTS.has(label.text)) {
      const sourceKey = getDateKeyForSlashLabel(label);
      if (sourceKey) {
        clearFloatingLabelSelection();
        startMarkMoveDrag(sourceKey, e);
      }
      return;
    }

    if (e.altKey) {
      recordUndoBeforeChange();
      undoRecorded = true;
      id = uuid();
      label = {
        id,
        panel: label.panel,
        x: label.x,
        y: label.y,
        text: label.text,
        color: label.color,
        size: getFloatingLabelSize(label),
        align: getFloatingLabelAlign(label),
        anchorDate: label.anchorDate,
        anchorOffsetX: label.anchorOffsetX,
        anchorOffsetPxY: label.anchorOffsetPxY,
        anchorWeekCount: label.anchorWeekCount,
        anchorOffsetY: label.anchorOffsetY,
      };
      state.floatingLabels.push(label);
      selectFloatingLabel(id);
      render();
    }

    floatingLabelDrag = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      startLabelX: label.x,
      startLabelY: label.y,
      startPanel: label.panel,
      undoRecorded,
      copyMode: undoRecorded,
      sourceId: wrapEl.dataset.id,
      moved: false,
      onText: Boolean(e.target.closest('.floating-label-text')),
      eraserIntent: isEraserPointer(e) || state.activeTool === 'eraser',
      groupStarts: buildFloatingLabelDragGroupStarts(id),
    };
  }

  function startFloatingLabelResize(e, wrapEl) {
    e.preventDefault();
    e.stopPropagation();
    const id = wrapEl.dataset.id;
    const label = getFloatingLabelById(id);
    if (!label || SLASH_LABEL_TEXTS.has(label.text)) return;

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
    if (!label || SLASH_LABEL_TEXTS.has(label.text)) return;

    const pixelDx = e.clientX - floatingLabelDrag.startX;
    const pixelDy = e.clientY - floatingLabelDrag.startY;
    if (!floatingLabelDrag.moved) {
      if (Math.abs(pixelDx) + Math.abs(pixelDy) < 4) return;
      floatingLabelDrag.moved = true;
      if (!floatingLabelDrag.undoRecorded) {
        recordUndoBeforeChange();
        floatingLabelDrag.undoRecorded = true;
      }
    }

    if (floatingLabelDrag.groupStarts?.length > 1) {
      const { pixelDx: cdx, pixelDy: cdy } = getConstrainedGroupPixelDelta(
        pixelDx,
        pixelDy,
        floatingLabelDrag,
        e
      );
      moveFloatingLabelGroupFromPixelDelta(
        floatingLabelDrag,
        cdx,
        cdy,
        e.clientX,
        e.clientY
      );
      clearFloatingLabelSnapGuides();
      return;
    }

    const moved = setFloatingLabelPositionFromPointWithSnap(label, e, floatingLabelDrag);

    if (moved) {
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
    onLabelMarqueeMove(e);
    onFloatingLabelMove(e);
    onFloatingLabelResizeMove(e);
  }

  function endFloatingLabelDrag(e) {
    if (!floatingLabelDrag) return;
    const drag = floatingLabelDrag;
    floatingLabelDrag = null;
    clearFloatingLabelSnapGuides();

    if (drag.copyMode && !drag.moved) {
      state.floatingLabels = state.floatingLabels.filter((label) => label.id !== drag.id);
      selectFloatingLabel(drag.sourceId);
      if (drag.undoRecorded) undoStack.pop();
      render();
      return;
    }

    if (drag.moved) {
      const movedIds = drag.groupStarts?.length
        ? drag.groupStarts.map((start) => start.id)
        : [drag.id];
      movedIds.forEach((id) => {
        const label = getFloatingLabelById(id);
        if (!label) return;
        finalizeFloatingLabelPositionAfterDrag(label);
        captureFloatingLabelAnchor(label);
      });
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
  }

  function endFloatingLabelResize() {
    if (!floatingLabelResize) return;
    floatingLabelResize = null;
    saveSession();
  }

  function removeVisibleMonthPanel(panelIndex) {
    if (state.visibleMonthCount <= 1) return;
    recordUndoBeforeChange();

    if (panelIndex === 0) {
      const next = addMonths(state.viewYear, state.viewMonth, 1);
      state.viewYear = next.year;
      state.viewMonth = next.month;
      state.visibleMonthCount--;
      activePanelKey = panelKey(state.viewYear, state.viewMonth);
    } else {
      state.visibleMonthCount--;
    }

    clearFloatingLabelSelection();
    render();
    saveSession();
  }

  function createMonthPanelRemoveButton(panelIndex, { isFirstPanel = false } = {}) {
    const label = isFirstPanel ? '이 달 제거' : '마지막 달 제거';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'month-panel-remove-btn';
    btn.textContent = '×';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeVisibleMonthPanel(panelIndex);
    });
    return btn;
  }

  function renderMonthPanel(year, month, hasNextPanel, { showRemoveBtn = false, panelIndex = 0 } = {}) {
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
    if (showRemoveBtn) {
      panel.classList.add('month-panel--has-remove');
      panel.appendChild(
        createMonthPanelRemoveButton(panelIndex, { isFirstPanel: panelIndex === 0 })
      );
    }
    return panel;
  }

  function renderPanelControls() {
    const controls = document.createElement('div');
    controls.className = 'panel-controls';

    const plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.className = 'add-month-btn';
    plusBtn.title = '다음 달 추가';
    plusBtn.setAttribute('aria-label', '다음 달 추가');
    plusBtn.textContent = '+ 다음달 추가';
    plusBtn.addEventListener('click', () => {
      recordUndoBeforeChange();
      state.visibleMonthCount++;
      render();
      saveSession();
    });

    controls.appendChild(plusBtn);

    return controls;
  }

  function getElementCenterX(el) {
    const rect = el.getBoundingClientRect();
    return rect.left + rect.width / 2;
  }

  function syncDocumentTitleInput() {
    if (!inputDocumentTitle) return;
    if (inputDocumentTitle.value !== state.documentTitle) {
      inputDocumentTitle.value = state.documentTitle;
    }
  }

  function updatePageTitle() {
    document.title = state.documentTitle.trim() || '스케줄표 만들기 도구';
  }

  function syncDocumentTitleFromActiveSave() {
    if (!activeSaveId) return;
    const entry = savesMeta.saves.find((s) => s.id === activeSaveId);
    if (entry?.name) {
      state.documentTitle = entry.name;
    }
  }

  function commitDocumentTitleFromInput() {
    if (!inputDocumentTitle) return;
    state.documentTitle = inputDocumentTitle.value.trim();
    updatePageTitle();
    saveSession();
    scheduleAlignScheduleGroup();
  }

  function alignScheduleGroup() {
    const scheduleGroup = document.querySelector('.schedule-group');
    const titleEl = inputDocumentTitle;
    if (!scheduleGroup || !titleEl) return;

    if (window.innerWidth <= SCHEDULE_ALIGN_MOBILE_MAX) {
      scheduleGroup.style.setProperty('--schedule-align-offset', '0px');
      return;
    }

    scheduleGroup.style.setProperty('--schedule-align-offset', '0px');
    void scheduleGroup.offsetWidth;

    const titleCenterX = getElementCenterX(titleEl);
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
    clearFloatingLabelSnapGuides();
    sanitizeViewState();
    syncAllSlashLabels();
    stackEl.innerHTML = '';

    for (let i = 0; i < state.visibleMonthCount; i++) {
      const { year, month } = addMonths(state.viewYear, state.viewMonth, i);
      const hasNextPanel = i < state.visibleMonthCount - 1;
      const showRemoveBtn =
        state.visibleMonthCount > 1 &&
        (i === 0 || i === state.visibleMonthCount - 1);
      stackEl.appendChild(
        renderMonthPanel(year, month, hasNextPanel, { showRemoveBtn, panelIndex: i })
      );
    }

    const labelsLayoutChanged = layoutManualFloatingLabelsFromAnchors();
    syncFloatingLabelWrapPositionsFromState();

    if (labelsLayoutChanged && !isApplyingHistory) {
      saveSession();
    }

    if (panelControlsRootEl) {
      panelControlsRootEl.innerHTML = '';
      panelControlsRootEl.appendChild(renderPanelControls());
    }

    inputYear.value = state.viewYear;
    selectMonth.value = String(state.viewMonth);
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
    const id = primaryFloatingLabelId || editingFloatingLabelId;
    if (id) {
      const label = getFloatingLabelById(id);
      if (label && !SLASH_LABEL_TEXTS.has(label.text)) {
        return normalizeHexColor(label.color);
      }
    }
    return normalizeHexColor(getActiveLabelColor());
  }

  function getDisplayedLabelAlign() {
    const id = primaryFloatingLabelId || editingFloatingLabelId;
    if (id) {
      const label = getFloatingLabelById(id);
      if (label && !SLASH_LABEL_TEXTS.has(label.text)) {
        return getFloatingLabelAlign(label);
      }
    }
    return normalizeLabelAlign(state.labelStyle.align);
  }

  function applyLabelColor(color) {
    const normalized = normalizeHexColor(
      clampLabelStyle({ ...state.labelStyle, color }).color
    );
    state.labelStyle.color = normalized;

    let labels = getSelectedEditableFloatingLabels();
    if (labels.length === 0) {
      const targetId = primaryFloatingLabelId || editingFloatingLabelId;
      if (targetId) {
        const label = getFloatingLabelById(targetId);
        if (label && !SLASH_LABEL_TEXTS.has(label.text)) {
          labels = [label];
        }
      }
    }

    let changed = false;
    labels.forEach((label) => {
      const currentColor = normalizeHexColor(label.color);
      if (currentColor === normalized) return;
      if (!changed) recordUndoBeforeChange();
      changed = true;
      label.color = normalized;
      updateFloatingLabelElement(label);
    });

    if (changed) saveSession();
    updateToolbar();
  }

  function applyLabelAlign(align) {
    const normalized = normalizeLabelAlign(align);
    state.labelStyle.align = normalized;

    let labels = getSelectedEditableFloatingLabels();
    if (labels.length === 0) {
      const targetId = primaryFloatingLabelId || editingFloatingLabelId;
      if (targetId) {
        const label = getFloatingLabelById(targetId);
        if (label && !SLASH_LABEL_TEXTS.has(label.text)) {
          labels = [label];
        }
      }
    }

    let changed = false;
    labels.forEach((label) => {
      if (getFloatingLabelAlign(label) === normalized) return;
      if (!changed) recordUndoBeforeChange();
      changed = true;
      label.align = normalized;
      updateFloatingLabelElement(label);
    });

    saveSession();
    updateToolbar();
  }

  function getSelectedEditableFloatingLabels() {
    return [...selectedFloatingLabelIds]
      .map((id) => getFloatingLabelById(id))
      .filter((label) => label && !SLASH_LABEL_TEXTS.has(label.text));
  }

  function setFloatingLabelClientPoint(label, clientX, clientY) {
    const monthGrid =
      getMonthGridAtPoint(clientX, clientY) || getMonthGridForPanelKey(label.panel);
    const rect = monthGrid?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;

    const panelKeyStr = getPanelKeyFromMonthGrid(monthGrid);
    if (panelKeyStr) {
      label.panel = panelKeyStr;
    }

    label.x = clamp01((clientX - rect.left) / rect.width);
    label.y = clamp01((clientY - rect.top) / rect.height);
    ensureFloatingLabelInCorrectLayer(label);
    updateFloatingLabelElement(label);
    return true;
  }

  function alignSelectedFloatingLabelsVerticalCenter() {
    const labels = getSelectedEditableFloatingLabels();
    if (labels.length < 2) return false;

    const entries = labels
      .map((label) => ({ label, point: labelCoordsToClientPoint(label) }))
      .filter((entry) => entry.point);
    if (entries.length < 2) return false;

    const ys = entries.map((entry) => entry.point.y);
    const targetY = (Math.min(...ys) + Math.max(...ys)) / 2;

    recordUndoBeforeChange();
    entries.forEach(({ label, point }) => {
      setFloatingLabelClientPoint(label, point.x, targetY);
      captureFloatingLabelAnchor(label);
    });
    saveSession();
    return true;
  }

  function alignSelectedFloatingLabelsHorizontalCenter() {
    const labels = getSelectedEditableFloatingLabels();
    if (labels.length < 2) return false;

    const entries = labels
      .map((label) => ({ label, point: labelCoordsToClientPoint(label) }))
      .filter((entry) => entry.point);
    if (entries.length < 2) return false;

    const xs = entries.map((entry) => entry.point.x);
    const targetX = (Math.min(...xs) + Math.max(...xs)) / 2;

    recordUndoBeforeChange();
    entries.forEach(({ label, point }) => {
      setFloatingLabelClientPoint(label, targetX, point.y);
      captureFloatingLabelAnchor(label);
    });
    saveSession();
    return true;
  }

  function syncLabelGroupAlignButtons() {
    const enabled = getSelectedEditableFloatingLabels().length >= 2;
    document.querySelectorAll('.label-align-btn[data-label-group-align]').forEach((btn) => {
      btn.disabled = !enabled;
    });
  }

  function applyLabelGroupAlign(mode) {
    if (mode === 'vertical-center') {
      return alignSelectedFloatingLabelsVerticalCenter();
    }
    if (mode === 'horizontal-center') {
      return alignSelectedFloatingLabelsHorizontalCenter();
    }
    return false;
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
      align: state.labelStyle.align,
    });
    selectFloatingLabel(id);
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
      hideColorBoxPreview();
      applyLabelColor(btn.dataset.color);
      selectTool('pointer');
    });
  }

  function bindLabelAlignButtons() {
    const root = document.getElementById('label-align-options');
    if (!root) return;

    if (root.dataset.bound === '1') return;
    root.dataset.bound = '1';
    root.addEventListener('mousedown', (e) => {
      const groupBtn = e.target.closest('.label-align-btn[data-label-group-align]');
      if (groupBtn) {
        if (groupBtn.disabled) return;
        e.preventDefault();
        e.stopPropagation();
        applyLabelGroupAlign(groupBtn.dataset.labelGroupAlign);
        updateToolbar();
        return;
      }

      const btn = e.target.closest('.label-align-btn[data-label-align]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      applyLabelAlign(btn.dataset.labelAlign);
    });
    root.addEventListener('click', (e) => {
      if (
        e.target.closest('.label-align-btn[data-label-align], .label-align-btn[data-label-group-align]')
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
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
    if (tool === 'label' && btn.dataset.labelAlign) {
      return btn.dataset.labelAlign === getDisplayedLabelAlign();
    }
    if (tool === 'label' && btn.dataset.labelGroupAlign) {
      return false;
    }
    if (tool === 'label' && btn.dataset.labelTemplate) {
      return false;
    }
    return state.activeTool === tool;
  }

  function updateToolbar() {
    document.querySelectorAll('.tool-icon-btn, .swatch[data-tool], .label-template-btn, .label-align-btn').forEach((btn) => {
      btn.classList.toggle('active', isToolControlActive(btn));
    });

    syncLabelGroupAlignButtons();

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
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        if (inputHistorySearch) {
          e.preventDefault();
          inputHistorySearch.focus();
          inputHistorySearch.select();
        }
        return;
      }

      if (moveSelectedFloatingLabelByArrow(e)) return;
      if (deleteSelectedFloatingLabelByKey(e)) return;

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

    inputDocumentTitle?.addEventListener('input', commitDocumentTitleFromInput);
    inputDocumentTitle?.addEventListener('change', commitDocumentTitleFromInput);
    inputDocumentTitle?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        inputDocumentTitle.blur();
      }
    });

    bindLabelColorSwatches();
    bindLabelAlignButtons();
    bindLabelTemplates();

    document.querySelectorAll('[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.tool === 'label' && btn.dataset.color) return;
        if (btn.dataset.tool === 'label' && btn.dataset.labelTemplate) return;
        if (btn.dataset.tool === 'label' && btn.dataset.labelAlign) return;
        if (btn.dataset.tool === 'label' && btn.dataset.labelGroupAlign) return;
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

      const baseName = downloadJpgBlob(blob, name);
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

        if (wrapEl.classList.contains('is-editing')) {
          if (!e.target.closest('.floating-label-input')) {
            wrapEl.querySelector('.floating-label-input')?.focus();
          }
          return;
        }

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

        if (e.altKey) {
          selectFloatingLabel(id);
          startFloatingLabelDrag(e, wrapEl);
          return;
        }

        const label = getFloatingLabelById(id);
        if (label && SLASH_LABEL_TEXTS.has(label.text)) {
          e.preventDefault();
          e.stopPropagation();
          const sourceKey = getDateKeyForSlashLabel(label);
          if (!sourceKey) return;

          if (state.activeTool === 'eraser' || isEraserPointer(e)) {
            recordUndoBeforeChange();
            eraseSelection([sourceKey]);
            saveSession();
            render();
            return;
          }

          startMarkMoveDrag(sourceKey, e);
          return;
        }

        if (state.activeTool === 'eraser' || isEraserPointer(e)) {
          eraseFloatingLabel(id);
          return;
        }

        if (e.shiftKey) {
          toggleFloatingLabelInSelection(id);
          if (selectedFloatingLabelIds.has(id)) {
            startFloatingLabelDrag(e, wrapEl);
          }
          return;
        }

        if (selectedFloatingLabelIds.has(id)) {
          focusFloatingLabelInSelection(id);
          startFloatingLabelDrag(e, wrapEl);
          return;
        }

        selectFloatingLabel(id);
        startFloatingLabelDrag(e, wrapEl);
        return;
      }

      if (e.altKey) {
        const cell = e.target.closest('.day-cell');
        if (cell) {
          e.preventDefault();
          startMarkMoveDrag(cell.dataset.date, e);
        }
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

      if (canStartLabelMarqueeFromTarget(e)) {
        startLabelMarqueeDrag(e);
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
      endLabelMarqueeDrag();
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
    syncDocumentTitleFromActiveSave();
    syncDocumentTitleInput();
    updatePageTitle();
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
