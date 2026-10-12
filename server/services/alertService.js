const { EventEmitter } = require('events');
const db = require('../db');

const METRICS = ['cpu', 'ram', 'swap', 'disk'];
const emitter = new EventEmitter();
// Kural+hedef başına durum: eşik ne zamandan beri aşılıyor, açık olay var mı
const state = new Map();
let rulesCache = null;

const stmts = {
  rules: db.prepare('SELECT * FROM alert_rules ORDER BY metric, id'),
  rule: db.prepare('SELECT * FROM alert_rules WHERE id = ?'),
  insertRule: db.prepare(`INSERT INTO alert_rules (metric, target, threshold, duration_sec, enabled, created_at)
                          VALUES (@metric, @target, @threshold, @duration_sec, @enabled, @created_at)`),
  updateRule: db.prepare(`UPDATE alert_rules SET metric=@metric, target=@target, threshold=@threshold,
                          duration_sec=@duration_sec, enabled=@enabled WHERE id=@id`),
  deleteRule: db.prepare('DELETE FROM alert_rules WHERE id = ?'),
  insertEvent: db.prepare(`INSERT INTO alert_events (rule_id, metric, target, value, threshold, started_at)
                           VALUES (?, ?, ?, ?, ?, ?)`),
  resolveEvent: db.prepare('UPDATE alert_events SET resolved_at = ?, value = MAX(value, ?) WHERE id = ?'),
  bumpEvent: db.prepare('UPDATE alert_events SET value = MAX(value, ?) WHERE id = ?'),
  event: db.prepare('SELECT * FROM alert_events WHERE id = ?'),
  ack: db.prepare('UPDATE alert_events SET acknowledged = 1 WHERE id = ?'),
  ackAll: db.prepare('UPDATE alert_events SET acknowledged = 1 WHERE acknowledged = 0'),
  closeStale: db.prepare('UPDATE alert_events SET resolved_at = ? WHERE resolved_at IS NULL'),
  cleanup: db.prepare('DELETE FROM alert_events WHERE started_at < ? AND resolved_at IS NOT NULL'),
};

function httpError(status, message) {
  return Object.assign(new Error(message), { status, expose: true });
}

function rules() {
  if (!rulesCache) rulesCache = stmts.rules.all();
  return rulesCache;
}

function validate(input) {
  const metric = String(input.metric || '');
  if (!METRICS.includes(metric)) throw httpError(400, 'Geçersiz metrik');
  const threshold = Number(input.threshold);
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 100) throw httpError(400, 'Eşik 1-100 arasında olmalı');
  const duration = Number(input.duration_sec ?? 60);
  if (!Number.isInteger(duration) || duration < 0 || duration > 86400) throw httpError(400, 'Süre 0-86400 saniye olmalı');
  let target = null;
  if (metric === 'disk' && typeof input.target === 'string' && input.target.trim()) {
    target = input.target.trim().slice(0, 255);
    if (!target.startsWith('/')) throw httpError(400, 'Disk hedefi bir bağlama noktası olmalı (ör. /)');
  }
  return { metric, target, threshold, duration_sec: duration, enabled: input.enabled === false ? 0 : 1 };
}

function createRule(input) {
  const r = validate(input);
  const info = stmts.insertRule.run({ ...r, created_at: Date.now() });
  rulesCache = null;
  return stmts.rule.get(info.lastInsertRowid);
}

function updateRule(id, input) {
  const existing = stmts.rule.get(id);
  if (!existing) throw httpError(404, 'Kural bulunamadı');
  const r = validate({ ...existing, ...input });
  stmts.updateRule.run({ ...r, id });
  rulesCache = null;
  resetState(id);
  return stmts.rule.get(id);
}

function deleteRule(id) {
  const existing = stmts.rule.get(id);
  if (!existing) throw httpError(404, 'Kural bulunamadı');
  resetState(id);
  stmts.deleteRule.run(id);
  rulesCache = null;
  return existing;
}

// Kural değişince açık olaylarını kapat
function resetState(ruleId) {
  for (const [key, st] of state) {
    if (key.startsWith(`${ruleId}:`)) {
      if (st.eventId) {
        stmts.resolveEvent.run(Date.now(), 0, st.eventId);
        emitter.emit('resolved', stmts.event.get(st.eventId));
      }
      state.delete(key);
    }
  }
}

// Bir ölçümden kural için değer(ler) çıkar: [{ target, value }]
function valuesFor(rule, s) {
  switch (rule.metric) {
    case 'cpu': return s.cpu.total === null ? [] : [{ target: null, value: s.cpu.total }];
    case 'ram': return s.mem ? [{ target: null, value: (s.mem.used / s.mem.total) * 100 }] : [];
    case 'swap': return s.mem && s.mem.swapTotal ? [{ target: null, value: (s.mem.swapUsed / s.mem.swapTotal) * 100 }] : [];
    case 'disk': return s.disks
      .filter((d) => !rule.target || d.mount === rule.target)
      .map((d) => ({ target: d.mount, value: d.size ? (d.used / d.size) * 100 : 0 }));
    default: return [];
  }
}

function evaluate(sample) {
  const now = sample.ts;
  const seen = new Set();
  for (const rule of rules()) {
    if (!rule.enabled) continue;
    for (const { target, value } of valuesFor(rule, sample)) {
      const key = `${rule.id}:${target || ''}`;
      seen.add(key);
      let st = state.get(key);
      if (!st) { st = { since: null, eventId: null }; state.set(key, st); }

      if (value > rule.threshold) {
        if (st.since === null) st.since = now;
        if (st.eventId) {
          stmts.bumpEvent.run(value, st.eventId);
        } else if (now - st.since >= rule.duration_sec * 1000) {
          const info = stmts.insertEvent.run(rule.id, rule.metric, target, value, rule.threshold, now);
          st.eventId = info.lastInsertRowid;
          emitter.emit('fired', stmts.event.get(st.eventId));
        }
      } else {
        st.since = null;
        if (st.eventId) {
          stmts.resolveEvent.run(now, value, st.eventId);
          emitter.emit('resolved', stmts.event.get(st.eventId));
          st.eventId = null;
        }
      }
    }
  }
  // Artık var olmayan hedefler (ör. ayrılmış disk)
  for (const [key, st] of state) {
    if (!seen.has(key) && st.eventId) {
      stmts.resolveEvent.run(now, 0, st.eventId);
      emitter.emit('resolved', stmts.event.get(st.eventId));
      state.delete(key);
    }
  }
}

function events({ limit = 100, active = false } = {}) {
  const sql = `SELECT * FROM alert_events ${active ? 'WHERE resolved_at IS NULL' : ''} ORDER BY started_at DESC LIMIT ?`;
  return db.prepare(sql).all(Math.min(Math.max(limit, 1), 500));
}

function ack(id) { stmts.ack.run(id); }
function ackAll() { stmts.ackAll.run(); }

function init() {
  // Önceki çalışmadan açık kalan olaylar takip edilemez; kapat
  stmts.closeStale.run(Date.now());
}

function cleanup() {
  stmts.cleanup.run(Date.now() - 30 * 86400 * 1000);
}

module.exports = {
  METRICS, rules, createRule, updateRule, deleteRule, evaluate, events, ack, ackAll, init, cleanup,
  on: emitter.on.bind(emitter),
};
