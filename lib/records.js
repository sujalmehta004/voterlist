function normalizeNin(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 10) return '';
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function normalizeFullName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function isValidFullName(value) {
  const name = String(value || '').trim();
  return /\p{L}/u.test(name) && /^[\p{L}\p{M}. ]+$/u.test(name);
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function firstNameFromFullName(value) {
  return String(value || '').trim().split(/\s+/)[0] || '';
}

function extractVoterIdentifiers(data) {
  const visited = new Set();
  const identifiers = { voterListNumber: '', abedanNumber: '' };
  const messages = [];

  function find(value, depth = 0) {
    if (typeof value === 'string') {
      messages.push(value);
      return;
    }
    if (!value || typeof value !== 'object' || depth > 5 || visited.has(value)) return;
    visited.add(value);

    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'object' && entry) continue;
      if (!['string', 'number'].includes(typeof entry)) continue;
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      const normalizedValue = String(entry).trim();
      if (/(message|error|detail|description|response)/.test(normalizedKey)) messages.push(normalizedValue);
      if (!normalizedValue || /^(?:0|null|undefined|-)$/i.test(normalizedValue)) continue;
      if (!identifiers.voterListNumber && /(voterlist.*(?:no|number)|voterno|voternumber)/.test(normalizedKey)) {
        identifiers.voterListNumber = normalizedValue;
      } else if (!identifiers.abedanNumber && /(abedan|applicationno|applicationnumber|requestnumber)/.test(normalizedKey)) {
        identifiers.abedanNumber = normalizedValue;
      }
    }

    for (const entry of Object.values(value)) {
      if (Array.isArray(entry)) {
        for (const item of entry) {
          find(item, depth + 1);
        }
      } else if (entry && typeof entry === 'object') {
        find(entry, depth + 1);
      } else if (typeof entry === 'string') {
        messages.push(entry);
      }
    }
  }

  find(data);
  const text = [...new Set(messages)].join(' ');
  const nepaliDigits = text.replace(/[०-९]/g, (digit) => String('०१२३४५६७८९'.indexOf(digit)));
  if (!identifiers.voterListNumber) {
    const voterMatch = /मतदाता\s*(?:परिचयपत्र\s*)?(?:नं|नम्बर|नंबर)\s*[:：-]?\s*([0-9]{4,})/u.exec(nepaliDigits);
    if (voterMatch) identifiers.voterListNumber = voterMatch[1];
  }
  if (!identifiers.abedanNumber) {
    const abedanMatch = /(?:(?:आवेदन|आवेदन-पत्र|निवेदन|अबेदन|अवेदन)\s*(?:संख्या\s*)?(?:नं|नम्बर|नंबर)|(?:abedan|application|request)\s*(?:number|no\.?))\s*[:：-]?\s*((?=[A-Za-z0-9/-]*\d)[A-Za-z0-9/-]{3,})/iu.exec(nepaliDigits);
    if (abedanMatch) identifiers.abedanNumber = abedanMatch[1];
  }
  return identifiers;
}

function statusFromSearch(searchSucceeded, identifiers, message = '', {
  portraitReceived = false,
  currentStatus = 'PENDING',
} = {}) {
  if (isVoterServerUnavailable(message)) {
    const normalizedStatus = String(currentStatus).toUpperCase();
    return ['DONE', 'PENDING', 'NOT ONLINE'].includes(normalizedStatus) ? normalizedStatus : 'PENDING';
  }
  if (identifiers.voterListNumber) return 'DONE';
  if (portraitReceived) return 'PENDING';
  if (identifiers.abedanNumber) return 'DONE';
  if (/no record found|please verify nin|verify nin, dob|nin.{0,20}(?:not active|inactive)|निवेदन भेटिएन|रेकर्ड भेटिएन/i.test(message)) {
    return 'NOT ONLINE';
  }
  return searchSucceeded ? 'PENDING' : 'NOT ONLINE';
}

function isVoterServerUnavailable(message = '') {
  return /NI[DN]\s*सर्भर\s*बाट\s*डेटा\s*प्राप्त\s*हुन\s*सकेन/i.test(String(message));
}

function findVoterServerUnavailableMessage(data) {
  const visited = new Set();
  function find(value, depth = 0) {
    if (typeof value === 'string') return isVoterServerUnavailable(value) ? value.trim() : '';
    if (!value || typeof value !== 'object' || depth > 8 || visited.has(value)) return '';
    visited.add(value);
    for (const entry of Object.values(value)) {
      if (Array.isArray(entry)) {
        for (const item of entry) {
          const message = find(item, depth + 1);
          if (message) return message;
        }
      } else {
        const message = find(entry, depth + 1);
        if (message) return message;
      }
    }
    return '';
  }
  return find(data);
}

function extractSearchMessage(data) {
  const visited = new Set();
  const preferredKeys = ['message', 'error', 'detail', 'description'];
  function find(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 5 || visited.has(value)) return '';
    visited.add(value);
    for (const key of preferredKeys) {
      if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
    }
    for (const entry of Object.values(value)) {
      if (Array.isArray(entry)) {
        for (const item of entry) {
          const message = find(item, depth + 1);
          if (message) return message;
        }
      } else if (entry && typeof entry === 'object') {
        const message = find(entry, depth + 1);
        if (message) return message;
      }
    }
    return '';
  }
  return find(data);
}

function containsPortraitData(data) {
  const visited = new Set();
  function find(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 8 || visited.has(value)) return false;
    visited.add(value);
    for (const [key, entry] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (/portrait/.test(normalizedKey) && typeof entry === 'string' && entry.trim()) return true;
      if (entry && typeof entry === 'object' && find(entry, depth + 1)) return true;
    }
    return false;
  }
  return find(data);
}

module.exports = {
  normalizeNin,
  normalizeFullName,
  isValidFullName,
  isValidIsoDate,
  firstNameFromFullName,
  extractVoterIdentifiers,
  extractSearchMessage,
  statusFromSearch,
  isVoterServerUnavailable,
  findVoterServerUnavailableMessage,
  containsPortraitData,
};
