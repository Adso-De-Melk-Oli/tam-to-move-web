// TaM to Move – moteur de calcul (même logique que l'appli Android).
// Module sans dépendance : utilisable dans le navigateur et testé avec Node.

// ---------------------------------------------------------------- Protobuf GTFS-Realtime

class Reader {
  constructor(buf, pos = 0, end = buf.length) { this.b = buf; this.p = pos; this.e = end; }
  more() { return this.p < this.e; }
  varint() {
    // BigInt pour gérer les entiers négatifs (10 octets) et les 64 bits
    let r = 0n, shift = 0n;
    for (;;) {
      if (this.p >= this.e) throw new Error("varint tronqué");
      const x = this.b[this.p++];
      r |= BigInt(x & 0x7f) << shift;
      if ((x & 0x80) === 0) return r;
      shift += 7n;
      if (shift > 70n) throw new Error("varint trop long");
    }
  }
  num() { return Number(BigInt.asIntN(64, this.varint())); }
  tag() { return Number(this.varint()); }
  sub() {
    const n = Number(this.varint());
    if (this.p + n > this.e) throw new Error("longueur invalide");
    const r = new Reader(this.b, this.p, this.p + n); this.p += n; return r;
  }
  str() {
    const n = Number(this.varint());
    const s = new TextDecoder().decode(this.b.subarray(this.p, this.p + n)); this.p += n; return s;
  }
  skip(wt) {
    if (wt === 0) this.varint();
    else if (wt === 1) this.p += 8;
    else if (wt === 2) { const n = Number(this.varint()); this.p += n; }
    else if (wt === 5) this.p += 4;
    else throw new Error("type inconnu " + wt);
  }
}

function each(r, fn) {
  while (r.more()) { const t = r.tag(); fn(t >>> 3, t & 7); }
}

function event(r) {
  let delay = null, time = null;
  each(r, (f, w) => {
    if (f === 1 && w === 0) delay = r.num();
    else if (f === 2 && w === 0) { const t = r.num(); time = t > 0 ? t : null; }
    else r.skip(w);
  });
  return { delay, time };
}

function stopUpdate(r) {
  let seq = null, stopId = null, arr = { delay: null, time: null }, dep = { delay: null, time: null }, rel = 0;
  each(r, (f, w) => {
    if (f === 1 && w === 0) seq = r.num();
    else if (f === 2 && w === 2) arr = event(r.sub());
    else if (f === 3 && w === 2) dep = event(r.sub());
    else if (f === 4 && w === 2) stopId = r.str();
    else if (f === 5 && w === 0) rel = r.num();
    else r.skip(w);
  });
  return { seq, stopId, arrTime: arr.time, arrDelay: arr.delay, depTime: dep.time, depDelay: dep.delay, skipped: rel === 1 };
}

function tripUpdate(r) {
  const tu = { tripId: null, routeId: null, dir: null, startDate: null, rel: 0, delay: null, stops: [] };
  each(r, (f, w) => {
    if (f === 1 && w === 2) {
      const t = r.sub();
      each(t, (g, x) => {
        if (g === 1 && x === 2) tu.tripId = t.str();
        else if (g === 3 && x === 2) tu.startDate = t.str();
        else if (g === 4 && x === 0) tu.rel = t.num();
        else if (g === 5 && x === 2) tu.routeId = t.str();
        else if (g === 6 && x === 0) tu.dir = t.num();
        else t.skip(x);
      });
    } else if (f === 2 && w === 2) {
      try { tu.stops.push(stopUpdate(r.sub())); } catch (e) { /* ignoré */ }
    } else if (f === 5 && w === 0) tu.delay = r.num();
    else r.skip(w);
  });
  tu.canceled = tu.rel === 3 || tu.rel === 7;
  return tu;
}

function translated(r) {
  const all = [];
  each(r, (f, w) => {
    if (f === 1 && w === 2) {
      const t = r.sub(); let text = "", lang = null;
      each(t, (g, x) => {
        if (g === 1 && x === 2) text = t.str();
        else if (g === 2 && x === 2) lang = t.str();
        else t.skip(x);
      });
      all.push([text, lang]);
    } else r.skip(w);
  });
  const fr = all.find(a => (a[1] || "").toLowerCase().startsWith("fr")) || all[0];
  return fr ? fr[0].trim() : "";
}

