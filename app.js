const state = {
  records: [],
  currentTab: 'entry',
  workspaceSettings: { hideEntryTab: false, hideOldEntryTab: false, hideDatabaseTab: false },
  checkingAll: false,
  stopBatchRequested: false,
  batchRunPromise: null,
  statusCheckPromise: null,
  activeStatusCheckId: '',
  stopStatusCheckRequested: false,
  refreshingRecords: false,
  savedRecord: null,
  recordsLoaded: false,
  editingRecordId: null,
  batchResults: [],
  activeBatchResponseKey: '',
  registrationAnalyticsPeriod: '',
  selectedStatusFilter: 'NOT DONE',
  visibleRecordColumns: ['name', 'dob', 'nin', 'mobile', 'status', 'number', 'registered', 'registered-days', 'updated', 'updated-days', 'notes', 'actions'],
};

const $ = (id) => document.getElementById(id);
const RECORDS_CACHE_KEY = 'voterlist-records-cache-v1';
const RECORD_COLUMNS_KEY = 'voterlist-visible-record-columns-v1';
const WORKSPACE_SETTINGS_KEY = 'voterlist-workspace-settings-v1';
const ALL_BATCH_GROUP_KEY = 'all-records';
const RECORD_COLUMNS = [
  { id: 'name', label: 'Name' },
  { id: 'dob', label: 'Date of birth' },
  { id: 'nin', label: 'NIN' },
  { id: 'mobile', label: 'Mobile' },
  { id: 'status', label: 'Status' },
  { id: 'number', label: 'Voter-list / Abedan number' },
  { id: 'registered', label: 'Registered' },
  { id: 'registered-days', label: 'Registered days' },
  { id: 'updated', label: 'Updated' },
  { id: 'updated-days', label: 'Updated days' },
  { id: 'notes', label: 'Notes' },
  { id: 'actions', label: 'Actions' },
];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function formatNin(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 10);
  return digits.match(/.{1,3}/g)?.join('-') || '';
}

function formatNinInput(input) {
  const caret = input.selectionStart;
  const digitsBeforeCaret = caret === null ? 0 : input.value.slice(0, caret).replace(/\D/g, '').length;
  input.value = formatNin(input.value);
  if (caret !== null) {
    const position = digitsBeforeCaret + Math.floor(digitsBeforeCaret / 3);
    input.setSelectionRange(position, position);
  }
}

