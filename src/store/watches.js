import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const DATA_DIR = new URL('../../data/', import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1');
const FILE = path.join(DATA_DIR, 'watches.json');

function load() {
  if (!fs.existsSync(FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function save(watches) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(watches, null, 2), 'utf-8');
}

export function listWatches() {
  return load();
}

export function getWatch(id) {
  return load().find((w) => w.id === id) || null;
}

export function addWatch(watch) {
  const watches = load();
  const record = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    lastCheckedAt: null,
    ...watch,
  };
  watches.push(record);
  save(watches);
  return record;
}

export function removeWatch(id) {
  const watches = load();
  const idx = watches.findIndex((w) => w.id === id);
  if (idx === -1) return false;
  watches.splice(idx, 1);
  save(watches);
  return true;
}

export function updateWatch(id, patch) {
  const watches = load();
  const idx = watches.findIndex((w) => w.id === id);
  if (idx === -1) return null;
  watches[idx] = { ...watches[idx], ...patch };
  save(watches);
  return watches[idx];
}
