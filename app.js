const state = {
  records: [],
  currentTab: 'entry',
  workspaceSettings: {
    hideEntryTab: false,
    hideOldEntryTab: false,
    hideDatabaseTab: false,
    hidePrintMultipleButton: false,
    hideDeleteMultipleButton: false,
    hideRecordDeleteButton: false,
    automaticStatusRetries: 3,
    checkAllConcurrency: 5,
  },
  checkingAll: false,
  stopBatchRequested: false,
  batchRunPromise: null,
  statusCheckPromise: null,
  activeStatusChecks: new Map(),
  individualCheckResults: [],
  individualCheckOpenTimer: null,
  retryingUnavailableChecks: false,
  retryingIndividualChecks: new Set(),
  stopStatusCheckRequested: false,
  refreshingRecords: false,
  settingsUnlocked: false,
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
    $('settingsDialog').close();
    state.settingsUnlocked = false;
    $('loginMessage').textContent = 'Password updated. Sign in again with your new password.';
    setScreen('loginScreen');
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
    && typeof settings.hidePrintMultipleButton === 'boolean'
    && typeof settings.hideDeleteMultipleButton === 'boolean'
    && typeof settings.hideRecordDeleteButton === 'boolean'
    && Number.isInteger(settings.automaticStatusRetries)
    && settings.automaticStatusRetries >= 1
    && settings.automaticStatusRetries <= 15
    && Number.isInteger(settings.checkAllConcurrency)
    && settings.checkAllConcurrency >= 1
    && settings.checkAllConcurrency <= 15
    && !(settings.hideEntryTab && settings.hideOldEntryTab && settings.hideDatabaseTab);
}