function alert(id, r) {
  const a = { id, periods: [], routes: [], stops: [], network: false, header: "", text: "" };
  each(r, (f, w) => {
    if (f === 1 && w === 2) {
      const p = r.sub(); let s = null, e = null;
      each(p, (g, x) => {
        if (g === 1 && x === 0) { const v = p.num(); s = v > 0 ? v : null; }
        else if (g === 2 && x === 0) { const v = p.num(); e = v > 0 ? v : null; }
        else p.skip(x);
      });
      a.periods.push([s, e]);
    } else if (f === 5 && w === 2) {
      const s = r.sub(); let agency = false, route = null, stop = null, other = false;
      each(s, (g, x) => {
        if (g === 1) { agency = true; s.skip(x); }
        else if (g === 2 && x === 2) route = s.str();
        else if (g === 5 && x === 2) stop = s.str();
        else { other = true; s.skip(x); }
      });
      if (route) a.routes.push(route);
      if (stop) a.stops.push(stop);
      if (agency && !route && !stop && !other) a.network = true;
    } else if (f === 10 && w === 2) a.header = translated(r.sub());
    else if (f === 11 && w === 2) a.text = translated(r.sub());
    else r.skip(w);
  });
  return a;
}

function vehicle(r) {
  const v = { tripId: null, routeId: null, lat: null, lon: null, stopId: null, status: 2, ts: null };
  const dv = (rr) => { const x = new DataView(rr.b.buffer, rr.b.byteOffset + rr.p, 4).getFloat32(0, true); rr.p += 4; return x; };
  each(r, (f, w) => {
    if (f === 1 && w === 2) {
      const t = r.sub();
      each(t, (g, x) => { if (g === 1 && x === 2) v.tripId = t.str(); else if (g === 5 && x === 2) v.routeId = t.str(); else t.skip(x); });
    } else if (f === 2 && w === 2) {
      const p = r.sub();
      each(p, (g, x) => { if (g === 1 && x === 5) v.lat = dv(p); else if (g === 2 && x === 5) v.lon = dv(p); else p.skip(x); });
    } else if (f === 4 && w === 0) v.status = r.num();
    else if (f === 5 && w === 0) v.ts = r.num();
    else if (f === 7 && w === 2) v.stopId = r.str();
    else r.skip(w);
  });
  return v.lat == null || v.lon == null ? null : v;
}

export function parseFeed(bytes) {
  const r = new Reader(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const feed = { timestamp: null, trips: [], alerts: [], vehicles: [] };
  each(r, (f, w) => {
    if (f === 1 && w === 2) {
      const h = r.sub();
      each(h, (g, x) => { if (g === 3 && x === 0) feed.timestamp = h.num(); else h.skip(x); });
    } else if (f === 2 && w === 2) {
      try {
        const e = r.sub(); let id = "", deleted = false, tu = null, al = null, ve = null;
        each(e, (g, x) => {
          if (g === 1 && x === 2) id = e.str();
          else if (g === 2 && x === 0) deleted = e.num() !== 0;
          else if (g === 3 && x === 2) tu = tripUpdate(e.sub());
          else if (g === 4 && x === 2) ve = vehicle(e.sub());
          else if (g === 5 && x === 2) al = e.sub();
          else e.skip(x);
        });
        if (!deleted) { if (tu) feed.trips.push(tu); if (al) feed.alerts.push(alert(id, al)); if (ve) feed.vehicles.push(ve); }
      } catch (e) { /* entité abîmée : ignorée */ }
    } else r.skip(w);
  });
  return feed;
}

// ---------------------------------------------------------------- Calendrier

const pad = n => String(n).padStart(2, "0");
export const ymd = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
/** Début de journée de service : midi (heure locale) moins 12 h, correct aux changements d'heure. */
export const dayStart = d => Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime() / 1000) - 12 * 3600;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dateOf = epoch => { const d = new Date(epoch * 1000); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };

