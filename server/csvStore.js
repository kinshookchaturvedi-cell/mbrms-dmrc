// csvStore.js
// Minimal CSV "database driver" — every table in /data is a .csv file.
// Uses PapaParse for robust parsing/writing (handles quoted commas, etc).

const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

const DATA_DIR = path.join(__dirname, '..', 'data');

function filePath(table) {
  return path.join(DATA_DIR, `${table}.csv`);
}

function readTable(table) {
  const fp = filePath(table);
  if (!fs.existsSync(fp)) return { headers: [], rows: [] };
  const raw = fs.readFileSync(fp, 'utf8');
  if (!raw.trim()) return { headers: [], rows: [] };
  const parsed = Papa.parse(raw, { header: true, skipEmptyLines: 'greedy' });
  // Defensive trim: strip stray newline/CR characters that can leak into the
  // last column's value if a file was ever saved with mixed line endings.
  const rows = parsed.data.map(row => {
    const clean = {};
    Object.keys(row).forEach(k => { clean[k] = typeof row[k] === 'string' ? row[k].replace(/[\r\n]+$/g, '') : row[k]; });
    return clean;
  });
  return { headers: parsed.meta.fields || [], rows };
}

function writeTable(table, headers, rows) {
  const fp = filePath(table);
  const csv = Papa.unparse({ fields: headers, data: rows.map(r => headers.map(h => r[h] ?? '')) }, { newline: '\n' });
  fs.writeFileSync(fp, csv, 'utf8');
}

function appendRow(table, row) {
  const { headers, rows } = readTable(table);
  // if table empty (no headers yet), derive headers from row
  const finalHeaders = headers.length ? headers : Object.keys(row);
  rows.push(row);
  writeTable(table, finalHeaders, rows);
  return row;
}

function updateRow(table, idField, idValue, updates) {
  const { headers, rows } = readTable(table);
  const idx = rows.findIndex(r => String(r[idField]) === String(idValue));
  if (idx === -1) return null;
  rows[idx] = { ...rows[idx], ...updates };
  writeTable(table, headers, rows);
  return rows[idx];
}

function findRows(table, predicate) {
  const { rows } = readTable(table);
  return predicate ? rows.filter(predicate) : rows;
}

function findOne(table, predicate) {
  const { rows } = readTable(table);
  return rows.find(predicate) || null;
}

function nextId(table, idField, prefix, padLen = 4) {
  const { rows } = readTable(table);
  let max = 0;
  rows.forEach(r => {
    const v = String(r[idField] || '');
    const num = parseInt(v.replace(prefix, ''), 10);
    if (!isNaN(num) && num > max) max = num;
  });
  return `${prefix}${String(max + 1).padStart(padLen, '0')}`;
}

module.exports = { readTable, writeTable, appendRow, updateRow, findRows, findOne, nextId };