function normalizeWorkspaceSettings(settings) {
  if (!settings || typeof settings !== 'object') return null;
  const normalized = {
    hideEntryTab: settings.hideEntryTab,
    hideOldEntryTab: settings.hideOldEntryTab ?? false,
    hideDatabaseTab: settings.hideDatabaseTab,
    hidePrintMultipleButton: settings.hidePrintMultipleButton ?? false,
    hideDeleteMultipleButton: settings.hideDeleteMultipleButton ?? false,
    hideRecordDeleteButton: settings.hideRecordDeleteButton ?? false,
    automaticStatusRetries: settings.automaticStatusRetries ?? 3,
    checkAllConcurrency: settings.checkAllConcurrency ?? 5,
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
  $('printMultipleButton').classList.toggle('hidden', state.workspaceSettings.hidePrintMultipleButton);
  $('deleteMultipleButton').classList.toggle('hidden', state.workspaceSettings.hideDeleteMultipleButton);
  document.querySelectorAll('[data-delete]').forEach((button) => {
    button.classList.toggle('hidden', state.workspaceSettings.hideRecordDeleteButton);
  });
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
    hidePrintMultipleButton: $('hidePrintMultipleButton').checked,
    hideDeleteMultipleButton: $('hideDeleteMultipleButton').checked,
    hideRecordDeleteButton: $('hideRecordDeleteButton').checked,
    automaticStatusRetries: state.workspaceSettings.automaticStatusRetries,
    checkAllConcurrency: state.workspaceSettings.checkAllConcurrency,
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
    $('workspacePasswordForm').reset();
    state.settingsUnlocked = true;
    renderSettingsAccess();
    showToast('Admin settings unlocked for this session.');
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function signOutFromSettings() {
  const button = $('settingsSignOutButton');
  button.disabled = true;
  try {
    await apiRequest('/api/auth', { method: 'DELETE' });
    $('settingsDialog').close();
    state.settingsUnlocked = false;
    $('loginPassword').value = '';
    $('loginMessage').textContent = 'You have been signed out.';
    setScreen('loginScreen');
  } catch (error) {
    showToast(`Could not sign out: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
}

async function saveRetrySettings(event) {
  event.preventDefault();
  const retries = Number($('automaticStatusRetries').value);
  const message = $('retrySettingsMessage');
  const button = $('saveRetrySettingsButton');
  message.textContent = '';
  if (!Number.isInteger(retries) || retries < 1 || retries > 15) {
    message.textContent = 'Enter a whole number from 1 to 15.';
    return;
  }

  button.disabled = true;
  try {
    const result = await apiRequest('/api/workspace-settings', {
      method: 'PUT',
      body: JSON.stringify({ ...state.workspaceSettings, automaticStatusRetries: retries }),
    });
    const savedSettings = normalizeWorkspaceSettings(result.settings);
    if (!savedSettings) throw new Error('The server returned invalid retry settings.');
    state.workspaceSettings = savedSettings;
    try {
      localStorage.setItem(WORKSPACE_SETTINGS_KEY, JSON.stringify(savedSettings));
    } catch (error) {
      console.error('Could not cache retry settings locally:', error);
      showToast('Retry count was saved, but could not be cached in this browser.', true);
    }
    $('retrySettingsDialog').close();
    showToast(`Automatic retry count set to ${retries}.`);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function saveCheckAllConcurrency(event) {
  event.preventDefault();
  const concurrency = Number($('checkAllConcurrency').value);
  const message = $('checkAllConcurrencyMessage');
  const button = $('saveCheckAllConcurrencyButton');
  message.textContent = '';
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 15) {
    message.textContent = 'Enter a whole number from 1 to 15.';
    return;
  }

  button.disabled = true;
  try {
    const result = await apiRequest('/api/workspace-settings', {
      method: 'PUT',
      body: JSON.stringify({ ...state.workspaceSettings, checkAllConcurrency: concurrency }),
    });
    const savedSettings = normalizeWorkspaceSettings(result.settings);
    if (!savedSettings) throw new Error('The server returned invalid Check All concurrency settings.');
    state.workspaceSettings = savedSettings;
    try {
      localStorage.setItem(WORKSPACE_SETTINGS_KEY, JSON.stringify(savedSettings));
    } catch (error) {
      console.error('Could not cache Check All concurrency setting locally:', error);
      showToast('Check All concurrency was saved, but could not be cached in this browser.', true);
    }
    $('checkAllConcurrencyDialog').close();
    showToast(`Check All will process up to ${concurrency} records at once.`);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function softRefresh() {
  if (state.refreshingRecords) return;
  state.refreshingRecords = true;
  document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
  showToast('Refreshing records…');
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
    $('updatedDatePeriod').value = 'ALL';
    $('registrationDateFilter').value = '';
    $('updatedDateFilter').value = '';
    $('registrationSort').value = 'NEWEST';
    state.selectedStatusFilter = 'NOT DONE';
    const loaded = await loadRecords({ force: true });
    if (loaded) {
      showToast('Records synced. Forms, searches, and filters have been cleared.');
    }
  } finally {
    state.stopBatchRequested = false;
    state.stopStatusCheckRequested = false;
    state.refreshingRecords = false;
    const toast = $('appMessage');
    toast.classList.remove('refreshing');
    window.clearTimeout(showToast.timeout);
    showToast.timeout = window.setTimeout(() => toast.classList.add('hidden'), 6000);
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
  toast.classList.toggle('refreshing', state.refreshingRecords);
  toast.classList.remove('hidden');
  toast.classList.remove('toast-enter');
  void toast.offsetWidth;
  toast.classList.add('toast-enter');
  window.clearTimeout(showToast.timeout);
  if (!state.refreshingRecords) {
    showToast.timeout = window.setTimeout(() => toast.classList.add('hidden'), 6000);
  }
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

function renderRecordColumnSettings() {
  $('recordColumnsOptions').innerHTML = RECORD_COLUMNS.map((column) => `
    <button class="column-setting-option${state.visibleRecordColumns.includes(column.id) ? ' is-selected' : ''}" type="button" data-record-column-toggle="${column.id}" aria-pressed="${state.visibleRecordColumns.includes(column.id)}">
      ${escapeHtml(column.label)}
    </button>
  `).join('');
}

function saveColumnSettings(event) {
  const button = event.target.closest('[data-record-column-toggle]');
  if (!button) return;
  const columnId = button.dataset.recordColumnToggle;
  const isSelected = state.visibleRecordColumns.includes(columnId);
  const selected = isSelected
    ? state.visibleRecordColumns.filter((column) => column !== columnId)
    : [...state.visibleRecordColumns, columnId];
  if (!selected.length) {
    showToast('Select at least one column to display.', true);
    return;
  }
  try {
    localStorage.setItem(RECORD_COLUMNS_KEY, JSON.stringify(selected));
  } catch (error) {
    console.error('Could not save table column preferences:', error);
    showToast('Column settings could not be saved in this browser.', true);
    renderRecordColumnSettings();
    return;
  }
  state.visibleRecordColumns = selected;
  applyRecordColumnVisibility();
  renderRecordColumnSettings();
}

function renderSettingsAccess() {
  $('settingsUnlockSection').classList.toggle('hidden', state.settingsUnlocked);
  $('adminSettingsSections').classList.toggle('hidden', !state.settingsUnlocked);
  if (!state.settingsUnlocked) {
    $('workspacePasswordForm').reset();
    $('workspacePasswordMessage').textContent = '';
  }
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

function matchesDatePeriod(record, period, field = 'createdAt') {
  if (period === 'ALL') return true;
  if (!record[field]) return false;
  const recordDate = new Date(record[field]);
  if (Number.isNaN(recordDate.getTime())) return false;
  const start = periodStartDate(period);
  if (!start) return true;
  const end = new Date(start);
  if (period === 'THIS_WEEK') end.setDate(end.getDate() + 7);
  else if (period === 'THIS_MONTH') end.setMonth(end.getMonth() + 1);
  else if (period === 'THIS_YEAR') end.setFullYear(end.getFullYear() + 1);
  else end.setDate(end.getDate() + 1);
  return recordDate >= start && recordDate < end;
}

function matchesExactDate(record, field, dateValue) {
  if (!dateValue) return true;
  const parts = registrationDateParts(record[field]);
  if (!parts) return false;
  const [year, month, day] = dateValue.split('-').map(Number);
  return parts.year === year && parts.month === month - 1 && parts.day === day;
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
  const selectedRecords = getRegistrationAnalyticsRecords(selectedPeriod);
  const selectedUndoneRecords = selectedRecords.filter((record) => recordStatus(record) !== 'DONE');
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
    <section class="registration-analytics-records">
      <div class="registration-analytics-records-heading">
        <h3>${escapeHtml(selectedPeriod.label)} registrations <span>${selectedRecords.length}</span></h3>
        <div class="registration-analytics-check-actions">
          <button class="button primary" id="checkRegistrationPeriodButton" type="button" ${!selectedRecords.length || state.checkingAll ? 'disabled' : ''}>
            ${state.checkingAll ? 'Check All is running…' : `Check all (${selectedRecords.length})`}
          </button>
          <button class="button subtle" id="checkUndoneRegistrationPeriodButton" type="button" ${!selectedUndoneRecords.length || state.checkingAll ? 'disabled' : ''}>
            ${state.checkingAll ? 'Check All is running…' : `Check all undone (${selectedUndoneRecords.length})`}
          </button>
        </div>
      </div>
      <div class="registration-analytics-table-scroll">
        <table class="registration-analytics-table">
          <thead><tr><th>Name</th><th>NIN</th><th>Mobile</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${selectedRecords.length ? selectedRecords.map((record) => `
              <tr>
                <td><strong>${escapeHtml(record.fullName)}</strong></td>
                <td>${escapeHtml(record.nin)}</td>
                <td>${escapeHtml(record.mobile)}</td>
                <td>${statusPill(recordStatus(record))}</td>
                <td class="row-actions">
                  <button class="button primary tiny" type="button" data-analytics-check="${escapeHtml(record._id)}" ${state.checkingAll || state.activeStatusChecks.has(record._id) ? 'disabled' : ''}>Check</button>
                  <button class="button subtle tiny" type="button" data-analytics-print="${escapeHtml(record._id)}">Print</button>
                  ${state.workspaceSettings.hideRecordDeleteButton ? '' : `<button class="button tiny" type="button" data-analytics-delete="${escapeHtml(record._id)}">Delete</button>`}
                </td>
              </tr>
            `).join('') : '<tr><td class="empty-row" colspan="5">No records registered in this period.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `;
  $('registrationAnalyticsContent').querySelectorAll('[data-registration-period]').forEach((button) => {
    button.addEventListener('click', () => {
      state.registrationAnalyticsPeriod = button.dataset.registrationPeriod;
      renderRegistrationAnalytics();
    });
  });
  $('checkRegistrationPeriodButton').addEventListener('click', () => {
    startRegistrationPeriodChecks(selectedRecords, selectedPeriod);
  });
  $('checkUndoneRegistrationPeriodButton').addEventListener('click', () => {
    startRegistrationPeriodChecks(selectedUndoneRecords, selectedPeriod, 'undone');
  });
  $('registrationAnalyticsContent').querySelectorAll('[data-analytics-check]').forEach((button) => {
    button.addEventListener('click', () => {
      const record = state.records.find((item) => item._id === button.dataset.analyticsCheck);
      if (record) {
        void checkRecordStatus(record, null).finally(() => {
          if ($('registrationAnalyticsDialog').open) renderRegistrationAnalytics();
        });
      }
    });
  });
  $('registrationAnalyticsContent').querySelectorAll('[data-analytics-print]').forEach((button) => {
    button.addEventListener('click', () => {
      const record = state.records.find((item) => item._id === button.dataset.analyticsPrint);
      if (record) printRecord(record);
    });
  });
  $('registrationAnalyticsContent').querySelectorAll('[data-analytics-delete]').forEach((button) => {
    button.addEventListener('click', () => {
      const record = state.records.find((item) => item._id === button.dataset.analyticsDelete);
      if (record) openRecordDeleteDialog(record);
    });
  });
}

function startRegistrationPeriodChecks(records, period, recordScope = 'all') {
  if (state.checkingAll) {
    showToast('Wait for the current Check All run to finish.', true);
    return;
  }
  if (!records.length) return;
  const scopeLabel = recordScope === 'undone' ? 'unfinished registrations' : 'registrations';
  updateCheckAllDialog(records, `Check ${scopeLabel} for ${period.label}`);
  $('checkAllDialog').showModal();
  const batchPromise = runBatchChecks(records);
  state.batchRunPromise = batchPromise;
  void batchPromise.finally(() => {
    if (state.batchRunPromise === batchPromise) state.batchRunPromise = null;
    if ($('registrationAnalyticsDialog').open) renderRegistrationAnalytics();
  });
}

function getRegistrationAnalyticsRecords(period) {
  if (!period) return [];
  return state.records.filter((record) => {
    const date = registrationDateParts(record.createdAt);
    if (!date) return false;
    if (period.type === 'day') {
      return date.year === period.year && date.month === period.month && date.day === period.day;
    }
    if (period.type === 'month') return date.year === period.year && date.month === period.month;
    return date.year === period.year;
  });
}

function visibleRecords() {
  const search = $('recordsSearch').value;
  const datePeriod = $('datePeriodFilter').value;
  const updatedDatePeriod = $('updatedDatePeriod').value;
  const registrationDate = $('registrationDateFilter').value;
  const updatedDate = $('updatedDateFilter').value;
  const records = state.records.filter((record) => {
    const status = recordStatus(record);
    const matchesStatus = Boolean(search.trim())
      || state.selectedStatusFilter === 'ALL'
      || (state.selectedStatusFilter === 'NOT DONE' && status !== 'DONE')
      || status === state.selectedStatusFilter;
    return matchesStatus
      && matchesRecordSearch(record, search)
      && matchesDatePeriod(record, datePeriod)
      && matchesDatePeriod(record, updatedDatePeriod, 'updatedAt')
      && matchesExactDate(record, 'createdAt', registrationDate)
      && matchesExactDate(record, 'updatedAt', updatedDate);
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

function updateDateFilterCounts() {
  const search = $('recordsSearch').value;
  const datePeriod = $('datePeriodFilter').value;
  const updatedDatePeriod = $('updatedDatePeriod').value;
  const registrationDate = $('registrationDateFilter').value;
  const updatedDate = $('updatedDateFilter').value;
  const baseRecords = state.records.filter((record) => {
    const status = recordStatus(record);
    const matchesStatus = Boolean(search.trim())
      || state.selectedStatusFilter === 'ALL'
      || (state.selectedStatusFilter === 'NOT DONE' && status !== 'DONE')
      || status === state.selectedStatusFilter;
    return matchesStatus && matchesRecordSearch(record, search);
  });
  const registrationCount = baseRecords.filter((record) => (
    matchesDatePeriod(record, datePeriod)
    && matchesExactDate(record, 'createdAt', registrationDate)
  )).length;
  const updatedCount = baseRecords.filter((record) => (
    matchesDatePeriod(record, datePeriod)
    && matchesDatePeriod(record, updatedDatePeriod, 'updatedAt')
    && matchesExactDate(record, 'createdAt', registrationDate)
    && matchesExactDate(record, 'updatedAt', updatedDate)
  )).length;
  $('registrationDateFilterCount').textContent = String(registrationCount);
  $('updatedDateFilterCount').textContent = String(updatedCount);
  $('registrationDateFilterLabel').textContent = dateFilterLabel(datePeriod, registrationDate);
  $('updatedDateFilterLabel').textContent = dateFilterLabel(updatedDatePeriod, updatedDate);
  $('registrationSortLabel').textContent = $('registrationSort').value === 'OLDEST' ? 'Oldest first' : 'Newest first';
  $('openRegistrationDateFilter').classList.toggle('is-filtered', datePeriod !== 'ALL' || Boolean(registrationDate));
  $('openUpdatedDateFilter').classList.toggle('is-filtered', updatedDatePeriod !== 'ALL' || Boolean(updatedDate));
  $('openRegistrationSort').classList.toggle('is-filtered', $('registrationSort').value !== 'NEWEST');
}

function dateFilterLabel(period, exactDate) {
  if (exactDate) {
    try {
      return `${convertDateValue(exactDate, 'ad')} BS`;
    } catch (error) {
      console.error('Could not display a selected filter date in Nepali calendar format:', error);
      return exactDate;
    }
  }
  return ({
    ALL: 'Any date',
    TODAY: 'Today',
    YESTERDAY: 'Yesterday',
    THIS_WEEK: 'This week',
    THIS_MONTH: 'This month',
    THIS_YEAR: 'This year',
  })[period] || 'Any date';
}

const nepaliCalendarMonths = [
  'Baishakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin',
  'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra',
];

function renderNepaliCalendar() {
  const calendar = $('nepaliCalendar');
  const year = Number(calendar.dataset.year);
  const month = Number(calendar.dataset.month);
  const selectedDate = $('dateFilterBsInput').value.trim();
  $('nepaliCalendarMonth').textContent = `${nepaliCalendarMonths[month - 1]} ${year} BS`;

  const monthDates = [];
  let firstWeekday = 0;
  for (let day = 1; day <= 32; day += 1) {
    const nepaliDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    let adDate;
    try {
      adDate = convertDateValue(nepaliDate, 'bs');
    } catch (error) {
      if (day === 1) throw error;
      break;
    }
    if (!adDate) {
      if (day === 1) throw new Error('Could not load this Nepali calendar month.');
      break;
    }
    const [adYear, adMonth, adDay] = adDate.split('-').map(Number);
    if (day === 1) firstWeekday = new Date(adYear, adMonth - 1, adDay).getDay();
    monthDates.push(nepaliDate);
  }

  $('nepaliCalendarDays').innerHTML = [
    ...Array.from({ length: firstWeekday }, () => '<span aria-hidden="true"></span>'),
    ...monthDates.map((date) => {
      const day = Number(date.slice(-2));
      const isSelected = date === selectedDate;
      return `<button type="button" class="${isSelected ? 'selected' : ''}" data-nepali-date="${date}" aria-pressed="${isSelected}">${day}</button>`;
    }),
  ].join('');
}

function shiftNepaliCalendarMonth(offset) {
  const calendar = $('nepaliCalendar');
  let year = Number(calendar.dataset.year);
  let month = Number(calendar.dataset.month) + offset;
  if (month < 1) {
    year -= 1;
    month = 12;
  } else if (month > 12) {
    year += 1;
    month = 1;
  }
  calendar.dataset.year = String(year);
  calendar.dataset.month = String(month);
  try {
    renderNepaliCalendar();
  } catch (error) {
    showToast(error.message, true);
  }
}

function openDateFilterDialog(filterType) {
  const isSort = filterType === 'sort';
  if (isSort) {
    $('dateFilterDialog').dataset.filterType = filterType;
    $('dateFilterDialogTitle').textContent = 'Sort by registered date';
    $('dateFilterDateInputs').classList.add('hidden');
    $('dateFilterOptionHeading').textContent = 'Choose sorting order';
    $('dateFilterPeriodOptions').innerHTML = [
      { value: 'NEWEST', label: 'Newest first' },
      { value: 'OLDEST', label: 'Oldest first' },
    ].map((option) => `
      <button class="date-filter-period-option${$('registrationSort').value === option.value ? ' active' : ''}" type="button" data-date-period="${option.value}" aria-pressed="${$('registrationSort').value === option.value}">
        ${option.label}
      </button>
    `).join('');
    $('dateFilterDialog').showModal();
    return;
  }
  const isRegistration = filterType === 'registration';
  const periodSelect = $(isRegistration ? 'datePeriodFilter' : 'updatedDatePeriod');
  const dateInput = $(isRegistration ? 'registrationDateFilter' : 'updatedDateFilter');
  const title = isRegistration ? 'Registration date' : 'Update date';
  $('dateFilterDialog').dataset.filterType = filterType;
  $('dateFilterDialogTitle').textContent = title;
  $('dateFilterDateInputs').classList.remove('hidden');
  $('dateFilterBsLabel').textContent = `Choose or type a ${title.toLocaleLowerCase()} (BS); press Enter to apply`;
  try {
    $('dateFilterBsInput').value = dateInput.value ? convertDateValue(dateInput.value, 'ad') : '';
    if (!$('dateFilterBsInput').value) {
      const today = new Date();
      $('dateFilterBsInput').value = convertDateValue(
        `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
        'ad',
      );
    }
    const [calendarYear, calendarMonth] = $('dateFilterBsInput').value.split('-').map(Number);
    $('nepaliCalendar').dataset.year = String(calendarYear);
    $('nepaliCalendar').dataset.month = String(calendarMonth);
    $('nepaliCalendar').classList.remove('hidden');
    $('toggleNepaliCalendar').setAttribute('aria-expanded', 'true');
    renderNepaliCalendar();
  } catch (error) {
    $('dateFilterBsInput').value = '';
    showToast(error.message, true);
  }
  $('dateFilterOptionHeading').textContent = 'Or choose a date range';
  const periods = [
    { value: 'ALL', label: 'Any date' },
    { value: 'TODAY', label: 'Today' },
    { value: 'YESTERDAY', label: 'Yesterday' },
    { value: 'THIS_WEEK', label: 'This week' },
    { value: 'THIS_MONTH', label: 'This month' },
    { value: 'THIS_YEAR', label: 'This year' },
  ];
  $('dateFilterPeriodOptions').innerHTML = periods.map((period) => `
    <button class="date-filter-period-option${periodSelect.value === period.value && !dateInput.value ? ' active' : ''}" type="button" data-date-period="${period.value}" aria-pressed="${periodSelect.value === period.value && !dateInput.value}">
      ${period.label}
    </button>
  `).join('');
  $('dateFilterDialog').showModal();
}

function applyDateFilterPeriod(period) {
  if ($('dateFilterDialog').dataset.filterType === 'sort') {
    $('registrationSort').value = period;
    $('dateFilterDialog').close();
    renderRecords();
    return;
  }
  const isRegistration = $('dateFilterDialog').dataset.filterType === 'registration';
  const periodSelect = $(isRegistration ? 'datePeriodFilter' : 'updatedDatePeriod');
  const dateInput = $(isRegistration ? 'registrationDateFilter' : 'updatedDateFilter');
  periodSelect.value = period;
  dateInput.value = '';
  $('dateFilterDialog').close();
  renderRecords();
}

function applyExactDateFilter(dateValue) {
  if (!dateValue) return;
  const isRegistration = $('dateFilterDialog').dataset.filterType === 'registration';
  const periodSelect = $(isRegistration ? 'datePeriodFilter' : 'updatedDatePeriod');
  const dateInput = $(isRegistration ? 'registrationDateFilter' : 'updatedDateFilter');
  periodSelect.value = 'ALL';
  dateInput.value = dateValue;
  $('dateFilterDialog').close();
  renderRecords();
}

function applyBsDateFilter(dateValue) {
  try {
    const adDate = convertDateValue(dateValue.trim(), 'bs');
    if (!adDate) throw new Error('Enter a valid Nepali date as YYYY-MM-DD.');
    applyExactDateFilter(adDate);
  } catch (error) {
    showToast(error.message, true);
  }
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

function renderIndividualCheckResults() {
  const results = state.individualCheckResults;
  const completedCount = results.filter((result) => !result.pending).length;
  const activeCount = results.length - completedCount;
  const unavailableResults = results.filter((result) => (
    !result.pending && isExactNidServerUnavailableResponse(result)
  ));
  $('statusCheckResponseTitle').textContent = activeCount
    ? `${completedCount} complete · ${activeCount} still running`
    : `${results.length} status check${results.length === 1 ? '' : 's'} complete`;
  $('statusCheckRecordSummary').textContent = 'Status of every individual check in this group:';
  $('latestCheckResponseContent').innerHTML = results.map((result) => {
    if (result.pending) {
      return `
        <article class="individual-check-result individual-check-result-pending">
          <div class="individual-check-result-heading">
            <strong>${escapeHtml(result.record.fullName)}</strong>
            <span>CHECKING…</span>
          </div>
          <p class="individual-check-result-nin">NIN: ${escapeHtml(result.record.nin || '—')}</p>
          <p class="individual-check-result-message">Waiting for the voter portal response.</p>
          ${state.retryingIndividualChecks.has(result.record._id) ? `<button class="button primary tiny is-retrying" type="button" data-retry-check="${escapeHtml(result.record._id)}" disabled aria-busy="true">Retrying…</button>` : ''}
        </article>`;
    }
    const message = batchResponseMessage(result.response) || result.error || 'No response message returned.';
    const status = result.record ? recordStatus(result.record) : 'CHECK FAILED';
    return `
      <article class="individual-check-result response-tone-${batchResponseTone(result.response)}">
        <div class="individual-check-result-heading">
          <strong>${escapeHtml(result.record?.fullName || 'Unknown record')}</strong>
          <span>${escapeHtml(status)}</span>
        </div>
        <p class="individual-check-result-nin">NIN: ${escapeHtml(result.record?.nin || '—')}</p>
        <p class="individual-check-result-message">${escapeHtml(message)}</p>
        ${result.canRetry ? `<button class="button primary tiny${state.activeStatusChecks.has(result.record._id) ? ' is-retrying' : ''}" type="button" data-retry-check="${escapeHtml(result.record._id)}" ${state.activeStatusChecks.has(result.record._id) ? 'disabled aria-busy="true"' : ''}>${state.activeStatusChecks.has(result.record._id) ? 'Retrying…' : 'Try again'}</button>` : ''}
      </article>`;
  }).join('');
  const retryUnavailableButton = $('retryUnavailableChecksButton');
  const isRetryingUnavailable = unavailableResults.some((result) => (
    state.activeStatusChecks.has(result.record?._id)
  ));
  retryUnavailableButton.classList.toggle('hidden', unavailableResults.length === 0 && !state.retryingUnavailableChecks);
  retryUnavailableButton.classList.toggle('is-retrying', state.retryingUnavailableChecks || isRetryingUnavailable);
  retryUnavailableButton.disabled = state.retryingUnavailableChecks || unavailableResults.every((result) => (
    state.activeStatusChecks.has(result.record?._id)
  ));
  retryUnavailableButton.textContent = state.retryingUnavailableChecks || isRetryingUnavailable
    ? `Retrying NID/NIN server-unavailable checks…`
    : `Retry all NID/NIN server-unavailable checks (${unavailableResults.length})`;
  if (!$('statusCheckResponseDialog').open) $('statusCheckResponseDialog').showModal();
}

function isExactNidServerUnavailableResponse(result) {
  return /NI[DN] सर्भरबाट डेटा प्राप्त हुन सकेन। कृपया केही समयपछि पुनः प्रयास गर्नुहोस्।/u
      .test(batchResponseMessage(result.response));
}

function updateStatusCheckPromise() {
  const activePromises = [...state.activeStatusChecks.values()];
  state.statusCheckPromise = activePromises.length ? Promise.all(activePromises) : null;
}

function scheduleIndividualCheckResults() {
  if (state.refreshingRecords || !state.individualCheckResults.length) return;
  window.clearTimeout(state.individualCheckOpenTimer);
  state.individualCheckOpenTimer = window.setTimeout(() => {
    state.individualCheckOpenTimer = null;
    if (!state.refreshingRecords && !state.activeStatusChecks.size) renderIndividualCheckResults();
  }, 500);
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
  updateDateFilterCounts();
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
        <td data-record-column="notes">${escapeHtml(record.notes || '')}</td>
        <td class="row-actions" data-record-column="actions">
          <button class="button primary tiny check-record-action${state.activeStatusChecks.has(record._id) ? ' is-checking' : ''}${state.individualCheckResults.some((item) => item.record?._id === record._id && !item.pending) ? ' is-checked' : ''}" type="button" data-check="${escapeHtml(record._id)}" aria-label="${state.activeStatusChecks.has(record._id) ? 'View running check for' : state.individualCheckResults.some((item) => item.record?._id === record._id && !item.pending) ? 'Show status check results for' : 'Check status for'} ${escapeHtml(record.fullName)}" title="${state.activeStatusChecks.has(record._id) ? 'Show running checks' : state.individualCheckResults.some((item) => item.record?._id === record._id && !item.pending) ? 'Show check results' : 'Check status'}" ${state.activeStatusChecks.has(record._id) ? 'aria-busy="true"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${state.individualCheckResults.some((item) => item.record?._id === record._id && !item.pending) ? '<path d="m5 12 4 4L19 6"/>' : '<path d="M20 7v5h-5M4.9 9a7 7 0 0 1 12-2L20 12M4 17v-5h5m10.1 3a7 7 0 0 1-12 2L4 12"/>'}</svg><span>${state.activeStatusChecks.has(record._id) ? 'Checking…' : state.individualCheckResults.some((item) => item.record?._id === record._id && !item.pending) ? 'Checked' : 'Check'}</span></button>
          <button class="button subtle tiny print-record-action" type="button" data-print="${escapeHtml(record._id)}" aria-label="Print A4 sheet for ${escapeHtml(record.fullName)}" title="Print A4"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v7H7z"/><path d="M17 11h.01"/></svg><span>Print</span></button>
          <button class="button tiny delete-record-action${state.workspaceSettings.hideRecordDeleteButton ? ' hidden' : ''}" type="button" data-delete="${escapeHtml(record._id)}" aria-label="Delete ${escapeHtml(record.fullName)}" title="Delete record">Delete</button>
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
  recordsBody.querySelectorAll('[data-delete]').forEach((button) => {
    button.addEventListener('click', () => {
      const record = state.records.find((item) => item._id === button.dataset.delete);
      if (record) openRecordDeleteDialog(record);
    });
  });
}

function openRecordDeleteDialog(record) {
  $('deleteRecordTitle').textContent = `Delete ${record.fullName}?`;
  $('deleteRecordDescription').textContent = 'This permanently deletes the voter record and its associated history. Enter the admin password to continue.';
  $('deleteRecordDialog').dataset.recordId = record._id;
  $('deleteRecordPassword').value = '';
  $('deleteRecordMessage').textContent = '';
  $('deleteRecordDialog').showModal();
  $('deleteRecordPassword').focus();
}

async function handleDeleteRecord(event) {
  event.preventDefault();
  const dialog = $('deleteRecordDialog');
  const button = $('confirmDeleteRecordButton');
  const message = $('deleteRecordMessage');
  message.textContent = '';
  button.disabled = true;
  try {
    const { recordIds } = await apiRequest('/api/records', {
      method: 'DELETE',
      body: JSON.stringify({
        recordId: dialog.dataset.recordId,
        password: $('deleteRecordPassword').value,
      }),
    });
    const deletedIds = new Set(recordIds);
    state.records = state.records.filter((record) => !deletedIds.has(record._id));
    state.recordsLoaded = true;
    cacheRecordsOrNotify();
    renderRecords();
    if ($('registrationAnalyticsDialog').open) renderRegistrationAnalytics();
    dialog.close();
    showToast('Voter record and its history deleted.');
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
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
    loadCachedRecords();
    await loadRecords({ force: true });
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

const RETRY_DELAY_MS = 500;

function isRetryableStatusCheckError(error) {
  return error.status === undefined || error.status >= 500;
}

function isVoterServerUnavailableResponse(result) {
  return result.retryable === true
    || /NI[DN] सर्भरबाट डेटा प्राप्त हुन सकेन/i.test(batchResponseMessage(result.response));
}

async function checkStatusWithRetries(
  details,
  onRetry = () => {},
  shouldStop = () => false,
  maxRetries = state.workspaceSettings.automaticStatusRetries,
) {
  let lastResult;
  let lastRetryReason = 'request failed';
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const result = await checkStatus(details);
      lastResult = result;
      const hasResponseMessage = Boolean(batchResponseMessage(result.response));
      const unavailableResponse = isVoterServerUnavailableResponse(result);
      if (shouldStop()) {
        return { ...result, cancelled: true, noResponse: !hasResponseMessage || unavailableResponse };
      }
      const shouldRetry = unavailableResponse || !hasResponseMessage;
      if (!shouldRetry || attempt === maxRetries) {
        return { ...result, noResponse: !hasResponseMessage || unavailableResponse };
      }
      lastRetryReason = 'no response';
    } catch (error) {
      if (shouldStop()) {
        const stoppedError = new Error('Status check stopped for refresh.');
        stoppedError.code = 'STATUS_CHECK_STOPPED';
        throw stoppedError;
      }
      if (!isRetryableStatusCheckError(error) || attempt === maxRetries) {
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

function checkRecordStatus(record, button) {
  if (state.checkingAll) {
    showToast('Wait for Check All to finish before checking an individual record.', true);
    return Promise.resolve();
  }
  if (state.refreshingRecords) return Promise.resolve();
  const activeCheck = state.activeStatusChecks.get(record._id);
  if (activeCheck) {
    renderIndividualCheckResults();
    return activeCheck;
  }
  const existingResult = state.individualCheckResults.find((item) => item.record?._id === record._id);
  if (existingResult && !existingResult.pending) {
    renderIndividualCheckResults();
    return Promise.resolve(existingResult);
  }

  if (!state.activeStatusChecks.size) {
    if (!state.individualCheckOpenTimer && !$('statusCheckResponseDialog').open) {
      state.individualCheckResults = [];
    }
    state.stopStatusCheckRequested = false;
  }
  window.clearTimeout(state.individualCheckOpenTimer);
  state.individualCheckOpenTimer = null;
  state.individualCheckResults = state.individualCheckResults
    .filter((item) => item.record?._id !== record._id);
  state.individualCheckResults.push({ record, pending: true });
  if ($('statusCheckResponseDialog').open) renderIndividualCheckResults();

  let trackedPromise;
  trackedPromise = runRecordStatusCheck(record, button)
    .then((result) => {
      if (result && !result.cancelled && !state.refreshingRecords) {
        state.individualCheckResults = state.individualCheckResults
          .filter((item) => item.record?._id !== record._id);
        state.individualCheckResults.push(result);
      } else {
        state.individualCheckResults = state.individualCheckResults
          .filter((item) => item.record?._id !== record._id);
      }
      if ($('statusCheckResponseDialog').open && !state.refreshingRecords) {
        renderIndividualCheckResults();
      }
      return result;
    })
    .finally(() => {
      if (state.activeStatusChecks.get(record._id) === trackedPromise) {
        state.activeStatusChecks.delete(record._id);
        updateStatusCheckPromise();
      }
      if ($('statusCheckResponseDialog').open && !state.refreshingRecords) {
        renderIndividualCheckResults();
      }
      if (!state.refreshingRecords) renderRecords();
      if (!state.activeStatusChecks.size) scheduleIndividualCheckResults();
    });
  state.activeStatusChecks.set(record._id, trackedPromise);
  updateStatusCheckPromise();
  if ($('statusCheckResponseDialog').open) renderIndividualCheckResults();
  renderRecords();
  return trackedPromise;
}

async function runRecordStatusCheck(record, button) {
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
      showToast(`${retryMessage}. Retrying (${retryNumber}/${state.workspaceSettings.automaticStatusRetries})…`);
    }, () => state.stopStatusCheckRequested);
    if (result.cancelled || state.stopStatusCheckRequested) return { cancelled: true };
    const updatedRecord = {
      ...result.record,
      createdAt: record.createdAt,
      statusCheckCount: result.requestCount ?? (record.statusCheckCount || 0) + 1,
      uniqueSearchResponses: cacheableSearchResponses(result.responses || []),
    };
    state.records = state.records.map((item) => item._id === updatedRecord._id ? updatedRecord : item);
    state.recordsLoaded = true;
    cacheRecordsOrNotify();
    if ($('recordDetailsDialog').open
      && $('recordDetailsDialog').dataset.recordId === updatedRecord._id) {
      $('recordResponsesContent').innerHTML = renderUniqueResponses(updatedRecord.uniqueSearchResponses);
    }
    renderRecords();
    return {
      record: updatedRecord,
      response: result.response,
      error: '',
      canRetry: result.noResponse || result.retryable || isVoterServerUnavailableResponse(result),
    };
  } catch (error) {
    if (state.stopStatusCheckRequested || error.code === 'STATUS_CHECK_STOPPED') return { cancelled: true };
    showToast(error.message, true);
    return {
      record,
      response: error.response,
      error: error.message,
      canRetry: isRetryableStatusCheckError(error),
    };
  } finally {
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
  const hiddenResponseTones = new Set(['not-found', 'portrait', 'approved']);
  return [
    { key: ALL_BATCH_GROUP_KEY, response: null, records: state.batchResults },
    ...batchResponseGroups().filter((group) => (
      !hiddenResponseTones.has(batchResponseTone(group.response))
    )),
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

function updateCheckAllDialog(records = visiblePendingRecords(), title = 'Check unfinished records') {
  state.activeBatchResponseKey = ALL_BATCH_GROUP_KEY;
  state.batchResults = records.map((record) => ({
    record,
    response: { message: 'Waiting to be checked.' },
    error: '',
  }));
  $('checkAllTitle').classList.toggle('hidden', records.length === 0);
  $('checkAllTitle').textContent = title;
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
  const concurrency = Math.min(state.workspaceSettings.checkAllConcurrency, records.length);
  let checked = 0;
  let failed = 0;
  let nextRecordIndex = 0;
  let running = 0;
  const updateBatchProgress = () => {
    const completed = checked + failed;
    $('checkAllProgress').value = completed;
    $('checkAllProgressText').textContent = `Checked ${completed} of ${records.length} · ${running} in progress (${concurrency} at once)…`;
  };
  const checkNextRecord = async () => {
    while (!state.stopBatchRequested) {
      const recordIndex = nextRecordIndex;
      nextRecordIndex += 1;
      if (recordIndex >= records.length) return;
      const record = records[recordIndex];
      const resultEntry = state.batchResults.find((item) => item.record._id === record._id);
      if (resultEntry) {
        resultEntry.response = { message: 'Waiting for voterlist server response…' };
        resultEntry.error = '';
      }
      running += 1;
      updateBatchProgress();
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
              retry: `${retryNumber}/${state.workspaceSettings.automaticStatusRetries}`,
            };
            $('checkAllProgressText').textContent = `Retrying ${record.fullName} (${retryNumber}/${state.workspaceSettings.automaticStatusRetries})…`;
            renderBatchResults();
          }
        }, () => state.stopBatchRequested);
        if (result.cancelled) {
          if (resultEntry) {
            resultEntry.response = result.response ?? { message: 'Check stopped before completion.' };
            resultEntry.error = resultEntry.response.message || '';
          }
          if (result.response) checked += 1;
        } else {
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
        }
      } catch (error) {
        if (state.stopBatchRequested && error.code === 'STATUS_CHECK_STOPPED') {
          if (resultEntry) {
            resultEntry.response = { message: 'Check stopped before completion.' };
            resultEntry.error = '';
          }
        } else {
          failed += 1;
          console.error(`Could not check status for record ${record._id}:`, error);
          if (resultEntry) {
            resultEntry.response = { error: error.message };
            resultEntry.error = error.message;
          }
        }
      } finally {
        running -= 1;
        updateBatchProgress();
        renderRecords();
        renderBatchResults();
      }
    }
  };
  await Promise.all(Array.from(
    { length: concurrency },
    () => checkNextRecord(),
  ));
  const remaining = records.length - checked - failed;

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
  renderBatchResults();
  if (remaining) {
    $('checkAllProgressText').textContent = `Stopped: ${checked} checked, ${failed} failed, ${remaining} remaining.`;
    if (!state.refreshingRecords) showToast(`Check all stopped: ${checked} checked, ${remaining} remaining.`);
  } else {
    showToast(`Check all complete: ${checked} checked, ${failed} failed.`, failed > 0);
  }
  if (!state.refreshingRecords && !$('checkAllDialog').open) {
    $('checkAllDialog').showModal();
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
  const rows = [...$('multiplePrintRecords').querySelectorAll('[data-print-select]')];
  const selectedCount = rows.filter((row) => row.getAttribute('aria-pressed') === 'true').length;
  $('selectedPrintCount').textContent = `${selectedCount} selected`;
  $('printSelectedRecordsButton').disabled = selectedCount === 0;
  const visible = rows.filter((row) => !row.hidden);
  const allVisibleSelected = visible.length > 0
    && visible.every((row) => row.getAttribute('aria-pressed') === 'true');
  $('selectAllPrintRecords').setAttribute('aria-pressed', String(allVisibleSelected));
}

const BULK_DATE_PERIODS = [
  { value: 'ALL', label: 'All' },
  { value: 'TODAY', label: 'Today' },
  { value: 'YESTERDAY', label: 'Yesterday' },
  { value: 'THIS_WEEK', label: 'This week' },
  { value: 'THIS_MONTH', label: 'This month' },
  { value: 'THIS_YEAR', label: 'This year' },
];

function renderBulkDateFilters(container, records, activePeriod) {
  container.innerHTML = BULK_DATE_PERIODS.map((period) => {
    const count = records.filter((record) => matchesDatePeriod(record, period.value)).length;
    return `
      <button class="bulk-date-filter${activePeriod === period.value ? ' active' : ''}" type="button" data-bulk-period="${period.value}" aria-pressed="${activePeriod === period.value}">
        ${period.label}<strong>${count}</strong>
      </button>
    `;
  }).join('');
}

function filterBulkRecords(container, query, period = 'ALL') {
  const recordsById = new Map(state.records.map((record) => [record._id, record]));
  container.querySelectorAll('.multiple-print-row').forEach((row) => {
    const record = recordsById.get(row.dataset.recordId);
    row.hidden = !record
      || !matchesRecordSearch(record, query)
      || !matchesDatePeriod(record, period);
  });
}

function renderBulkRecordOptions(container, records, attribute) {
  container.innerHTML = records.length
    ? records.map((record) => `
      <button class="multiple-print-row" type="button" data-record-id="${escapeHtml(record._id)}" ${attribute}="${escapeHtml(record._id)}" aria-pressed="false">
        <span><strong>${escapeHtml(record.fullName)}</strong><small>${escapeHtml(record.nin)} · ${escapeHtml(record.mobile)} · ${escapeHtml(formatBsDate(record.createdAt))} BS</small></span>
      </button>
    `).join('')
    : '<p class="multiple-print-empty">No records are available.</p>';
}

function openMultiplePrintDialog() {
  const container = $('multiplePrintRecords');
  renderBulkRecordOptions(container, state.records, 'data-print-select');
  $('multiplePrintSearch').value = '';
  $('multiplePrintDialog').dataset.datePeriod = 'ALL';
  renderBulkDateFilters($('multiplePrintDateFilters'), state.records, 'ALL');
  filterBulkRecords(container, '', 'ALL');
  $('selectAllPrintRecords').setAttribute('aria-pressed', 'false');
  updateMultiplePrintSelection();
  $('multiplePrintDialog').showModal();
}

function updateMultipleDeleteSelection() {
  const rows = [...$('multipleDeleteRecords').querySelectorAll('[data-delete-select]')];
  const selectedCount = rows.filter((row) => row.getAttribute('aria-pressed') === 'true').length;
  const visible = rows.filter((row) => !row.hidden);
  const allVisibleSelected = visible.length > 0
    && visible.every((row) => row.getAttribute('aria-pressed') === 'true');
  $('selectedDeleteCount').textContent = `${selectedCount} selected`;
  $('selectAllDeleteRecords').setAttribute('aria-pressed', String(allVisibleSelected));
  $('confirmMultipleDeleteButton').disabled = selectedCount === 0;
}

function openMultipleDeleteDialog() {
  renderBulkRecordOptions($('multipleDeleteRecords'), state.records, 'data-delete-select');
  $('multipleDeleteSearch').value = '';
  $('multipleDeleteDialog').dataset.datePeriod = 'ALL';
  renderBulkDateFilters($('multipleDeleteDateFilters'), state.records, 'ALL');
  filterBulkRecords($('multipleDeleteRecords'), '', 'ALL');
  $('selectAllDeleteRecords').setAttribute('aria-pressed', 'false');
  updateMultipleDeleteSelection();
  $('multipleDeleteDialog').showModal();
}

async function deleteSelectedRecords(event) {
  event.preventDefault();
  const recordIds = [...$('multipleDeleteRecords').querySelectorAll('[data-delete-select][aria-pressed="true"]')]
    .map((row) => row.dataset.deleteSelect);
  const button = $('submitMultipleDeletePasswordButton');
  const message = $('multipleDeleteMessage');
  if (!recordIds.length) return;
  button.disabled = true;
  message.textContent = '';
  try {
    const result = await apiRequest('/api/records', {
      method: 'DELETE',
      body: JSON.stringify({
        recordIds,
        password: $('multipleDeletePassword').value,
      }),
    });
    const deletedIds = new Set(result.recordIds);
    state.records = state.records.filter((record) => !deletedIds.has(record._id));
    state.recordsLoaded = true;
    cacheRecordsOrNotify();
    renderRecords();
    $('multipleDeletePasswordDialog').close();
    $('multipleDeleteDialog').close();
    showToast(`${result.recordIds.length} voter record${result.recordIds.length === 1 ? '' : 's'} and associated histor${result.recordIds.length === 1 ? 'y' : 'ies'} deleted.`);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
    updateMultipleDeleteSelection();
  }
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
  renderRecordColumnSettings();
  loadCachedWorkspaceSettings();
  const scrollTableRowsFromPageWhitespace = (event) => {
    if (!event.deltaY || !document.querySelector('.content').classList.contains('records-view')) return;
    if (event.target.closest('dialog[open], .table-scroll')) return;
    event.preventDefault();
    const tableScroll = document.querySelector('.table-scroll');
    const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? event.deltaY * 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? event.deltaY * tableScroll.clientHeight
        : event.deltaY;
    tableScroll.scrollTop += delta;
  };
  document.addEventListener('wheel', scrollTableRowsFromPageWhitespace, { capture: true, passive: false });
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
    renderSettingsAccess();
    $('settingsDialog').showModal();
  });
  $('openPasswordDialogButton').addEventListener('click', () => {
    $('passwordMessage').textContent = '';
    $('passwordDialog').showModal();
  });
  $('openWorkspaceSettingsButton').addEventListener('click', () => {
    $('hideEntryTab').checked = state.workspaceSettings.hideEntryTab;
    $('hideOldEntryTab').checked = state.workspaceSettings.hideOldEntryTab;
    $('hideDatabaseTab').checked = state.workspaceSettings.hideDatabaseTab;
    $('hidePrintMultipleButton').checked = state.workspaceSettings.hidePrintMultipleButton;
    $('hideDeleteMultipleButton').checked = state.workspaceSettings.hideDeleteMultipleButton;
    $('hideRecordDeleteButton').checked = state.workspaceSettings.hideRecordDeleteButton;
    $('workspaceSettingsDialog').showModal();
  });
  $('openRetrySettingsButton').addEventListener('click', () => {
    $('automaticStatusRetries').value = String(state.workspaceSettings.automaticStatusRetries);
    $('retrySettingsMessage').textContent = '';
    $('retrySettingsDialog').showModal();
  });
  $('openCheckAllConcurrencyButton').addEventListener('click', () => {
    $('checkAllConcurrency').value = String(state.workspaceSettings.checkAllConcurrency);
    $('checkAllConcurrencyMessage').textContent = '';
    $('checkAllConcurrencyDialog').showModal();
  });
  $('workspacePasswordForm').addEventListener('submit', verifyWorkspaceAdminPassword);
  $('settingsSignOutButton').addEventListener('click', () => void signOutFromSettings());
  $('recordColumnsOptions').addEventListener('click', saveColumnSettings);
  $('workspaceSettingsForm').addEventListener('submit', saveWorkspaceSettings);
  $('retrySettingsForm').addEventListener('submit', saveRetrySettings);
  $('checkAllConcurrencyForm').addEventListener('submit', saveCheckAllConcurrency);
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
  const closeSettingsSession = () => {
    document.querySelectorAll('.settings-flow-dialog[open]').forEach((dialog) => dialog.close());
    state.settingsUnlocked = false;
    renderSettingsAccess();
  };
  $('cancelSettingsButton').addEventListener('click', closeSettingsSession);
  $('cancelPasswordButton').addEventListener('click', () => $('passwordDialog').close());
  $('cancelWorkspaceSettingsButton').addEventListener('click', () => $('workspaceSettingsDialog').close());
  $('cancelRetrySettingsButton').addEventListener('click', () => $('retrySettingsDialog').close());
  $('cancelCheckAllConcurrencyButton').addEventListener('click', () => $('checkAllConcurrencyDialog').close());
  document.querySelectorAll('[data-settings-back]').forEach((button) => {
    button.addEventListener('click', () => {
      const dialog = button.closest('dialog');
      if (!dialog) return;
      if (dialog.id === 'settingsDialog') {
        closeSettingsSession();
        return;
      }
      dialog.close();
      if (state.settingsUnlocked && !$('settingsDialog').open) $('settingsDialog').showModal();
    });
  });
  $('closeRegistrationAnalyticsButton').addEventListener('click', () => $('registrationAnalyticsDialog').close());
  $('registrationAnalyticsDialog').addEventListener('click', (event) => {
    if (event.target === $('registrationAnalyticsDialog')) $('registrationAnalyticsDialog').close();
  });
  $('closeRecordDetailsButton').addEventListener('click', () => $('recordDetailsDialog').close());
  $('closeStatusCheckResponseButton').addEventListener('click', () => $('statusCheckResponseDialog').close());
  $('latestCheckResponseContent').addEventListener('click', (event) => {
    const retryButton = event.target.closest('[data-retry-check]');
    if (!retryButton) return;
    const record = state.records.find((item) => item._id === retryButton.dataset.retryCheck);
    if (!record) return;
    state.retryingIndividualChecks.add(record._id);
    window.clearTimeout(state.individualCheckOpenTimer);
    state.individualCheckOpenTimer = null;
    state.individualCheckResults = state.individualCheckResults
      .filter((item) => item.record?._id !== record._id);
    void checkRecordStatus(record, null).finally(() => {
      state.retryingIndividualChecks.delete(record._id);
      if ($('statusCheckResponseDialog').open) renderIndividualCheckResults();
    });
  });
  $('retryUnavailableChecksButton').addEventListener('click', async () => {
    const recordIds = state.individualCheckResults
      .filter((result) => !result.pending && isExactNidServerUnavailableResponse(result))
      .map((result) => result.record?._id)
      .filter((recordId) => recordId && !state.activeStatusChecks.has(recordId));
    const retries = recordIds
      .map((recordId) => state.records.find((item) => item._id === recordId))
      .filter(Boolean);
    if (!retries.length) return;
    state.retryingUnavailableChecks = true;
    for (const record of retries) state.retryingIndividualChecks.add(record._id);
    const retryRecordIds = new Set(retries.map((record) => record._id));
    state.individualCheckResults = state.individualCheckResults
      .filter((result) => !retryRecordIds.has(result.record?._id));
    renderIndividualCheckResults();
    try {
      await Promise.all(retries.map((record) => checkRecordStatus(record, null)));
    } finally {
      state.retryingUnavailableChecks = false;
      for (const record of retries) state.retryingIndividualChecks.delete(record._id);
      if ($('statusCheckResponseDialog').open) renderIndividualCheckResults();
    }
  });
  $('statusCheckResponseDialog').addEventListener('click', (event) => {
    if (event.target === $('statusCheckResponseDialog')) $('statusCheckResponseDialog').close();
  });
  $('statusCheckResponseDialog').addEventListener('close', () => {
    if (state.activeStatusChecks.size) return;
    window.clearTimeout(state.individualCheckOpenTimer);
    state.individualCheckOpenTimer = null;
    state.individualCheckResults = [];
    renderRecords();
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
  $('settingsDialog').addEventListener('close', () => {
    state.settingsUnlocked = false;
    renderSettingsAccess();
  });
  $('passwordDialog').addEventListener('click', (event) => {
    if (event.target === $('passwordDialog')) $('passwordDialog').close();
  });
  $('workspaceSettingsDialog').addEventListener('click', (event) => {
    if (event.target === $('workspaceSettingsDialog')) $('workspaceSettingsDialog').close();
  });
  $('retrySettingsDialog').addEventListener('click', (event) => {
    if (event.target === $('retrySettingsDialog')) $('retrySettingsDialog').close();
  });
  $('recordsSearch').addEventListener('input', renderRecords);
  $('deleteRecordForm').addEventListener('submit', handleDeleteRecord);
  $('cancelDeleteRecordButton').addEventListener('click', () => $('deleteRecordDialog').close());
  $('deleteRecordDialog').addEventListener('close', () => {
    $('deleteRecordForm').reset();
    $('deleteRecordMessage').textContent = '';
    delete $('deleteRecordDialog').dataset.recordId;
  });
  $('deleteRecordDialog').addEventListener('click', (event) => {
    if (event.target === $('deleteRecordDialog')) $('deleteRecordDialog').close();
  });
  $('backupRecordsButton').addEventListener('click', () => void backupRecords());
  $('printMultipleButton').addEventListener('click', () => {
    animateToolbarAction($('printMultipleButton'));
    openMultiplePrintDialog();
  });
  $('multiplePrintSearch').addEventListener('input', (event) => {
    filterBulkRecords(
      $('multiplePrintRecords'),
      event.currentTarget.value,
      $('multiplePrintDialog').dataset.datePeriod || 'ALL',
    );
    updateMultiplePrintSelection();
  });
  $('multiplePrintSearchButton').addEventListener('click', () => {
    filterBulkRecords(
      $('multiplePrintRecords'),
      $('multiplePrintSearch').value,
      $('multiplePrintDialog').dataset.datePeriod || 'ALL',
    );
    updateMultiplePrintSelection();
  });
  $('multiplePrintDateFilters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-bulk-period]');
    if (!button) return;
    $('multiplePrintDialog').dataset.datePeriod = button.dataset.bulkPeriod;
    renderBulkDateFilters($('multiplePrintDateFilters'), state.records, button.dataset.bulkPeriod);
    filterBulkRecords($('multiplePrintRecords'), $('multiplePrintSearch').value, button.dataset.bulkPeriod);
    updateMultiplePrintSelection();
  });
  $('selectAllPrintRecords').addEventListener('click', (event) => {
    const shouldSelect = event.currentTarget.getAttribute('aria-pressed') !== 'true';
    $('multiplePrintRecords').querySelectorAll('[data-print-select]').forEach((row) => {
      if (!row.hidden) row.setAttribute('aria-pressed', String(shouldSelect));
    });
    updateMultiplePrintSelection();
  });
  $('multiplePrintRecords').addEventListener('click', (event) => {
    const row = event.target.closest('[data-print-select]');
    if (!row) return;
    row.setAttribute('aria-pressed', String(row.getAttribute('aria-pressed') !== 'true'));
    updateMultiplePrintSelection();
  });
  $('printSelectedRecordsButton').addEventListener('click', () => {
    const selectedIds = new Set([...$('multiplePrintRecords').querySelectorAll('[data-print-select][aria-pressed="true"]')]
      .map((row) => row.dataset.printSelect));
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
  $('deleteMultipleButton').addEventListener('click', openMultipleDeleteDialog);
  $('multipleDeleteSearch').addEventListener('input', (event) => {
    filterBulkRecords(
      $('multipleDeleteRecords'),
      event.currentTarget.value,
      $('multipleDeleteDialog').dataset.datePeriod || 'ALL',
    );
    updateMultipleDeleteSelection();
  });
  $('multipleDeleteSearchButton').addEventListener('click', () => {
    filterBulkRecords(
      $('multipleDeleteRecords'),
      $('multipleDeleteSearch').value,
      $('multipleDeleteDialog').dataset.datePeriod || 'ALL',
    );
    updateMultipleDeleteSelection();
  });
  $('multipleDeleteDateFilters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-bulk-period]');
    if (!button) return;
    $('multipleDeleteDialog').dataset.datePeriod = button.dataset.bulkPeriod;
    renderBulkDateFilters($('multipleDeleteDateFilters'), state.records, button.dataset.bulkPeriod);
    filterBulkRecords($('multipleDeleteRecords'), $('multipleDeleteSearch').value, button.dataset.bulkPeriod);
    updateMultipleDeleteSelection();
  });
  $('multipleDeleteRecords').addEventListener('click', (event) => {
    const row = event.target.closest('[data-delete-select]');
    if (!row) return;
    row.setAttribute('aria-pressed', String(row.getAttribute('aria-pressed') !== 'true'));
    updateMultipleDeleteSelection();
  });
  $('selectAllDeleteRecords').addEventListener('click', (event) => {
    const shouldSelect = event.currentTarget.getAttribute('aria-pressed') !== 'true';
    $('multipleDeleteRecords').querySelectorAll('[data-delete-select]').forEach((row) => {
      if (!row.hidden) row.setAttribute('aria-pressed', String(shouldSelect));
    });
    updateMultipleDeleteSelection();
  });
  $('confirmMultipleDeleteButton').addEventListener('click', () => {
    if (!$('multipleDeleteRecords').querySelector('[data-delete-select][aria-pressed="true"]')) return;
    $('multipleDeletePasswordForm').reset();
    $('multipleDeleteMessage').textContent = '';
    $('multipleDeletePasswordDialog').showModal();
    $('multipleDeletePassword').focus();
  });
  $('multipleDeletePasswordForm').addEventListener('submit', (event) => void deleteSelectedRecords(event));
  $('cancelMultipleDeletePasswordButton').addEventListener('click', () => $('multipleDeletePasswordDialog').close());
  $('multipleDeletePasswordDialog').addEventListener('close', () => {
    $('multipleDeletePasswordForm').reset();
    $('multipleDeleteMessage').textContent = '';
  });
  $('cancelMultipleDeleteButton').addEventListener('click', () => $('multipleDeleteDialog').close());
  $('multipleDeleteDialog').addEventListener('close', () => {
    if ($('multipleDeletePasswordDialog').open) $('multipleDeletePasswordDialog').close();
  });
  $('multipleDeleteDialog').addEventListener('click', (event) => {
    if (event.target === $('multipleDeleteDialog')) $('multipleDeleteDialog').close();
  });
  document.querySelectorAll('[data-date-filter]').forEach((button) => {
    button.addEventListener('click', () => openDateFilterDialog(button.dataset.dateFilter));
  });
  $('dateFilterPeriodOptions').addEventListener('click', (event) => {
    const button = event.target.closest('[data-date-period]');
    if (button) applyDateFilterPeriod(button.dataset.datePeriod);
  });
  $('toggleNepaliCalendar').addEventListener('click', () => {
    const isExpanded = $('toggleNepaliCalendar').getAttribute('aria-expanded') === 'true';
    $('toggleNepaliCalendar').setAttribute('aria-expanded', String(!isExpanded));
    $('nepaliCalendar').classList.toggle('hidden', isExpanded);
  });
  $('previousNepaliMonth').addEventListener('click', () => shiftNepaliCalendarMonth(-1));
  $('nextNepaliMonth').addEventListener('click', () => shiftNepaliCalendarMonth(1));
  $('nepaliCalendarDays').addEventListener('click', (event) => {
    const dayButton = event.target.closest('[data-nepali-date]');
    if (dayButton) applyBsDateFilter(dayButton.dataset.nepaliDate);
  });
  $('dateFilterBsInput').addEventListener('input', (event) => {
    if (!isValidBsDate(event.currentTarget.value.trim())) return;
    const [year, month] = event.currentTarget.value.trim().split('-').map(Number);
    $('nepaliCalendar').dataset.year = String(year);
    $('nepaliCalendar').dataset.month = String(month);
    try {
      renderNepaliCalendar();
    } catch (error) {
      showToast(error.message, true);
    }
  });
  $('dateFilterBsInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyBsDateFilter(event.currentTarget.value);
    }
  });
  $('openRegistrationSort').addEventListener('click', () => openDateFilterDialog('sort'));
  $('closeDateFilterDialog').addEventListener('click', () => $('dateFilterDialog').close());
  $('dateFilterDialog').addEventListener('click', (event) => {
    if (event.target === $('dateFilterDialog')) $('dateFilterDialog').close();
  });
  $('registrationSort').addEventListener('change', renderRecords);
  $('clearFiltersButton').addEventListener('click', () => {
    $('recordsSearch').value = '';
    $('datePeriodFilter').value = 'ALL';
    $('updatedDatePeriod').value = 'ALL';
    $('registrationDateFilter').value = '';
    $('updatedDateFilter').value = '';
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
      loadCachedRecords();
      await loadRecords({ force: true });
    } else {
      setScreen('loginScreen');
    }
  } catch (error) {
    $('loginMessage').textContent = error.message;
    setScreen('loginScreen');
  }
}

document.addEventListener('DOMContentLoaded', initializeApp);