export function activeServices(rd, date) {
  const key = ymd(date), dow = (date.getDay() + 6) % 7, out = new Set();
  for (const [id, [days, start, end]] of Object.entries(rd.services)) {
    if (start && key < start) continue;
    if (end && key > end) continue;
    if (days[dow] === "1") out.add(id);
  }
  for (const [id, list] of Object.entries(rd.exceptions || {})) {
    for (const [d, t] of list) if (d === key) { if (t === 1) out.add(id); else if (t === 2) out.delete(id); }
  }
  return out;
}

// ---------------------------------------------------------------- Quais et horaires

export const quaiKey = (routeId, dir, stopId) => `${routeId}|${dir}|${stopId}`;

function stopIndex(rd, q) {
  const d = rd && rd.dirs[String(q.dir)];
  return d ? d.stops.indexOf(q.stopId) : -1;
}

/** Départs théoriques d'un quai entre from et to (secondes Unix). */
export function scheduled(rd, q, from, to) {
  const idx = stopIndex(rd, q);
  if (idx < 0) return [];
  const trips = rd.dirs[String(q.dir)].trips, out = [];
  const today = dateOf(from);
  for (let date = addDays(today, -1); date <= addDays(today, 7); date = addDays(date, 1)) {
    const start = dayStart(date);
    if (start > to) break;
    const act = activeServices(rd, date);
    if (!act.size) continue;
    for (const [svc, trip, times] of trips) {
      const t = times[idx];
      if (t == null || !act.has(svc)) continue;
      const at = start + t;
      if (at >= from && at <= to) out.push({ trip, time: at, realtime: false, canceled: false });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

// ---------------------------------------------------------------- Temps réel

/** Prévisions temps réel par quai, d'après le flux TripUpdate. */
export function predictions(routeData, quais, feed, now) {
  const preds = {}, passed = new Set();
  for (const q of quais) preds[q.key] = [];
  const today = dateOf(now);
  for (const tu of feed.trips) {
    if (!tu.tripId) continue;
    for (const q of quais) {
      const rd = routeData[q.routeId];
      const dd = rd && rd.dirs[String(q.dir)];
      const sched = dd && dd.trips.find(t => t[1] === tu.tripId);
      const sameLine = tu.routeId === q.routeId && (tu.dir == null || tu.dir === q.dir);
      if (!sched && !sameLine) continue;
      const idx = dd ? dd.stops.indexOf(q.stopId) : -1;
      const exact = tu.stops.find(s => s.stopId === q.stopId);
      if (exact && exact.skipped) continue;
      let time = exact ? (exact.depTime ?? exact.arrTime) : null;
      if (time == null && sched && idx >= 0 && sched[2][idx] != null) {
        const myT = sched[2][idx];
        let base = null;
        if (tu.startDate && /^\d{8}$/.test(tu.startDate)) {
          base = dayStart(new Date(+tu.startDate.slice(0, 4), +tu.startDate.slice(4, 6) - 1, +tu.startDate.slice(6, 8)));
        } else {
          base = [-1, 0, 1].map(n => dayStart(addDays(today, n)))
            .reduce((a, b) => Math.abs(b + myT - now) < Math.abs(a + myT - now) ? b : a);
        }
        // Index de chaque arrêt du flux sur le tracé
        const withIdx = tu.stops.map(s => [s, s.stopId ? dd.stops.indexOf(s.stopId) : -1]).filter(x => x[1] >= 0);
        if (!exact && withIdx.length && withIdx.every(x => x[1] > idx)) { passed.add(tu.tripId + "|" + q.key); continue; }
        // Retard observé à l'arrêt précédent le plus proche (donné, ou calculé avec l'horaire du trajet)
        let delay = null;
        for (const [s, i] of withIdx.filter(x => x[1] <= idx).sort((a, b) => b[1] - a[1])) {
          if (s.depDelay != null) { delay = s.depDelay; break; }
          if (s.arrDelay != null) { delay = s.arrDelay; break; }
          const t = s.depTime ?? s.arrTime;
          if (t != null && sched[2][i] != null) { delay = t - (base + sched[2][i]); break; }
        }
        if (delay == null) delay = tu.delay;
        if (delay != null || tu.canceled) time = base + myT + (delay || 0);
      }
      if (time != null) preds[q.key].push({ trip: tu.tripId, time, canceled: tu.canceled });
    }
  }
  return { preds, passed, fetchedAt: now, feedTime: feed.timestamp };
}

export const RT_MAX_AGE = 600;
export const FIN_SERVICE_GAP = 3000;
export const rtUsable = (rt, now) => !!rt && now - rt.fetchedAt <= RT_MAX_AGE &&
  (rt.feedTime == null || now - rt.feedTime <= RT_MAX_AGE + 300);

/** Tableau d'un quai : 5 prochains passages, temps réel prioritaire, théorique en secours. */
export function board(rd, rt, now, q, count = 5) {
  const sched = rd ? scheduled(rd, q, now - 3600, now + 8 * 86400) : [];
  const preds = rt ? rt.preds[q.key] || [] : [];
  const byTrip = new Map(preds.map(p => [p.trip, p]));
  const used = new Set(), merged = [];
  for (const p of sched) {
    const pr = byTrip.get(p.trip);
    if (pr && !used.has(p.trip) && Math.abs(pr.time - p.time) < 3 * 3600) {
      used.add(p.trip);
      merged.push({ trip: p.trip, time: pr.time, realtime: true, canceled: pr.canceled });
    } else if (!pr && rt && rt.passed.has(p.trip + "|" + q.key) && p.time < now + 7200) {
      continue;
    } else merged.push(p);
  }
  for (const pr of preds) if (!used.has(pr.trip) && !sched.some(s => s.trip === pr.trip)) {
    merged.push({ trip: pr.trip, time: pr.time, realtime: true, canceled: pr.canceled });
  }
  const upcoming = merged.filter(p => p.time >= now - 30).sort((a, b) => a.time - b.time);
  const result = []; let n = 0;
  for (const p of upcoming) { if (n >= count) break; result.push(p); if (!p.canceled) n++; }
  const first = result.find(p => !p.canceled);
  const etat = !first ? "VIDE" : first.time - now > FIN_SERVICE_GAP ? "NUIT" : !rt ? "THEORIQUE" : "DIRECT";
  return { quai: q, passages: result, etat, sansHoraires: !rd };
}

const LINE_REF = /\b(?:ligne\s*|L|T)(\d{1,2})\b/gi;

export function alerts(quais, feed, now) {
  const stops = new Set(quais.map(q => q.stopId)), routes = new Set(quais.map(q => q.routeId)), shorts = new Set(quais.map(q => q.short));
  const out = [];
  for (const a of feed.alerts) {
    const direct = a.routes.some(r => routes.has(r)) || a.stops.some(s => stops.has(s));
    let network = false;
    if (a.network) {
      const refs = [...(a.header + " " + a.text).matchAll(LINE_REF)].map(m => m[1]);
      network = !refs.length || refs.some(r => shorts.has(r));
    }
    const active = !a.periods.length || a.periods.some(([s, e]) => (e == null || e >= now) && (s == null || s <= now + 86400));
    if ((direct || network) && active && (a.header || a.text)) {
      const p = a.periods.find(([, e]) => e == null || e >= now);
      out.push({ id: a.id || a.header, title: a.header || "Info trafic", text: a.text, end: p ? p[1] : null });
    }
  }
  return out.filter((a, i) => out.findIndex(b => b.id === a.id) === i);
}

// ---------------------------------------------------------------- Où est mon bus

const STOP_SEC = 90;

/** Distance approximative en mètres. */
function dist(a1, o1, a2, o2) {
  const r = Math.PI / 180, x = (o2 - o1) * r * Math.cos((a1 + a2) / 2 * r), y = (a2 - a1) * r;
  return Math.sqrt(x * x + y * y) * 6371000;
}

const norm = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function track(q, dirStops, feed, passages, now, count = 4, before = 4, after = 1, vehicles = []) {
  // Ton arrêt par son identifiant, sinon par son nom (autre quai du même arrêt)
  let me = dirStops.findIndex(s => s.id === q.stopId);
  if (me < 0) { const n = norm(q.stopName || ""); me = dirStops.findIndex(s => norm(s.name) === n); }
  if (me < 0) return null;
  const from = Math.max(0, me - before), to = Math.min(dirStops.length - 1, me + after);
  const indexOf = new Map(); dirStops.forEach((s, i) => { if (!indexOf.has(s.id)) indexOf.set(s.id, i); });
  const byTrip = new Map((feed ? feed.trips : []).filter(t => t.tripId).map(t => [t.tripId, t]));
  const vehByTrip = new Map(vehicles.filter(v => v.tripId && now - (v.ts || now) < 300).map(v => [v.tripId, v]));
  const placed = [], far = [], taken = new Set();
  for (const p of passages.filter(p => !p.canceled && p.time >= now - 30).sort((a, b) => a.time - b.time).slice(0, count)) {
    let gi = null, waiting = false;
    const tu = p.realtime ? byTrip.get(p.trip) : null;
    if (tu) {
      const next = tu.stops.find(s => { const t = s.arrTime ?? s.depTime; return t != null && t >= now - 20 && indexOf.has(s.stopId); });
      if (next) {
        const i = indexOf.get(next.stopId);
        if (i <= me) gi = i;
        const dep = next.depTime ?? next.arrTime;
        if (gi === 0 && dep > now + 90) waiting = true;
      }
    }
    // Position GPS : affine le tronçon et l'avancement entre deux arrêts
    let frac = 0.5, gps = false;
    const v = p.realtime ? vehByTrip.get(p.trip) : null;
    if (v && !waiting) {
      const vi = indexOf.has(v.stopId) ? indexOf.get(v.stopId) : null;
      const ni = vi ?? gi;
      if (ni != null && ni <= me) {
        gi = ni; gps = true;
        if (v.status === 1 && vi != null) frac = 1;
        else if (ni > 0) {
          const a = dirStops[ni - 1], b = dirStops[ni];
          if (a.lat && b.lat) {
            const da = dist(a.lat, a.lon, v.lat, v.lon), db = dist(v.lat, v.lon, b.lat, b.lon);
            if (da + db > 0) frac = Math.min(0.92, Math.max(0.08, da / (da + db)));
          }
        }
      }
    }
    const estimated = gi == null;
    if (gi == null) {
      gi = me - Math.ceil(Math.max(0, p.time - now) / STOP_SEC);
      if (gi < 0) { if (p.time - now <= (me + 2) * STOP_SEC) gi = 0; else waiting = true; }
    }
    const bus = { trip: p.trip, index: gi - from, eta: p.time, realtime: p.realtime, estimated, frac, gps };
    if (waiting || gi < from || taken.has(gi)) far.push(bus); else { placed.push(bus); taken.add(gi); }
  }
  return { stops: dirStops.slice(from, to + 1), myIndex: me - from, buses: placed, far };
}

// ---------------------------------------------------------------- Formats

export const hour = e => { const d = new Date(e * 1000); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export function hourWithDay(e, now) {
  const d = dateOf(e), t = dateOf(now);
  const diff = Math.round((d - t) / 86400000);
  if (diff === 0) return hour(e);
  if (diff === 1) return "demain " + hour(e);
  return ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."][d.getDay()] + " " + hour(e);
}
export function wait(e, now) {
  const s = e - now;
  if (s < 60) return "Proche";
  const m = Math.floor(s / 60);
  if (m >= 360) return hourWithDay(e, now); // au-delà de 6 h : l'heure (et le jour) parle mieux
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${pad(m % 60)}`;
}

// ---------------------------------------------------------------- Partage (même format que l'appli Android)

const b64e = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64d = s => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

export const encodeShare = favs => b64e(favs.map(f => `${f.routeId}~${f.dir}~${f.stopId}~${f.star ? 1 : 0}`).join(","));

export function decodeShare(payload) {
  try {
    return b64d(payload).split(",").map(x => x.split("~")).filter(p => p.length >= 3 && /^\d+$/.test(p[1]))
      .map(([routeId, dir, stopId, star]) => ({ routeId, dir: +dir, stopId, star: star === "1" }));
  } catch (e) { return []; }
}