async function handlePasswordChange(event) {
  event.preventDefault();
  const button = $('savePasswordButton');
  const message = $('passwordMessage');
  message.textContent = '';
  button.disabled = true;
  try {
    await apiRequest('/api/auth', {
      method: 'PUT',
      body: JSON.stringify({
        currentPassword: $('currentPassword').value,
        newPassword: $('newPassword').value,
        confirmPassword: $('confirmPassword').value,
      }),
    });
    $('passwordForm').reset();
    $('passwordDialog').close();
    showToast('Admin password updated in the database.');
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function isValidWorkspaceSettings(settings) {
  return settings
    && typeof settings.hideEntryTab === 'boolean'
    && typeof settings.hideOldEntryTab === 'boolean'
    && typeof settings.hideDatabaseTab === 'boolean'
    && !(settings.hideEntryTab && settings.hideOldEntryTab && settings.hideDatabaseTab);
}

function normalizeWorkspaceSettings(settings) {
  if (!settings || typeof settings !== 'object') return null;
  const normalized = {
    hideEntryTab: settings.hideEntryTab,
    hideOldEntryTab: settings.hideOldEntryTab ?? false,
    hideDatabaseTab: settings.hideDatabaseTab,
  };
  return isValidWorkspaceSettings(normalized) ? normalized : null;
}

function applyWorkspaceSettings() {
  $('hideEntryTab').checked = state.workspaceSettings.hideEntryTab;
  $('hideOldEntryTab').checked = state.workspaceSettings.hideOldEntryTab;
  $('hideDatabaseTab').checked = state.workspaceSettings.hideDatabaseTab;
  document.querySelector('.tab[data-tab="entry"]').hidden = state.workspaceSettings.hideEntryTab;
  document.querySelector('.tab[data-tab="old-entry"]').hidden = state.workspaceSettings.hideOldEntryTab;
  document.querySelector('.tab[data-tab="records"]').hidden = state.workspaceSettings.hideDatabaseTab;
  setTab(state.currentTab);
}

function loadCachedWorkspaceSettings() {
  try {
    const cached = localStorage.getItem(WORKSPACE_SETTINGS_KEY);
    if (!cached) return;
    const settings = normalizeWorkspaceSettings(JSON.parse(cached));
    if (!settings) {
      localStorage.removeItem(WORKSPACE_SETTINGS_KEY);
      return;
    }
    state.workspaceSettings = settings;
    applyWorkspaceSettings();
  } catch (error) {
    console.error('Could not read saved workspace settings:', error);
    showToast('Saved workspace settings could not be read; using the default tabs.', true);
  }
}

async function syncWorkspaceSettings() {
  try {
    const { settings: savedSettings } = await apiRequest('/api/workspace-settings', { cache: 'no-store' });
    const settings = normalizeWorkspaceSettings(savedSettings);
    if (!settings) {
      throw new Error('The saved workspace tab settings are invalid.');
    }
    state.workspaceSettings = settings;
    applyWorkspaceSettings();
    try {
      localStorage.setItem(WORKSPACE_SETTINGS_KEY, JSON.stringify(settings));
    } catch (error) {
      console.error('Could not cache workspace settings locally:', error);
      showToast('Workspace settings synced from the database, but could not be cached in this browser.', true);
    }
    return true;
  } catch (error) {
    applyWorkspaceSettings();
    showToast(`Could not sync workspace settings from the database: ${error.message}`, true);
    return false;
  }
}

async function saveWorkspaceSettings(event) {
  event.preventDefault();
  const button = $('saveWorkspaceSettingsButton');
  const message = $('workspaceSettingsMessage');
  const settings = {
    hideEntryTab: $('hideEntryTab').checked,
    hideOldEntryTab: $('hideOldEntryTab').checked,
    hideDatabaseTab: $('hideDatabaseTab').checked,
  };
  message.textContent = '';
  if (settings.hideEntryTab && settings.hideOldEntryTab && settings.hideDatabaseTab) {
    message.textContent = 'At least one workspace tab must remain visible.';
    return;
  }

  button.disabled = true;
  try {
    const result = await apiRequest('/api/workspace-settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
    const savedSettings = normalizeWorkspaceSettings(result.settings);
    if (!savedSettings) {
      throw new Error('The server returned invalid workspace settings.');
    }
    state.workspaceSettings = savedSettings;
    applyWorkspaceSettings();
    let cacheWarning = '';
    try {
      localStorage.setItem(WORKSPACE_SETTINGS_KEY, JSON.stringify(savedSettings));
    } catch (error) {
      console.error('Could not cache updated workspace settings:', error);
      cacheWarning = ' Database settings were saved, but this browser could not cache them.';
    }
    message.textContent = '';
    showToast(`Workspace tab settings saved.${cacheWarning}`, Boolean(cacheWarning));
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function verifyWorkspaceAdminPassword(event) {
  event.preventDefault();
  const button = $('confirmWorkspacePasswordButton');
  const message = $('workspacePasswordMessage');
  message.textContent = '';
  button.disabled = true;
  try {
    await apiRequest('/api/workspace-settings', {
      method: 'POST',
      body: JSON.stringify({ password: $('workspaceAdminPassword').value }),
    });
    $('workspacePasswordDialog').close();
    $('hideEntryTab').checked = state.workspaceSettings.hideEntryTab;
    $('hideOldEntryTab').checked = state.workspaceSettings.hideOldEntryTab;
    $('hideDatabaseTab').checked = state.workspaceSettings.hideDatabaseTab;
    $('workspaceSettingsDialog').showModal();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function softRefresh() {
  if (state.refreshingRecords) return;
  state.refreshingRecords = true;
  try {
    if (state.checkingAll) {
      state.stopBatchRequested = true;
      $('checkAllButton').disabled = true;
      showToast('Stopping status checks before syncing records…');
      await state.batchRunPromise;
    }
    if (state.statusCheckPromise) {
      state.stopStatusCheckRequested = true;
      showToast('Stopping the individual status check before syncing records…');
      await state.statusCheckPromise;
    }
    resetRecordForm();
    $('recordsSearch').value = '';
    $('datePeriodFilter').value = 'ALL';
    $('registrationSort').value = 'NEWEST';
    state.selectedStatusFilter = 'NOT DONE';
    $('checkAllDialog').close();
    $('settingsDialog').close();
    $('passwordDialog').close();
    $('workspacePasswordDialog').close();
    $('workspaceSettingsDialog').close();
    $('savedRecordDialog').close();
    $('recordDetailsDialog').close();
    $('statusCheckResponseDialog').close();
    const loaded = await loadRecords({ force: true });
    if (loaded) {
      showToast('Records synced. Forms, searches, and filters have been cleared.');
    }
  } finally {
    state.stopBatchRequested = false;
    state.stopStatusCheckRequested = false;
    state.refreshingRecords = false;
  }
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function formatBsDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const NepaliDateClass = getNepaliDateClass();
  if (!NepaliDateClass) {
    console.error('The Nepali date converter is unavailable for record dates.');
    return '—';
  }
  try {
    return new NepaliDateClass(date).format('YYYY-MM-DD');
  } catch (error) {
    console.error('Could not convert a saved record date to BS:', error);
    return '—';
  }
}

function daysSince(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const startOfDate = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const today = new Date();
  const startOfToday = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.max(0, Math.floor((startOfToday - startOfDate) / 86_400_000));
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

function recordNumber(record) {
  if (record.voterListNumber || record.abedanNumber) {
    return {
      label: record.voterListNumber ? 'Voter-list number' : 'Abedan number',
      value: record.voterListNumber || record.abedanNumber,
    };
  }
  const message = String(record.lastCheckMessage || '')
    .replace(/[०-९]/g, (digit) => String('०१२३४५६७८९'.indexOf(digit)));
  const voterMatch = /मतदाता\s*(?:परिचयपत्र\s*)?(?:नं|नम्बर|नंबर)\s*[:：-]?\s*([0-9]{4,})/u.exec(message);
  if (voterMatch) return { label: 'Voter-list number', value: voterMatch[1] };
  const abedanMatch = /(?:(?:आवेदन|आवेदन-पत्र|निवेदन|अबेदन|अवेदन)\s*(?:संख्या\s*)?(?:नं|नम्बर|नंबर)|(?:abedan|application|request)\s*(?:number|no\.?))\s*[:：-]?\s*((?=[A-Za-z0-9/-]*\d)[A-Za-z0-9/-]{3,})/iu.exec(message);
  return abedanMatch
    ? { label: 'Abedan number', value: abedanMatch[1] }
    : { label: 'Voter-list / Abedan number', value: '—' };
}

function recordStatus(record) {
  const storedStatus = String(record.status || '').toUpperCase();
  if (['DONE', 'PENDING', 'NOT ONLINE'].includes(storedStatus)) return storedStatus;

  const message = String(record.lastCheckMessage || '').toLocaleLowerCase();
  if (record.voterListNumber || record.abedanNumber || recordNumber(record).value !== '—') return 'DONE';
  if (/no record found|please verify nin|verify nin, dob|nin.{0,20}(?:not active|inactive)|निवेदन भेटिएन|रेकर्ड भेटिएन/u.test(message)) {
    return 'NOT ONLINE';
  }
  if (/search succeeded but no voter-list|marked pending|pending/u.test(message)) return 'PENDING';
  return 'NOT ONLINE';
}

function statusPill(status) {
  const normalized = String(status || '').toUpperCase();
  const statusStyle = normalized === 'DONE'
    ? { className: 'status-done', symbol: '✓', label: 'Done' }
    : normalized === 'PENDING'
      ? { className: 'status-pending', symbol: '◷', label: 'Pending' }
      : { className: 'status-not-online', symbol: '⊘', label: 'Not online' };
  return `<span class="status-pill ${statusStyle.className}"><span class="status-symbol" aria-hidden="true">${statusStyle.symbol}</span>${escapeHtml(normalized || 'NOT ONLINE')}<span class="sr-only">${statusStyle.label}</span></span>`;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status}).`);
    error.status = response.status;
    error.response = data;
    throw error;
  }
  return data;
}

function showToast(message, isError = false) {
  const toast = $('appMessage');
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.remove('hidden');
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.add('hidden'), 6000);
}

function setScreen(screen) {
  for (const id of ['loginScreen', 'appScreen', 'verifyScreen']) {
    $(id).classList.toggle('hidden', id !== screen);
  }
}

function cacheRecords() {
  try {
    localStorage.setItem(RECORDS_CACHE_KEY, JSON.stringify(state.records));
    return true;
  } catch (error) {
    console.error('Could not cache voterlist records locally:', error);
    return false;
  }
}

function cacheRecordsOrNotify() {
  if (!cacheRecords()) {
    showToast('Records updated on the server but could not be saved in this browser cache.', true);
  }
}

function loadRecordColumnPreferences() {
  try {
    const saved = localStorage.getItem(RECORD_COLUMNS_KEY);
    if (!saved) return;
    const columns = JSON.parse(saved);
    if (!Array.isArray(columns) || !columns.length
      || columns.some((column) => !RECORD_COLUMNS.some((item) => item.id === column))) {
      localStorage.removeItem(RECORD_COLUMNS_KEY);
      return;
    }
    state.visibleRecordColumns = columns;
  } catch (error) {
    console.error('Could not read saved table column preferences:', error);
    showToast('Saved table column settings could not be read; using all columns.', true);
  }
}

function applyRecordColumnVisibility() {
  document.querySelectorAll('[data-record-column]').forEach((cell) => {
    cell.hidden = !state.visibleRecordColumns.includes(cell.dataset.recordColumn);
  });
}

function openColumnSettings() {
  $('recordColumnsOptions').innerHTML = RECORD_COLUMNS.map((column) => `
    <label class="column-option">
      <input type="checkbox" name="record-column" value="${column.id}" ${state.visibleRecordColumns.includes(column.id) ? 'checked' : ''} />
      <span>${escapeHtml(column.label)}</span>
    </label>
  `).join('');
  $('recordColumnsDialog').showModal();
}

function saveColumnSettings() {
  const selected = [...$('recordColumnsOptions').querySelectorAll('input[name="record-column"]:checked')]
    .map((input) => input.value);
  if (!selected.length) {
    showToast('Select at least one column to display.', true);
    return;
  }
  try {
    localStorage.setItem(RECORD_COLUMNS_KEY, JSON.stringify(selected));
  } catch (error) {
    console.error('Could not save table column preferences:', error);
    showToast('Column settings could not be saved in this browser.', true);
    return;
  }
  state.visibleRecordColumns = selected;
  applyRecordColumnVisibility();
  $('recordColumnsDialog').close();
}

function loadCachedRecords() {
  try {
    const cached = localStorage.getItem(RECORDS_CACHE_KEY);
    if (!cached) return false;
    const records = JSON.parse(cached);
    if (!Array.isArray(records)) {
      localStorage.removeItem(RECORDS_CACHE_KEY);
      return false;
    }
    state.records = normalizeLegacyRegisteredDates(records);
    state.recordsLoaded = true;
    cacheRecords();
    renderRecords();
    return true;
  } catch (error) {
    console.error('Could not read cached voterlist records:', error);
    showToast('Saved local records could not be read. Refresh to load the database records.', true);
    return false;
  }
}

function mergeUniqueSearchResponses(...responseLists) {
  const responses = new Map();
  for (const response of responseLists.flat()) {
    if (!response?.fullResponse) continue;
    const message = batchResponseMessage(response.fullResponse) || 'No response message returned.';
    if (!responses.has(message)) responses.set(message, response);
  }
  return [...responses.values()].sort((left, right) => (
    new Date(left.changedAt || 0).getTime() - new Date(right.changedAt || 0).getTime()
  ));
}

function cacheableSearchResponses(responses) {
  return mergeUniqueSearchResponses(responses).map((response) => ({
    changedAt: response.changedAt,
    responseHash: response.responseHash,
    fullResponse: {
      body: { message: batchResponseMessage(response.fullResponse) || 'No response message returned.' },
    },
  }));
}

function getNepaliDateClass() {
  if (window.NepaliDate?.default && typeof window.NepaliDate.default === 'function') {
    return window.NepaliDate.default;
  }
  if (typeof window.NepaliDate === 'function') return window.NepaliDate;
  return null;
}

function validIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function convertDateValue(value, source) {
  const NepaliDateClass = getNepaliDateClass();
  if (!NepaliDateClass) throw new Error('The date converter did not load. Check your connection and try again.');

  if (source === 'ad') {
    if (!validIsoDate(value)) return '';
    const [year, month, day] = value.split('-').map(Number);
    return new NepaliDateClass(new Date(year, month - 1, day)).format('YYYY-MM-DD');
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const nepaliDate = new NepaliDateClass(value);
  if (nepaliDate.format('YYYY-MM-DD') !== value) return '';
  const adDate = nepaliDate.getAD();
  return `${adDate.year}-${String(adDate.month + 1).padStart(2, '0')}-${String(adDate.date).padStart(2, '0')}`;
}

function normalizeLegacyRegisteredDates(records) {
  const currentYear = new Date().getFullYear();
  return records.map((record) => {
    const createdAt = new Date(record.createdAt);
    const bsYear = createdAt.getUTCFullYear();
    if (Number.isNaN(createdAt.getTime()) || bsYear <= currentYear + 1 || bsYear > 2090 || bsYear < 2000) {
      return record;
    }

    const bsDate = [
      bsYear,
      String(createdAt.getUTCMonth() + 1).padStart(2, '0'),
      String(createdAt.getUTCDate()).padStart(2, '0'),
    ].join('-');
    try {
      const adDate = convertDateValue(bsDate, 'bs');
      if (!adDate) return record;
      const [year, month, day] = adDate.split('-').map(Number);
      const correctedDate = new Date(Date.UTC(year, month - 1, day, 12));
      console.warn(`Recovered a legacy BS registration date for record ${record._id}.`);
      return { ...record, createdAt: correctedDate.toISOString() };
    } catch (error) {
      console.error(`Could not recover the legacy registration date for record ${record._id}:`, error);
      return record;
    }
  });
}

function isValidBsDate(value) {
  try {
    return Boolean(convertDateValue(value, 'bs'));
  } catch {
    return false;
  }
}

function syncDatePair(source, reportError = false, form = $('recordForm')) {
  const sourceInput = source === 'ad' ? form.elements.dobAd : form.elements.dobBs;
  const targetInput = source === 'ad' ? form.elements.dobBs : form.elements.dobAd;
  const value = sourceInput.value.trim();
  targetInput.value = '';
  if (!value) return;

  try {
    const converted = convertDateValue(value, source);
    if (converted) targetInput.value = converted;
    else if (reportError) showToast(`Enter a valid ${source.toUpperCase()} date as YYYY-MM-DD.`, true);
  } catch (error) {
    if (reportError) showToast(error.message, true);
  }
}

function formatIsoDateInput(input) {
  const digitsBeforeCursor = input.value.slice(0, input.selectionStart ?? input.value.length).replace(/\D/g, '').length;
  const digits = input.value.replace(/\D/g, '').slice(0, 8);
  const formatted = digits.length > 6
    ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`
    : digits.length > 4
      ? `${digits.slice(0, 4)}-${digits.slice(4)}`
      : digits;
  input.value = formatted;

  let cursor = 0;
  let digitsSeen = 0;
  while (cursor < formatted.length && digitsSeen < digitsBeforeCursor) {
    if (/\d/.test(formatted[cursor])) digitsSeen += 1;
    cursor += 1;
  }
  if (digitsBeforeCursor > 4 && cursor === 5) cursor += 1;
  if (digitsBeforeCursor > 6 && cursor === 8) cursor += 1;
  input.setSelectionRange(cursor, cursor);
}

function setTab(tabName) {
  const requestedButton = document.querySelector(`.tab[data-tab="${tabName}"]`);
  if (!requestedButton || requestedButton.hidden) {
    tabName = ['entry', 'old-entry', 'records']
      .find((name) => !document.querySelector(`.tab[data-tab="${name}"]`).hidden) || 'entry';
  }
  state.currentTab = tabName;
  document.querySelector('.content').classList.toggle('records-view', tabName === 'records');
  document.querySelectorAll('.tab').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('hidden', panel.id !== `tab-${tabName}`);
  });
}

function matchesRecordSearch(record, search) {
  if (!search) return true;
  const query = search.trim().toLocaleLowerCase();
  return [
    record.fullName,
    record.nin,
    record.mobile,
    record.voterListNumber,
    record.abedanNumber,
  ].some((value) => String(value || '').toLocaleLowerCase().includes(query));
}

function periodStartDate(period) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (period === 'TODAY') return today;
  if (period === 'YESTERDAY') {
    today.setDate(today.getDate() - 1);
    return today;
  }
  if (period === 'THIS_WEEK') {
    const daysSinceMonday = (today.getDay() + 6) % 7;
    today.setDate(today.getDate() - daysSinceMonday);
    return today;
  }
  if (period === 'THIS_MONTH') {
    today.setDate(1);
    return today;
  }
  if (period === 'THIS_YEAR') {
    today.setMonth(0, 1);
    return today;
  }
  return null;
}

function matchesDatePeriod(record, period) {
  if (period === 'ALL') return true;
  if (!record.createdAt) return false;
  const createdAt = new Date(record.createdAt);
  if (Number.isNaN(createdAt.getTime())) return false;
  const start = periodStartDate(period);
  if (!start) return true;
  const end = new Date(start);
  if (period === 'THIS_WEEK') end.setDate(end.getDate() + 7);
  else if (period === 'THIS_MONTH') end.setMonth(end.getMonth() + 1);
  else if (period === 'THIS_YEAR') end.setFullYear(end.getFullYear() + 1);
  else end.setDate(end.getDate() + 1);
  return createdAt >= start && createdAt < end;
}

function registrationDateParts(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    year: date.getFullYear(),
    month: date.getMonth(),
    day: date.getDate(),
  };
}

function countRegistrationsForDate(records, year, month, day) {
  return records.filter((record) => {
    const parts = registrationDateParts(record.createdAt);
    return parts && parts.year === year && parts.month === month && parts.day === day;
  }).length;
}

function countRegistrationsForMonth(records, year, month) {
  return records.filter((record) => {
    const parts = registrationDateParts(record.createdAt);
    return parts && parts.year === year && parts.month === month;
  }).length;
}

function countRegistrationsForYear(records, year) {
  return records.filter((record) => registrationDateParts(record.createdAt)?.year === year).length;
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function registrationAnalyticsPeriods(now) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6 + index);
    return {
      key: `day:${localDateKey(date)}`,
      type: 'day',
      year: date.getFullYear(),
      month: date.getMonth(),
      day: date.getDate(),
      label: date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
    };
  });
  const months = Array.from({ length: 4 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 3 + index, 1);
    return {
      key: `month:${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      type: 'month',
      year: date.getFullYear(),
      month: date.getMonth(),
      label: date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    };
  });
  const years = [now.getFullYear() - 1, now.getFullYear()].map((year) => ({
    key: `year:${year}`,
    type: 'year',
    year,
    label: String(year),
  }));
  return [
    { key: 'days', title: 'Last 7 days, including today', periods: days },
    { key: 'months', title: 'Current and previous 3 months', periods: months },
    { key: 'years', title: 'Current and previous year', periods: years },
  ];
}

function renderRegistrationAnalytics() {
  const now = new Date();
  const periodGroups = registrationAnalyticsPeriods(now);
  const allPeriods = periodGroups.flatMap((group) => group.periods);
  if (!allPeriods.some((period) => period.key === state.registrationAnalyticsPeriod)) {
    state.registrationAnalyticsPeriod = `day:${localDateKey(now)}`;
  }
  const selectedPeriod = allPeriods.find((period) => period.key === state.registrationAnalyticsPeriod);
  $('registrationAnalyticsContent').innerHTML = `
    <div class="registration-analytics-periods">
      ${periodGroups.map((group) => `
        <section class="registration-analytics-section">
          <h3>${escapeHtml(group.title)}</h3>
          <div class="registration-analytics-list">
            ${group.periods.map((period) => {
              const count = period.type === 'day'
                ? countRegistrationsForDate(state.records, period.year, period.month, period.day)
                : period.type === 'month'
                  ? countRegistrationsForMonth(state.records, period.year, period.month)
                  : countRegistrationsForYear(state.records, period.year);
              return `<button class="registration-analytics-row${period.key === selectedPeriod.key ? ' active' : ''}" type="button" data-registration-period="${escapeHtml(period.key)}" aria-pressed="${period.key === selectedPeriod.key}">
                <span>${escapeHtml(period.label)}</span><span>${count}</span>
              </button>`;
            }).join('')}
          </div>
        </section>
      `).join('')}
    </div>
  `;
  $('registrationAnalyticsContent').querySelectorAll('[data-registration-period]').forEach((button) => {
    button.addEventListener('click', () => {
      state.registrationAnalyticsPeriod = button.dataset.registrationPeriod;
      renderRegistrationAnalytics();
    });
  });
}

function visibleRecords() {
  const search = $('recordsSearch').value;
  const datePeriod = $('datePeriodFilter').value;
  const records = state.records.filter((record) => {
    const status = recordStatus(record);
    const matchesStatus = Boolean(search.trim())
      || state.selectedStatusFilter === 'ALL'
      || (state.selectedStatusFilter === 'NOT DONE' && status !== 'DONE')
      || status === state.selectedStatusFilter;
    return matchesStatus
      && matchesRecordSearch(record, search)
      && matchesDatePeriod(record, datePeriod);
  });
  const direction = $('registrationSort')?.value === 'OLDEST' ? 1 : -1;
  return records.sort((left, right) => {
    const leftDate = new Date(left.createdAt || 0).getTime();
    const rightDate = new Date(right.createdAt || 0).getTime();
    const leftValid = Number.isFinite(leftDate) && leftDate > 0;
    const rightValid = Number.isFinite(rightDate) && rightDate > 0;
    if (!leftValid || !rightValid) return Number(rightValid) - Number(leftValid);
    return (leftDate - rightDate) * direction;
  });
}

function visiblePendingRecords() {
  return state.records.filter((record) => recordStatus(record) !== 'DONE');
}

function renderRecordDetails(record) {
  const number = recordNumber(record);
  const registered = `${formatBsDate(record.createdAt)} BS · ${daysSince(record.createdAt)}`;
  const updated = `${formatBsDate(record.updatedAt)} BS · ${daysSince(record.updatedAt)}`;
  $('recordDetailsTitle').textContent = record.fullName || 'Record details';
  $('recordDetailsContent').innerHTML = `
    <div class="record-modal-grid">
      <div><span>Full name</span><strong>${escapeHtml(record.fullName)}</strong></div>
      <div><span>NIN</span><strong>${escapeHtml(record.nin)}</strong></div>
      <div><span>Mobile number</span><strong>${escapeHtml(record.mobile)}</strong></div>
      <div><span>Status</span><strong>${statusPill(recordStatus(record))}</strong></div>
      <div><span>Date of birth (AD)</span><strong>${escapeHtml(record.dobAd)}</strong></div>
      <div><span>Date of birth (BS)</span><strong>${escapeHtml(record.dobBs)}</strong></div>
      <div><span>${escapeHtml(number.label)}</span><strong>${escapeHtml(number.value)}</strong></div>
      <div><span>Registered</span><strong>${escapeHtml(registered)}</strong></div>
      <div><span>Last updated</span><strong>${escapeHtml(updated)}</strong></div>
      <div class="record-modal-wide"><span>Notes</span><strong>${escapeHtml(record.notes || '—')}</strong></div>
    </div>`;
  $('recordDetailsDialog').dataset.recordId = record._id;
  $('recordUpdatesDialog').dataset.recordId = record._id;
}

function renderLatestCheckResponse(response, label = 'Voterlist status check response') {
  const message = batchResponseMessage(response) || 'No response message returned.';
  $('latestCheckResponseContent').innerHTML = `
    <p class="latest-check-response-label">${escapeHtml(label)}</p>
    <p class="latest-check-response-message">${escapeHtml(message)}</p>`;
}

function openStatusCheckResponseDialog(record) {
  const dialog = $('statusCheckResponseDialog');
  dialog.dataset.recordId = record._id;
  dialog.dataset.checking = 'true';
  $('statusCheckResponseTitle').textContent = record.fullName || 'Check response';
  $('statusCheckRecordSummary').textContent = `NIN: ${record.nin} · Date of birth: ${record.dobAd}`;
  $('retryStatusCheckButton').hidden = true;
  $('retryStatusCheckButton').disabled = false;
  renderLatestCheckResponse({ message: 'Checking status…' }, 'Status check in progress');
  if (!dialog.open) dialog.showModal();
}

function openRecordDetails(record) {
  renderRecordDetails(record);
  $('recordResponsesContent').innerHTML = record.uniqueSearchResponses?.length
    ? renderUniqueResponses(record.uniqueSearchResponses)
    : '<p class="muted small-text">Loading responses…</p>';
  $('recordDetailsDialog').showModal();
  void loadRecordResponses(record._id);
}

function renderUniqueResponses(history = []) {
  const responses = new Map();
  const orderedHistory = [...history].sort((left, right) => (
    new Date(left.changedAt || 0).getTime() - new Date(right.changedAt || 0).getTime()
  ));
  for (const entry of orderedHistory) {
    const fullResponse = entry.fullResponse;
    if (entry.action && entry.action !== 'STATUS_CHECK') continue;
    if (fullResponse === null || fullResponse === undefined) continue;
    const message = batchResponseMessage(fullResponse) || 'No response message returned.';
    if (!responses.has(message)) {
      responses.set(message, {
        changedAt: entry.changedAt,
        fullResponse,
      });
    }
  }
  if (!responses.size) {
    return '<p class="muted small-text">No search response messages have been recorded for this record yet.</p>';
  }
  return [...responses.entries()].map(([message, entry], index) => `
    <div class="response-item">
      <span class="response-index">Response ${index + 1}${entry.changedAt ? ` · ${escapeHtml(formatDate(entry.changedAt))}` : ''}</span>
      <p class="response-message">${escapeHtml(message)}</p>
    </div>
  `).join('');
}

async function loadRecordResponses(recordId) {
  try {
    const { responses } = await apiRequest(`/api/record-history?recordId=${encodeURIComponent(recordId)}`, { cache: 'no-store' });
    if ($('recordDetailsDialog').dataset.recordId !== recordId) return;
    const uniqueSearchResponses = mergeUniqueSearchResponses(responses);
    $('recordResponsesContent').innerHTML = renderUniqueResponses(uniqueSearchResponses);
    state.records = state.records.map((record) => record._id === recordId
      ? { ...record, uniqueSearchResponses: cacheableSearchResponses(uniqueSearchResponses) }
      : record);
    cacheRecordsOrNotify();
  } catch (error) {
    if ($('recordDetailsDialog').dataset.recordId !== recordId) return;
    const errorContent = `<p class="message">${escapeHtml(error.message)}</p>`;
    $('recordResponsesContent').innerHTML = errorContent;
  }
}

function updateFieldLabel(field) {
  return ({
    nin: 'NIN',
    dobAd: 'Date of birth (AD)',
    dobBs: 'Date of birth (BS)',
    fullName: 'Full name',
    mobile: 'Mobile number',
    notes: 'Notes',
    status: 'Status',
    voterListNumber: 'Voter-list number',
    abedanNumber: 'Abedan number',
  })[field] || field;
}

function renderRecordUpdates(updates) {
  if (!updates.length) {
    return '<p class="muted small-text">No update history has been recorded for this record yet.</p>';
  }
  return updates.map((update, index) => `
    <article class="update-history-item">
      <header><strong>Update ${updates.length - index}</strong><time>${escapeHtml(formatDate(update.changedAt))}</time></header>
      <div class="update-history-changes">
        ${(update.changes || []).map((change) => `
          <div class="update-history-change">
            <strong>${escapeHtml(updateFieldLabel(change.field))}</strong>
            <span>${escapeHtml(change.before ?? '—')}</span>
            <span aria-hidden="true">→</span>
            <span>${escapeHtml(change.after ?? '—')}</span>
          </div>
        `).join('')}
      </div>
    </article>
  `).join('');
}

async function openRecordUpdatesHistory() {
  const recordId = $('recordDetailsDialog').dataset.recordId;
  if (!recordId) return;
  $('recordUpdatesContent').innerHTML = '<p class="muted small-text">Loading update history…</p>';
  $('recordUpdatesDialog').showModal();
  try {
    const { updates } = await apiRequest(`/api/record-history?recordId=${encodeURIComponent(recordId)}`, { cache: 'no-store' });
    if ($('recordUpdatesDialog').dataset.recordId !== recordId) return;
    $('recordUpdatesContent').innerHTML = renderRecordUpdates(updates);
  } catch (error) {
    if ($('recordUpdatesDialog').dataset.recordId !== recordId) return;
    $('recordUpdatesContent').innerHTML = `<p class="message">${escapeHtml(error.message)}</p>`;
  }
}

function resetRecordForm() {
  state.editingRecordId = null;
  $('recordForm').reset();
  $('oldRecordForm').reset();
  $('status').value = 'NOT ONLINE';
  $('oldStatus').value = 'NOT ONLINE';
  $('status').querySelector('option[value="DONE"]').hidden = true;
  $('recordForm').closest('.simple-form-panel').classList.remove('edit-mode');
  $('simpleFormTitle').textContent = 'New voter record';
  $('saveRecordButton').textContent = 'Save voter record';
  $('cancelEditButton').classList.add('hidden');
  $('updateConfirmation').classList.add('hidden');
  $('updateConfirmText').value = '';
  $('saveRecordButton').disabled = false;
}

function beginRecordEdit(record) {
  state.editingRecordId = record._id;
  const statusSelect = $('recordForm').elements.status;
  statusSelect.querySelector('option[value="DONE"]').hidden = false;
  $('recordForm').elements.nin.value = formatNin(record.nin);
  $('recordForm').elements.fullName.value = record.fullName || '';
  $('recordForm').elements.dobAd.value = record.dobAd || '';
  $('recordForm').elements.dobBs.value = record.dobBs || '';
  $('recordForm').elements.mobile.value = String(record.mobile || '').replace(/\D/g, '').slice(0, 10);
  statusSelect.value = recordStatus(record);
  $('recordForm').elements.notes.value = record.notes || '';
  $('simpleFormTitle').textContent = 'Update voter record';
  $('saveRecordButton').textContent = 'Update voter record';
  $('cancelEditButton').classList.remove('hidden');
  $('updateConfirmation').classList.remove('hidden');
  $('recordForm').closest('.simple-form-panel').classList.add('edit-mode');
  $('saveRecordButton').disabled = true;
  $('updateConfirmText').value = '';
  $('recordDetailsDialog').close();
  setTab('entry');
  $('nin').focus();
}

function renderRecords() {
  const recordsBody = $('recordsBody');
  const pending = state.records.filter((record) => recordStatus(record) !== 'DONE');
  const filteredRecords = visibleRecords();
  const today = new Date();
  const registeredTodayCount = countRegistrationsForDate(
    state.records,
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  $('pendingCount').textContent = String(pending.length);
  $('statusCounts').innerHTML = [
    { status: 'ALL', label: 'All records', symbol: '▤', count: state.records.length },
    { status: 'NOT ONLINE', label: 'Not online', symbol: '⊘', count: state.records.filter((record) => recordStatus(record) === 'NOT ONLINE').length },
    { status: 'PENDING', label: 'Pending', symbol: '◷', count: state.records.filter((record) => recordStatus(record) === 'PENDING').length },
    { status: 'DONE', label: 'Done', symbol: '✓', count: state.records.filter((record) => recordStatus(record) === 'DONE').length },
    { status: 'NOT DONE', label: 'All not done', symbol: '↻', count: pending.length },
  ].map((item) => `
    <button class="status-count-card status-card-${item.status.toLowerCase().replace(/\s+/g, '-')}${state.selectedStatusFilter === item.status ? ' active' : ''}" type="button" data-status-filter="${escapeHtml(item.status)}" aria-pressed="${state.selectedStatusFilter === item.status}">
      <span class="status-count-icon" aria-hidden="true">${item.symbol}</span>
      <span class="status-count-label">${escapeHtml(item.label)}</span>
      <strong>${item.count}</strong>
    </button>
  `).join('') + `
    <button class="status-count-card status-card-registered-today" type="button" data-registration-analytics aria-haspopup="dialog" aria-label="Show registration analytics; ${registeredTodayCount} registered today">
      <span class="status-count-icon" aria-hidden="true">＋</span>
      <span class="status-count-label">Registered today</span>
      <strong>${registeredTodayCount}</strong>
    </button>`;
  recordsBody.innerHTML = filteredRecords.length
    ? filteredRecords.map((record) => `
      <tr class="record-row status-row-${recordStatus(record).toLowerCase().replace(/\s+/g, '-')}" data-record-row="${escapeHtml(record._id)}" tabindex="0" aria-label="View ${escapeHtml(record.fullName)} details">
        <td data-record-column="name"><strong>${escapeHtml(record.fullName)}</strong></td>
        <td data-record-column="dob">${escapeHtml(record.dobAd)}</td>
        <td data-record-column="nin">${escapeHtml(record.nin)}</td>
        <td data-record-column="mobile" data-copy-mobile="${escapeHtml(record.mobile)}"><button class="mobile-copy-button" type="button" aria-label="Copy mobile number ${escapeHtml(record.mobile)}" title="Copy mobile number">${escapeHtml(record.mobile)}</button></td>
        <td data-record-column="status">${statusPill(recordStatus(record))}</td>
        <td data-record-column="number">${escapeHtml(recordNumber(record).value)}</td>
        <td data-record-column="registered">${escapeHtml(formatBsDate(record.createdAt))}</td>
        <td data-record-column="registered-days">${escapeHtml(daysSince(record.createdAt))}</td>
        <td data-record-column="updated">${escapeHtml(formatBsDate(record.updatedAt))}</td>
        <td data-record-column="updated-days">${escapeHtml(daysSince(record.updatedAt))}</td>
        <td data-record-column="notes">${escapeHtml(record.notes || '—')}</td>
        <td class="row-actions" data-record-column="actions">
          <button class="button primary tiny check-record-action" type="button" data-check="${escapeHtml(record._id)}" aria-label="Check status for ${escapeHtml(record.fullName)}" title="Check status"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4.9 9a7 7 0 0 1 12-2L20 12M4 17v-5h5m10.1 3a7 7 0 0 1-12 2L4 12"/></svg><span>Check</span></button>
          <button class="button subtle tiny print-record-action" type="button" data-print="${escapeHtml(record._id)}" aria-label="Print A4 sheet for ${escapeHtml(record.fullName)}" title="Print A4"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v7H7z"/><path d="M17 11h.01"/></svg><span>Print</span></button>
        </td>
      </tr>
    `).join('')
    : `<tr><td class="empty-row" colspan="${state.visibleRecordColumns.length}">${state.records.length ? 'No records match the current filters.' : 'No voterlist records saved yet.'}</td></tr>`;

  applyRecordColumnVisibility();
  $('statusCounts').querySelectorAll('[data-status-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedStatusFilter = button.dataset.statusFilter;
      renderRecords();
    });
  });
  $('statusCounts').querySelector('[data-registration-analytics]')?.addEventListener('click', () => {
    state.registrationAnalyticsPeriod = `day:${localDateKey(new Date())}`;
    renderRegistrationAnalytics();
    $('registrationAnalyticsDialog').showModal();
  });
  recordsBody.querySelectorAll('[data-record-row]').forEach((row) => {
    const showDetails = () => {
      const record = state.records.find((item) => item._id === row.dataset.recordRow);
      if (record) openRecordDetails(record);
    };
    row.addEventListener('click', (event) => {
      if (event.target.closest('button, [data-record-column="mobile"], [data-record-column="actions"]')) return;
      showDetails();
    });
    row.addEventListener('keydown', (event) => {
      if (event.target !== row) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        showDetails();
      }
    });
  });
  recordsBody.querySelectorAll('[data-copy-mobile]').forEach((cell) => {
    cell.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(cell.dataset.copyMobile);
        showToast('Mobile number copied.');
      } catch {
        showToast('Could not copy the mobile number. Check browser clipboard permissions.', true);
      }
    });
  });
  recordsBody.querySelectorAll('[data-print]').forEach((button) => {
    button.addEventListener('click', () => {
      const record = state.records.find((item) => item._id === button.dataset.print);
      if (record) printRecord(record);
    });
  });
  recordsBody.querySelectorAll('[data-check]').forEach((button) => {
    button.addEventListener('click', () => {
      const record = state.records.find((item) => item._id === button.dataset.check);
      if (record) checkRecordStatus(record, button);
    });
  });
}

async function loadRecords({ force = false } = {}) {
  if (!force && state.recordsLoaded) return true;
  try {
    const { records } = await apiRequest('/api/records', { cache: 'no-store' });
    const cachedResponses = new Map(state.records.map((record) => [record._id, record.uniqueSearchResponses || []]));
    state.records = normalizeLegacyRegisteredDates((Array.isArray(records) ? records : []).map((record) => ({
      ...record,
      uniqueSearchResponses: cachedResponses.get(record._id) || [],
    })));
    state.recordsLoaded = true;
    const cached = cacheRecords();
    renderRecords();
    if (!cached) showToast('Records synced, but could not be saved in this browser cache.', true);
    return true;
  } catch (error) {
    if (error.message.includes('Sign in')) {
      setScreen('loginScreen');
      return false;
    }
    showToast(error.message, true);
    return false;
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const message = $('loginMessage');
  const button = $('loginForm').querySelector('button[type="submit"]');
  message.textContent = '';
  button.disabled = true;
  try {
    await apiRequest('/api/auth', {
      method: 'POST',
      body: JSON.stringify({ password: $('loginPassword').value }),
    });
    $('loginPassword').value = '';
    setScreen('appScreen');
    await syncWorkspaceSettings();
    if (!loadCachedRecords()) await loadRecords({ force: true });
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function handleCreateRecord(event, entryType = 'standard') {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const isEditing = Boolean(state.editingRecordId);
  if (entryType === 'old' && isEditing) {
    showToast('Finish or cancel the current record edit before adding an old entry.', true);
    return;
  }
  if (isEditing && $('updateConfirmText').value !== 'UPDATE') {
    showToast('Type UPDATE exactly before saving changes.', true);
    return;
  }
  const formData = new FormData(form);
  if (!validIsoDate(form.elements.dobAd.value) || !isValidBsDate(form.elements.dobBs.value)) {
    showToast('Enter a valid AD or BS date as YYYY-MM-DD. The other date is converted automatically.', true);
    return;
  }
  if (entryType === 'old' && !isValidBsDate(form.elements.registeredDate.value)) {
    showToast('Enter a valid registered date in BS as YYYY-MM-DD.', true);
    return;
  }
  const enteredNin = form.elements.nin.value.replace(/\D/g, '');
  const duplicateNin = state.records.find((record) => (
    record._id !== state.editingRecordId
      && String(record.nin || '').replace(/\D/g, '') === enteredNin
  ));
  if (duplicateNin) {
    showToast('This NID / NIN number is already registered.', true);
    return;
  }
  button.disabled = true;

  try {
    const payload = {
      ...Object.fromEntries(formData.entries()),
      nin: enteredNin,
      status: form.elements.status.value,
      ...(entryType === 'old'
        ? {
          entryType: 'old',
          registeredDate: convertDateValue(form.elements.registeredDate.value, 'bs'),
        }
        : {}),
    };
    const result = await apiRequest('/api/records', {
      method: isEditing ? 'PUT' : 'POST',
      body: JSON.stringify(isEditing
        ? { ...payload, recordId: state.editingRecordId, confirmText: $('updateConfirmText').value }
        : payload),
    });
    if (isEditing && result.unchanged) {
      resetRecordForm();
      setTab('records');
      showToast('No changes were made to this record.');
      return;
    }
    if (isEditing) {
      state.records = state.records.map((record) => record._id === result.record._id
        ? { ...result.record, uniqueSearchResponses: record.uniqueSearchResponses || [] }
        : record);
      resetRecordForm();
    } else {
      form.reset();
      form.elements.status.value = 'NOT ONLINE';
      state.savedRecord = result.record;
      state.records = [result.record, ...state.records.filter((record) => record._id !== result.record._id)];
    }
    state.recordsLoaded = true;
    cacheRecordsOrNotify();
    renderRecords();
    if (isEditing) {
      showToast('Voter record updated.');
      setTab('records');
      openRecordDetails(result.record);
    } else {
      $('savedRecordTitle').textContent = `${result.record.fullName} saved`;
      $('savedRecordDialog').showModal();
    }
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = entryType === 'standard' && state.editingRecordId
      ? $('updateConfirmText').value !== 'UPDATE'
      : false;
  }
}

async function checkStatus(details) {
  return apiRequest('/api/check-status', {
    method: 'POST',
    body: JSON.stringify(details),
  });
}

const AUTOMATIC_STATUS_RETRIES = 3;
const RETRY_DELAY_MS = 500;

function isRetryableStatusCheckError(error) {
  return error.status === undefined || error.status >= 500;
}

function isVoterServerUnavailableResponse(result) {
  return result.retryable === true
    || /NI[DN] सर्भरबाट डेटा प्राप्त हुन सकेन/i.test(batchResponseMessage(result.response));
}

async function checkStatusWithRetries(details, onRetry = () => {}, shouldStop = () => false) {
  let lastResult;
  let lastRetryReason = 'request failed';
  for (let attempt = 0; attempt <= AUTOMATIC_STATUS_RETRIES; attempt += 1) {
    try {
      const result = await checkStatus(details);
      lastResult = result;
      const hasResponseMessage = Boolean(batchResponseMessage(result.response));
      const unavailableResponse = isVoterServerUnavailableResponse(result);
      if (shouldStop()) {
        return { ...result, cancelled: true, noResponse: !hasResponseMessage || unavailableResponse };
      }
      const shouldRetry = unavailableResponse || !hasResponseMessage;
      if (!shouldRetry || attempt === AUTOMATIC_STATUS_RETRIES) {
        return { ...result, noResponse: !hasResponseMessage || unavailableResponse };
      }
      lastRetryReason = 'no response';
    } catch (error) {
      if (shouldStop()) {
        const stoppedError = new Error('Status check stopped for refresh.');
        stoppedError.code = 'STATUS_CHECK_STOPPED';
        throw stoppedError;
      }
      if (!isRetryableStatusCheckError(error) || attempt === AUTOMATIC_STATUS_RETRIES) {
        throw error;
      }
      lastRetryReason = 'request failed';
    }

    const retryNumber = attempt + 1;
    onRetry(retryNumber, lastRetryReason);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * retryNumber));
    if (shouldStop()) {
      if (lastResult) {
        const noResponse = !batchResponseMessage(lastResult.response)
          || isVoterServerUnavailableResponse(lastResult);
        return { ...lastResult, cancelled: true, noResponse };
      }
      const stoppedError = new Error('Status check stopped for refresh.');
      stoppedError.code = 'STATUS_CHECK_STOPPED';
      throw stoppedError;
    }
  }
  throw new Error('Status check retry limit was reached unexpectedly.');
}

function showStatusResult(record, response) {
  const number = record.voterListNumber || record.abedanNumber;
  const message = batchResponseMessage(response) || record.lastCheckMessage;
  if (record.status === 'DONE') {
    showToast(`Status DONE. Number: ${number}`);
  } else if (record.status === 'NOT ONLINE') {
    showToast(`Status NOT ONLINE. ${message || 'The search was unsuccessful.'}`);
  } else {
    showToast(`Status PENDING. ${message || 'No voter-list / Abedan number was returned.'}`);
  }
}

function checkRecordStatus(record, button) {
  if (state.statusCheckPromise) {
    if (state.activeStatusCheckId === record._id && !$('statusCheckResponseDialog').open) {
      $('statusCheckResponseDialog').showModal();
    }
    return state.statusCheckPromise;
  }
  if (state.checkingAll) {
    showToast('Wait for Check All to finish before checking an individual record.', true);
    return Promise.resolve();
  }
  state.stopStatusCheckRequested = false;
  state.activeStatusCheckId = record._id;
  const promise = runRecordStatusCheck(record, button);
  state.statusCheckPromise = promise.finally(() => {
    if (state.statusCheckPromise === trackedPromise) {
      state.statusCheckPromise = null;
      state.activeStatusCheckId = '';
    }
  });
  const trackedPromise = state.statusCheckPromise;
  return trackedPromise;
}

async function runRecordStatusCheck(record, button) {
  openStatusCheckResponseDialog(record);
  if (button) {
    button.disabled = true;
    button.classList.add('is-checking');
    button.setAttribute('aria-busy', 'true');
    button.querySelector('span').textContent = 'Checking…';
  }
  try {
    const result = await checkStatusWithRetries({
      nin: record.nin,
      dobAd: record.dobAd,
      firstname: record.fullName.trim().split(/\s+/)[0],
    }, (retryNumber, reason) => {
      const retryMessage = reason === 'no response'
        ? 'No response received from voterlist server'
        : 'Voterlist server is unavailable';
      showToast(`${retryMessage}. Retrying (${retryNumber}/${AUTOMATIC_STATUS_RETRIES})…`);
    }, () => state.stopStatusCheckRequested);
    if (result.cancelled || state.stopStatusCheckRequested) return;
    showStatusResult(result.record, result.response);
    const updatedRecord = {
      ...result.record,
      createdAt: record.createdAt,
      statusCheckCount: result.requestCount ?? (record.statusCheckCount || 0) + 1,
      uniqueSearchResponses: cacheableSearchResponses(result.responses || []),
    };
    state.records = state.records.map((item) => item._id === updatedRecord._id ? updatedRecord : item);
    state.recordsLoaded = true;
    cacheRecordsOrNotify();
    if ($('statusCheckResponseDialog').dataset.recordId === updatedRecord._id) {
      $('statusCheckResponseTitle').textContent = updatedRecord.fullName || 'Check response';
      $('statusCheckRecordSummary').textContent = `NIN: ${updatedRecord.nin} · Date of birth: ${updatedRecord.dobAd} · Status: ${updatedRecord.status}`;
      const hasResponseMessage = Boolean(batchResponseMessage(result.response));
      renderLatestCheckResponse(
        hasResponseMessage ? result.response : { message: 'No response received after automatic retries.' },
        hasResponseMessage ? `HTTP ${result.response?.httpStatus ?? 'response'}` : 'No response received',
      );
      $('retryStatusCheckButton').hidden = !(result.noResponse || result.retryable);
    }
    if ($('recordDetailsDialog').open
      && $('recordDetailsDialog').dataset.recordId === updatedRecord._id) {
      $('recordResponsesContent').innerHTML = renderUniqueResponses(updatedRecord.uniqueSearchResponses);
    }
    renderRecords();
  } catch (error) {
    if (state.stopStatusCheckRequested || error.code === 'STATUS_CHECK_STOPPED') return;
    if ($('statusCheckResponseDialog').dataset.recordId === record._id) {
      renderLatestCheckResponse({
        httpStatus: error.status ?? null,
        body: error.response ?? { error: error.message },
      }, 'Status check failed');
      $('retryStatusCheckButton').hidden = !isRetryableStatusCheckError(error);
    }
    showToast(error.message, true);
  } finally {
    if ($('statusCheckResponseDialog').dataset.recordId === record._id) {
      $('statusCheckResponseDialog').dataset.checking = 'false';
    }
    if (button) {
      button.disabled = false;
      button.classList.remove('is-checking');
      button.removeAttribute('aria-busy');
      button.querySelector('span').textContent = 'Check';
    }
  }
}

function batchResponseKey(response) {
  return batchResponseMessage(response) || 'No response message returned.';
}

function batchResponseMessage(value, depth = 0) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object' || depth > 6) return '';
  for (const key of ['message', 'error', 'detail', 'description']) {
    const message = value[key];
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  for (const entry of Object.values(value)) {
    if (Array.isArray(entry)) {
      for (const item of entry) {
        const message = batchResponseMessage(item, depth + 1);
        if (message) return message;
      }
    } else if (entry && typeof entry === 'object') {
      const message = batchResponseMessage(entry, depth + 1);
      if (message) return message;
    }
  }
  return '';
}

function batchResponseTone(response) {
  const text = JSON.stringify(response ?? '').toLocaleLowerCase();
  if (/nid सर्भरबाट डेटा प्राप्त हुन सकेन|nid server did not respond/.test(text)) {
    return 'server-unavailable';
  }
  if (/nin activated.{0,30}portrait received successfully|portrait received successfully/.test(text)) {
    return 'portrait';
  }
  if (/निवेदन स्वीकृत|मतदाता\s*(?:परिचयपत्र\s*)?(?:नं|नम्बर|नंबर)|voter.?list.{0,20}(?:no|number)/u.test(text)) {
    return 'approved';
  }
  if (/no record found|please verify nin|verify nin, dob/.test(text)) {
    return 'not-found';
  }
  return 'default';
}

function batchResponseGroups() {
  const groups = new Map();
  for (const result of state.batchResults) {
    const key = batchResponseKey(result.response);
    if (!groups.has(key)) {
      groups.set(key, { key, response: result.response, records: [] });
    }
    groups.get(key).records.push(result);
  }
  return [...groups.values()];
}

function batchDisplayGroups() {
  return [
    { key: ALL_BATCH_GROUP_KEY, response: null, records: state.batchResults },
    ...batchResponseGroups(),
  ];
}

function renderBatchResults() {
  const container = $('batchResults');
  if (!state.batchResults.length) {
    container.classList.remove('hidden');
    container.innerHTML = `
      <div class="batch-empty-state">
        <span aria-hidden="true">✓</span>
        <div><strong>All caught up</strong><p>There are no unfinished records to check.</p></div>
      </div>`;
    state.activeBatchResponseKey = '';
    return;
  }

  container.classList.remove('hidden');
  const groups = batchDisplayGroups();
  if (!groups.some((group) => group.key === state.activeBatchResponseKey)) {
    state.activeBatchResponseKey = ALL_BATCH_GROUP_KEY;
  }
  const activeGroup = groups.find((group) => group.key === state.activeBatchResponseKey) || groups[0];
  const retryable = activeGroup.records.filter((item) => recordStatus(item.record) !== 'DONE');

  container.innerHTML = `
    <div class="batch-group-toolbar">
      <div class="batch-response-tabs" role="tablist" aria-label="All records and unique server responses">
        ${groups.map((group, index) => {
          if (group.key === ALL_BATCH_GROUP_KEY) {
            const allRetryableCount = group.records.filter((item) => recordStatus(item.record) !== 'DONE').length;
            return `<button class="batch-response-tab ${group.key === activeGroup.key ? 'active' : ''}" type="button" role="tab" aria-selected="${group.key === activeGroup.key}" data-response-group-index="${index}">
              <span>All records</span><small>${group.records.length} ${group.records.length === 1 ? 'record' : 'records'} · ${allRetryableCount} to retry</small>
            </button>`;
          }
          const label = batchResponseMessage(group.response);
          const responseLabel = label
            ? label.length > 42 ? `${label.slice(0, 39)}…` : label
            : 'No response message returned.';
          const tabLabel = `Response ${index} · ${responseLabel}`;
          const groupRetryableCount = group.records.filter((item) => recordStatus(item.record) !== 'DONE').length;
          return `<button class="batch-response-tab response-tone-${batchResponseTone(group.response)} ${group.key === activeGroup.key ? 'active' : ''}" type="button" role="tab" aria-selected="${group.key === activeGroup.key}" data-response-group-index="${index}" title="${escapeHtml(label || tabLabel)}">
            <span>${escapeHtml(tabLabel)}</span><small>${group.records.length} ${group.records.length === 1 ? 'record' : 'records'} · ${groupRetryableCount} to retry</small>
          </button>`;
        }).join('')}
      </div>
      <button class="button primary batch-group-retry" type="button" data-retry-response-group="${groups.indexOf(activeGroup)}" ${state.checkingAll || !retryable.length ? 'disabled' : ''}>
        ${state.checkingAll ? 'Checking…' : activeGroup.key === ALL_BATCH_GROUP_KEY ? `Retry all unfinished (${retryable.length})` : `Retry this group (${retryable.length})`}
      </button>
    </div>
    <div class="batch-table-scroll" role="tabpanel">
      <table class="batch-table">
        <thead><tr><th>Name</th><th>NIN</th><th>Server response</th><th>Status</th></tr></thead>
        <tbody>
          ${activeGroup.records.map((result) => `
            <tr class="batch-record-row response-tone-${batchResponseTone(result.response)} status-row-${recordStatus(result.record).toLowerCase().replace(/\s+/g, '-')}">
              <td><strong>${escapeHtml(result.record.fullName)}</strong></td>
              <td>${escapeHtml(result.record.nin)}</td>
              <td><p class="batch-row-response">${escapeHtml(batchResponseMessage(result.response ?? { message: result.error || 'Awaiting first check' }) || 'No response message returned.')}</p></td>
              <td>${statusPill(recordStatus(result.record))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;

  container.querySelectorAll('[data-response-group-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const group = batchDisplayGroups()[Number(button.dataset.responseGroupIndex)];
      if (!group) return;
      state.activeBatchResponseKey = group.key;
      renderBatchResults();
    });
  });
  container.querySelector('[data-retry-response-group]')?.addEventListener('click', () => {
    const group = batchDisplayGroups()[Number(container.querySelector('[data-retry-response-group]').dataset.retryResponseGroup)];
    if (!group) return;
    const records = group.records
      .filter((item) => recordStatus(item.record) !== 'DONE')
      .map((item) => item.record);
    void runBatchChecks(records);
  });
}

function updateCheckAllDialog() {
  const records = visiblePendingRecords();
  state.activeBatchResponseKey = ALL_BATCH_GROUP_KEY;
  state.batchResults = records.map((record) => ({
    record,
    response: { message: 'Waiting to be checked.' },
    error: '',
  }));
  $('checkAllTitle').classList.toggle('hidden', records.length === 0);
  $('checkAllTitle').textContent = 'Check unfinished records';
  $('checkAllProgress').max = records.length || 1;
  $('checkAllProgress').value = 0;
  $('checkAllProgress').classList.add('hidden');
  $('checkAllProgressText').textContent = '';
  $('cancelCheckAllButton').textContent = 'Close';
  renderBatchResults();
}

async function runBatchChecks(records) {
  if (!records.length || state.checkingAll) return;
  state.checkingAll = true;
  state.stopBatchRequested = false;
  $('checkAllButton').disabled = false;
  $('checkAllButton').classList.add('is-checking');
  $('checkAllButton').classList.remove('is-backgrounded');
  $('checkAllButton').setAttribute('aria-label', 'Checking all unfinished records; click to view progress');
  $('checkAllButton').title = 'Checking all unfinished records';
  $('checkAllButton').setAttribute('aria-busy', 'true');
  $('checkAllProgress').max = records.length;
  $('checkAllProgress').value = 0;
  $('checkAllProgress').classList.remove('hidden');
  $('checkAllProgressText').textContent = `Checking 0 of ${records.length}…`;
  $('checkAllTitle').classList.add('hidden');
  $('cancelCheckAllButton').textContent = 'Close';
  $('cancelCheckAllButton').disabled = false;
  $('checkAllDialog').querySelector('.dialog-close').disabled = false;
  let checked = 0;
  let failed = 0;
  let remaining = 0;
  for (const record of records) {
    if (state.stopBatchRequested) {
      remaining = records.length - checked - failed;
      break;
    }
    const resultEntry = state.batchResults.find((item) => item.record._id === record._id);
    if (resultEntry) {
      resultEntry.response = { message: 'Waiting for voterlist server response…' };
      resultEntry.error = '';
    }
    renderBatchResults();
    try {
      const result = await checkStatusWithRetries({
        nin: record.nin,
        dobAd: record.dobAd,
        firstname: record.fullName.trim().split(/\s+/)[0],
      }, (retryNumber) => {
        if (resultEntry) {
          resultEntry.response = {
            error: 'NID server did not respond. Automatically retrying.',
            retry: `${retryNumber}/${AUTOMATIC_STATUS_RETRIES}`,
          };
          $('checkAllProgressText').textContent = `Retrying ${record.fullName} (${retryNumber}/${AUTOMATIC_STATUS_RETRIES})…`;
          renderBatchResults();
        }
      }, () => state.stopBatchRequested);
      const updatedRecord = {
        ...result.record,
        createdAt: record.createdAt,
        statusCheckCount: result.requestCount ?? (record.statusCheckCount || 0) + 1,
        uniqueSearchResponses: cacheableSearchResponses(result.responses || []),
      };
      state.records = state.records.map((item) => item._id === updatedRecord._id ? updatedRecord : item);
      state.recordsLoaded = true;
      cacheRecordsOrNotify();
      if (resultEntry) {
        resultEntry.record = updatedRecord;
        resultEntry.response = result.response ?? { message: result.record.lastCheckMessage };
      }
      checked += 1;
    } catch (error) {
      failed += 1;
      console.error(`Could not check status for record ${record._id}:`, error);
      if (resultEntry) {
        resultEntry.response = { error: error.message };
        resultEntry.error = error.message;
      }
    }
    const completed = checked + failed;
    $('checkAllProgress').value = completed;
    $('checkAllProgressText').textContent = `Checked ${completed} of ${records.length}…`;
    renderRecords();
    renderBatchResults();
  }

  state.checkingAll = false;
  $('checkAllProgressText').textContent = `Finished: ${checked} checked, ${failed} failed.`;
  $('cancelCheckAllButton').disabled = false;
  $('cancelCheckAllButton').textContent = 'Close';
  $('checkAllDialog').querySelector('.dialog-close').disabled = false;
  $('checkAllButton').disabled = false;
  $('checkAllButton').classList.remove('is-checking');
  $('checkAllButton').classList.remove('is-backgrounded');
  $('checkAllButton').setAttribute('aria-label', 'Check all unfinished records');
  $('checkAllButton').title = 'Check all unfinished records';
  $('checkAllButton').removeAttribute('aria-busy');
  renderRecords();
  if (remaining) {
    $('checkAllProgressText').textContent = `Stopped: ${checked} checked, ${failed} failed, ${remaining} remaining.`;
    if (!state.refreshingRecords) showToast(`Check all stopped: ${checked} checked, ${remaining} remaining.`);
  } else {
    showToast(`Check all complete: ${checked} checked, ${failed} failed.`, failed > 0);
  }
}

function verificationUrl(record) {
  return `https://voterlist.sujalmehta.com.np/verify/${encodeURIComponent(record.qrToken)}`;
}

function printCardMarkup(record, index) {
  const fields = [
    ['NID / NIN', record.nin],
    ['Date of birth (AD)', record.dobAd],
    ['Date of birth (BS)', record.dobBs],
    ['Mobile number', record.mobile],
    ['Notes', record.notes],
  ];
  return `
      <div class="print-card">
        <div class="print-main">
          <div class="print-person">
            <p class="print-eyebrow">VOTERLIST FORM RECORD</p>
            <h1>${escapeHtml(record.fullName || 'Voterlist form record')}</h1>
            <div class="print-fields">
              ${fields.map(([label, value]) => `
                <div class="print-field"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '—')}</strong></div>
              `).join('')}
            </div>
          </div>
          <div class="print-qr" data-print-qr="${index}"></div>
        </div>
        <ul class="print-note">
          <li>राष्ट्रिय परिचयपत्र अनलाइन सक्रिय भएपछि त्यसको जानकारीको सन्देश तपाईंको फोनमा प्राप्त हुनेछ।</li>
          <li>सन्देश प्राप्त भएपछि यहाँ दर्ता गरिएको विवरण अनलाइनमा हेर्न सक्नुहुनेछ।</li>
          <li>तपाईंको निवेदनको स्थिति जाँच गर्न QR स्क्यान गर्नुहोस्। सबै अपडेट यहीँ उपलब्ध हुनेछन्।</li>
          <li>तपाईंसँग WhatsApp नम्बर भएमा दर्ता गरिएको PDF उक्त नम्बरमा पठाइनेछ।</li>
        </ul>
        <footer class="print-footer">
          <strong>INTERNATIONAL DIGITAL PHOTO STUDIO</strong>
          <div class="print-contacts">
            <span class="print-whatsapp">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 11.7a8.4 8.4 0 0 1-12.4 7.4L3 20.5l1.5-4.9a8.4 8.4 0 1 1 16-3.9Z"/><path d="M8.2 7.8c.2-.4.4-.4.7-.4h.5c.2 0 .4.1.5.4l.8 1.9c.1.2.1.4-.1.6l-.6.7c-.2.2-.2.4-.1.6.5.9 1.3 1.7 2.2 2.2.2.1.4.1.6-.1l.7-.8c.2-.2.4-.2.6-.1l1.8.9c.2.1.4.2.4.4 0 .3-.2 1.1-.7 1.5-.5.4-1.1.6-1.8.5-.8-.1-1.8-.5-3.1-1.4-1.7-1.2-2.8-2.9-3.1-3.7-.3-.8-.3-1.5 0-2 .2-.5.5-.9.7-1.2Z"/></svg>
              9804090881
            </span>
            <span>☎ 9842101229</span>
          </div>
        </footer>
      </div>
  `;
}

function printRecords(records) {
  if (typeof window.QRCode !== 'function') {
    showToast('QR generator did not load. Check your connection and reload before printing.', true);
    return;
  }
  if (!records.length) return;
  const printSheet = $('printSheet');
  printSheet.innerHTML = records.map((record, index) => `
    <div class="print-page">${printCardMarkup(record, index)}</div>
  `).join('');
  records.forEach((record, index) => {
    const qrContainer = printSheet.querySelector(`[data-print-qr="${index}"]`);
    new window.QRCode(qrContainer, {
      text: verificationUrl(record),
      width: 320,
      height: 320,
      colorDark: '#102c32',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.H,
    });
  });
  window.addEventListener('afterprint', () => {
    printSheet.replaceChildren();
  }, { once: true });
  window.setTimeout(() => window.print(), 250);
}

function printRecord(record) {
  printRecords([record]);
}

function updateMultiplePrintSelection() {
  const checkboxes = [...$('multiplePrintRecords').querySelectorAll('[data-print-select]')];
  const selectedCount = checkboxes.filter((checkbox) => checkbox.checked).length;
  $('selectedPrintCount').textContent = `${selectedCount} selected`;
  $('printSelectedRecordsButton').disabled = selectedCount === 0;
  $('selectAllPrintRecords').checked = checkboxes.length > 0 && selectedCount === checkboxes.length;
  $('selectAllPrintRecords').indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
}

function openMultiplePrintDialog() {
  const container = $('multiplePrintRecords');
  if (!state.records.length) {
    container.innerHTML = '<p class="multiple-print-empty">No records are available to print.</p>';
  } else {
    container.innerHTML = state.records.map((record) => `
      <label class="multiple-print-row">
        <input type="checkbox" data-print-select="${escapeHtml(record._id)}" />
        <span><strong>${escapeHtml(record.fullName)}</strong><small>${escapeHtml(record.nin)} · ${escapeHtml(formatBsDate(record.createdAt))} BS</small></span>
      </label>
    `).join('');
  }
  $('selectAllPrintRecords').checked = false;
  $('selectAllPrintRecords').indeterminate = false;
  updateMultiplePrintSelection();
  $('multiplePrintDialog').showModal();
}

function animateToolbarAction(button) {
  button.classList.remove('is-activated');
  void button.offsetWidth;
  button.classList.add('is-activated');
  window.setTimeout(() => button.classList.remove('is-activated'), 400);
}

async function backupRecords() {
  const button = $('backupRecordsButton');
  animateToolbarAction(button);
  button.disabled = true;
  button.classList.add('is-working');
  try {
    if (!await loadRecords({ force: true })) return;
    const exportedAt = new Date();
    const backup = {
      application: 'Voterlist System',
      formatVersion: 1,
      exportedAt: exportedAt.toISOString(),
      recordCount: state.records.length,
      records: state.records,
    };
    const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `voterlist-backup-${exportedAt.toISOString().replace(/[:.]/g, '-')}.json`;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Downloaded JSON backup with ${state.records.length} records.`);
  } catch (error) {
    console.error('Could not download voterlist backup:', error);
    showToast('Could not create the JSON backup. Please try again.', true);
  } finally {
    button.disabled = false;
    button.classList.remove('is-working');
  }
}

function renderPublicRecord(record) {
  const status = recordStatus(record);
  const number = recordNumber(record);
  const statusMessage = status === 'DONE'
    ? number.value !== '—'
      ? `तपाईंको मतदाता सूची तयार भइसकेको छ। ${number.label}: ${number.value}`
      : 'तपाईंको मतदाता सूची तयार भइसकेको छ। नम्बरका लागि कृपया हामीलाई सम्पर्क गर्नुहोस्।'
    : status === 'PENDING'
      ? 'राष्ट्रिय परिचयपत्र अनलाइन भइसकेको छ। १–२ दिनभित्र मतदाता सूचीसम्बन्धी सन्देश नआएमा कृपया हामीलाई सम्पर्क गर्नुहोस्।'
      : 'राष्ट्रिय परिचयपत्र अनलाइन भएको छैन। अनलाइन भएपछि तपाईंको मोबाइलमा सन्देश प्राप्त हुनेछ।';
  $('verifyContent').innerHTML = `
    <h1>${escapeHtml(record.fullName)}</h1>
    <p>${statusPill(status)}</p>
    <div class="verify-status-message verify-status-${status.toLowerCase().replace(/\s+/g, '-')}" role="status">
      <strong>${escapeHtml(statusMessage)}</strong>
      ${status === 'PENDING'
        ? '<span>सम्पर्क: 9842101229</span><span>WhatsApp: 9804090881</span>'
        : status === 'DONE' ? '<span>सम्पर्क: 9842101229</span>' : ''}
    </div>
    <div class="verify-fields">
      <div class="verify-field"><span>NID / NIN</span><strong>${escapeHtml(record.nin)}</strong></div>
      <div class="verify-field"><span>Mobile number</span><strong>${escapeHtml(record.mobile)}</strong></div>
      <div class="verify-field"><span>Date of birth (AD)</span><strong>${escapeHtml(record.dobAd)}</strong></div>
      <div class="verify-field"><span>Date of birth (BS)</span><strong>${escapeHtml(record.dobBs)}</strong></div>
      ${status === 'DONE' ? `<div class="verify-field verify-number-field"><span>${escapeHtml(number.label)}</span><strong>${escapeHtml(number.value)}</strong></div>` : ''}
      <div class="verify-field"><span>Notes</span><strong>${escapeHtml(record.notes || '—')}</strong></div>
      <div class="verify-field"><span>Created</span><strong>${escapeHtml(formatDate(record.createdAt))}</strong></div>
    </div>
  `;
}

async function showPublicVerification(code) {
  setScreen('verifyScreen');
  try {
    const { record } = await apiRequest(`/api/public-record?code=${encodeURIComponent(code)}`);
    renderPublicRecord(record);
  } catch (error) {
    $('verifyContent').innerHTML = `<p class="message">${escapeHtml(error.message)}</p>`;
  }
}

function wireRecordEntryForm(form, entryType) {
  form.addEventListener('submit', (event) => handleCreateRecord(event, entryType));
  form.elements.nin.addEventListener('input', (event) => formatNinInput(event.currentTarget));
  form.elements.mobile.addEventListener('input', (event) => {
    event.currentTarget.value = event.currentTarget.value.replace(/\D/g, '').slice(0, 10);
  });
  form.elements.fullName.addEventListener('input', (event) => {
    const input = event.currentTarget;
    const caret = input.selectionStart;
    const rawValue = input.value;
    const value = rawValue.replace(/[^\p{L}\p{M}. ]/gu, '').toUpperCase();
    const normalizedPrefix = caret === null
      ? ''
      : rawValue.slice(0, caret).replace(/[^\p{L}\p{M}. ]/gu, '').toUpperCase();
    input.value = value;
    if (caret !== null) {
      const position = Math.min(normalizedPrefix.length, value.length);
      input.setSelectionRange(position, position);
    }
  });
  form.elements.dobAd.addEventListener('input', (event) => {
    formatIsoDateInput(event.currentTarget);
    syncDatePair('ad', false, form);
  });
  form.elements.dobBs.addEventListener('input', (event) => {
    formatIsoDateInput(event.currentTarget);
    syncDatePair('bs', false, form);
  });
  form.elements.dobAd.addEventListener('change', () => syncDatePair('ad', true, form));
  form.elements.dobBs.addEventListener('change', () => syncDatePair('bs', true, form));
  if (entryType === 'old') {
    form.elements.registeredDate.addEventListener('input', (event) => formatIsoDateInput(event.currentTarget));
  }
}

async function initializeApp() {
  const url = new URL(window.location.href);
  const routeCode = window.location.pathname.match(/^\/verify\/([^/]+)\/?$/)?.[1];
  const publicCode = url.searchParams.get('verify') || (routeCode ? decodeURIComponent(routeCode) : '');
  if (publicCode) {
    await showPublicVerification(publicCode);
    return;
  }

  loadRecordColumnPreferences();
  loadCachedWorkspaceSettings();
  $('loginForm').addEventListener('submit', handleLogin);
  wireRecordEntryForm($('recordForm'), 'standard');
  wireRecordEntryForm($('oldRecordForm'), 'old');
  $('updateConfirmText').addEventListener('input', (event) => {
    $('saveRecordButton').disabled = state.editingRecordId
      ? event.currentTarget.value !== 'UPDATE'
      : false;
  });
  $('cancelEditButton').addEventListener('click', () => {
    resetRecordForm();
    setTab('entry');
  });
  $('settingsButton').addEventListener('click', () => {
    $('settingsDialog').showModal();
  });
  $('openPasswordDialogButton').addEventListener('click', () => {
    $('passwordMessage').textContent = '';
    $('passwordDialog').showModal();
  });
  $('openWorkspaceSettingsButton').addEventListener('click', () => {
    $('workspacePasswordForm').reset();
    $('workspacePasswordMessage').textContent = '';
    $('settingsDialog').close();
    $('workspacePasswordDialog').showModal();
  });
  $('workspacePasswordForm').addEventListener('submit', verifyWorkspaceAdminPassword);
  $('workspaceSettingsForm').addEventListener('submit', saveWorkspaceSettings);
  $('passwordForm').addEventListener('submit', handlePasswordChange);
  $('passwordForm').querySelectorAll('[data-password-toggle]').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const input = $(toggle.dataset.passwordToggle);
      const isVisible = input.type === 'text';
      input.type = isVisible ? 'password' : 'text';
      toggle.setAttribute('aria-pressed', String(!isVisible));
      const label = input.labels[0]?.textContent.trim() || 'password';
      toggle.setAttribute('aria-label', `${isVisible ? 'Show' : 'Hide'} ${label.toLocaleLowerCase()}`);
      toggle.title = `${isVisible ? 'Show' : 'Hide'} password`;
    });
  });
  $('cancelSettingsButton').addEventListener('click', () => $('settingsDialog').close());
  $('cancelPasswordButton').addEventListener('click', () => $('passwordDialog').close());
  $('cancelWorkspacePasswordButton').addEventListener('click', () => $('workspacePasswordDialog').close());
  $('cancelWorkspaceSettingsButton').addEventListener('click', () => $('workspaceSettingsDialog').close());
  $('closeRegistrationAnalyticsButton').addEventListener('click', () => $('registrationAnalyticsDialog').close());
  $('registrationAnalyticsDialog').addEventListener('click', (event) => {
    if (event.target === $('registrationAnalyticsDialog')) $('registrationAnalyticsDialog').close();
  });
  $('closeRecordDetailsButton').addEventListener('click', () => $('recordDetailsDialog').close());
  $('closeStatusCheckResponseButton').addEventListener('click', () => $('statusCheckResponseDialog').close());
  $('retryStatusCheckButton').addEventListener('click', () => {
    const recordId = $('statusCheckResponseDialog').dataset.recordId;
    const record = state.records.find((item) => item._id === recordId);
    if (record) void checkRecordStatus(record, null);
  });
  $('statusCheckResponseDialog').addEventListener('click', (event) => {
    if (event.target === $('statusCheckResponseDialog')) $('statusCheckResponseDialog').close();
  });
  $('visitRecordQrButton').addEventListener('click', () => {
    const record = state.records.find((item) => item._id === $('recordDetailsDialog').dataset.recordId);
    if (!record?.qrToken) {
      showToast('This record does not have a QR verification link.', true);
      return;
    }
    window.open(verificationUrl(record), '_blank', 'noopener,noreferrer');
  });
  $('recordUpdatesButton').addEventListener('click', () => void openRecordUpdatesHistory());
  $('closeRecordUpdatesButton').addEventListener('click', () => $('recordUpdatesDialog').close());
  $('recordUpdatesDialog').addEventListener('click', (event) => {
    if (event.target === $('recordUpdatesDialog')) $('recordUpdatesDialog').close();
  });
  $('editRecordButton').addEventListener('click', () => {
    const record = state.records.find((item) => item._id === $('recordDetailsDialog').dataset.recordId);
    if (record) beginRecordEdit(record);
  });
  $('recordDetailsDialog').addEventListener('click', (event) => {
    if (event.target === $('recordDetailsDialog')) $('recordDetailsDialog').close();
  });
  $('settingsDialog').addEventListener('click', (event) => {
    if (event.target === $('settingsDialog')) $('settingsDialog').close();
  });
  $('passwordDialog').addEventListener('click', (event) => {
    if (event.target === $('passwordDialog')) $('passwordDialog').close();
  });
  $('workspacePasswordDialog').addEventListener('click', (event) => {
    if (event.target === $('workspacePasswordDialog')) $('workspacePasswordDialog').close();
  });
  $('workspacePasswordDialog').addEventListener('close', () => {
    $('workspacePasswordForm').reset();
    $('workspacePasswordMessage').textContent = '';
  });
  $('workspaceSettingsDialog').addEventListener('click', (event) => {
    if (event.target === $('workspaceSettingsDialog')) $('workspaceSettingsDialog').close();
  });
  $('recordsSearch').addEventListener('input', renderRecords);
  $('recordColumnsButton').addEventListener('click', () => {
    $('settingsDialog').close();
    openColumnSettings();
  });
  $('backupRecordsButton').addEventListener('click', () => void backupRecords());
  $('printMultipleButton').addEventListener('click', () => {
    animateToolbarAction($('printMultipleButton'));
    openMultiplePrintDialog();
  });
  $('selectAllPrintRecords').addEventListener('change', (event) => {
    $('multiplePrintRecords').querySelectorAll('[data-print-select]').forEach((checkbox) => {
      checkbox.checked = event.currentTarget.checked;
    });
    updateMultiplePrintSelection();
  });
  $('multiplePrintRecords').addEventListener('change', updateMultiplePrintSelection);
  $('printSelectedRecordsButton').addEventListener('click', () => {
    const selectedIds = new Set([...$('multiplePrintRecords').querySelectorAll('[data-print-select]:checked')]
      .map((checkbox) => checkbox.dataset.printSelect));
    const selectedRecords = state.records.filter((record) => selectedIds.has(record._id));
    if (!selectedRecords.length) {
      showToast('Select at least one record to print.', true);
      return;
    }
    $('multiplePrintDialog').close();
    printRecords(selectedRecords);
  });
  $('cancelMultiplePrintButton').addEventListener('click', () => $('multiplePrintDialog').close());
  $('multiplePrintDialog').addEventListener('click', (event) => {
    if (event.target === $('multiplePrintDialog')) $('multiplePrintDialog').close();
  });
  $('saveColumnSettingsButton').addEventListener('click', saveColumnSettings);
  $('cancelColumnSettingsButton').addEventListener('click', () => $('recordColumnsDialog').close());
  $('recordColumnsDialog').addEventListener('click', (event) => {
    if (event.target === $('recordColumnsDialog')) $('recordColumnsDialog').close();
  });
  $('datePeriodFilter').addEventListener('change', renderRecords);
  $('registrationSort').addEventListener('change', renderRecords);
  $('clearFiltersButton').addEventListener('click', () => {
    $('recordsSearch').value = '';
    $('datePeriodFilter').value = 'ALL';
    $('registrationSort').value = 'NEWEST';
    state.selectedStatusFilter = 'NOT DONE';
    renderRecords();
  });
  $('printSavedRecordButton').addEventListener('click', () => {
    const record = state.savedRecord;
    $('savedRecordDialog').close();
    if (!record) return;
    setTab('records');
    printRecord(record);
  });
  $('cancelSavedRecordButton').addEventListener('click', () => {
    $('savedRecordDialog').close();
    showToast('Record saved. You can print it later from Records & Status.');
  });
  $('checkAllButton').addEventListener('click', async () => {
    animateToolbarAction($('checkAllButton'));
    if (state.checkingAll) {
      if (!$('checkAllDialog').open) {
        $('checkAllButton').classList.remove('is-backgrounded');
        $('checkAllButton').setAttribute('aria-label', 'Check All is running; open progress');
        $('checkAllDialog').showModal();
      }
      return;
    }
    if (state.statusCheckPromise) {
      showToast('Wait for the individual status check to finish before starting Check All.', true);
      return;
    }
    if (state.refreshingRecords) return;
    const button = $('checkAllButton');
    button.disabled = true;
    button.classList.add('is-checking');
    button.setAttribute('aria-busy', 'true');
    try {
      if (!await loadRecords()) return;
      updateCheckAllDialog();
      button.classList.remove('is-backgrounded');
      $('checkAllDialog').showModal();
      const batchPromise = runBatchChecks(visiblePendingRecords());
      state.batchRunPromise = batchPromise;
      try {
        await batchPromise;
      } finally {
        if (state.batchRunPromise === batchPromise) state.batchRunPromise = null;
      }
    } finally {
      if (!state.checkingAll) {
        button.disabled = false;
        button.classList.remove('is-checking');
        button.setAttribute('aria-label', 'Check all unfinished records');
        button.title = 'Check all unfinished records';
        button.removeAttribute('aria-busy');
      }
    }
  });
  $('cancelCheckAllButton').addEventListener('click', () => {
    $('checkAllDialog').close();
  });
  $('checkAllDialog').addEventListener('close', () => {
    if (state.checkingAll) {
      $('checkAllButton').classList.add('is-backgrounded');
      $('checkAllButton').setAttribute('aria-label', 'Check All is running in the background; open progress');
    }
  });
  document.querySelectorAll('.tab[data-tab]').forEach((button) => {
    button.addEventListener('click', () => setTab(button.dataset.tab));
  });
  document.addEventListener('keydown', (event) => {
    const hasCommandKey = event.ctrlKey || event.metaKey;
    const shortcutKey = event.key.toLocaleLowerCase();
    const appIsVisible = !$('appScreen').classList.contains('hidden');
    if (hasCommandKey && shortcutKey === 'r' && appIsVisible) {
      event.preventDefault();
      void softRefresh();
    } else if (hasCommandKey && ['s', 'f'].includes(shortcutKey) && appIsVisible) {
      event.preventDefault();
      const tabName = shortcutKey === 's' ? 'entry' : 'records';
      const focusId = shortcutKey === 's' ? 'nin' : 'recordsSearch';
      const isCurrentTab = state.currentTab === tabName;
      setTab(tabName);
      $(focusId).focus();
      if (!isCurrentTab) return;

      const reportFullscreenError = (error) => {
        console.error('Could not toggle fullscreen:', error);
        showToast('Fullscreen could not be changed. Use your browser fullscreen control.', true);
      };
      try {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(reportFullscreenError);
        } else {
          document.documentElement.requestFullscreen().catch(reportFullscreenError);
        }
      } catch (error) {
        reportFullscreenError(error);
      }
    }
  });

  try {
    const session = await apiRequest('/api/auth');
    if (session.authenticated) {
      setScreen('appScreen');
      await syncWorkspaceSettings();
      if (!loadCachedRecords()) await loadRecords({ force: true });
    } else {
      setScreen('loginScreen');
    }
  } catch (error) {
    $('loginMessage').textContent = error.message;
    setScreen('loginScreen');
  }
}

document.addEventListener('DOMContentLoaded', initializeApp);
