// Tests du moteur (lancer : TZ=Europe/Paris node test/engine.test.mjs)
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import * as E from "../site/engine.js";

const dir = new URL(".", import.meta.url).pathname;
const rd = JSON.parse(readFileSync(dir + "data/r/6-B.json"));
const cat = JSON.parse(readFileSync(dir + "data/catalog.json"));
const now = 1793602680; // lundi 2 novembre 2026, 07:58
const at = (y, mo, d, h, mi) => Math.floor(new Date(y, mo - 1, d, h, mi).getTime() / 1000);
const Q = (dir_, stop) => ({ key: E.quaiKey("6-B", dir_, stop), routeId: "6-B", short: "6", dir: dir_, stopId: stop });
const quais = [Q(0, "PEY1"), Q(1, "PEY2"), Q(0, "VIA1"), Q(1, "VIA2")];
const R = { "6-B": rd };
let n = 0; const test = (name, fn) => { fn(); n++; console.log("ok  " + name); };

test("heure de référence", () => assert.equal(at(2026, 11, 2, 7, 58), now));

test("lecture TripUpdate", () => {
  const f = E.parseFeed(readFileSync(dir + "tripupdate.pb"));
  assert.equal(f.timestamp, now); assert.equal(f.trips.length, 3);
  const t1 = f.trips.find(t => t.tripId === "T1");
  assert.equal(t1.stops[0].depDelay, 180); assert.equal(t1.stops[1].depTime, now + 420);
  assert.equal(f.trips.find(t => t.tripId === "TX").stops[0].depDelay, -30);
});

test("alertes", () => {
  const f = E.parseFeed(readFileSync(dir + "alert.pb"));
  assert.equal(f.alerts.length, 4);
  assert.equal(f.alerts.find(a => a.id === "AL1").header, "Ligne 6 déviée");
  assert.deepEqual(E.alerts(quais, f, now).map(a => a.id).sort(), ["AL1", "AL3"]);
});

test("temps réel", () => {
  const rt = E.predictions(R, quais, E.parseFeed(readFileSync(dir + "tripupdate.pb")), now);
  const p = k => rt.preds[k].map(x => [x.trip, x.time]);
  assert.deepEqual(p("6-B|0|PEY1"), [["T1", now + 420]]);
  assert.deepEqual(p("6-B|0|VIA1"), [["T1", at(2026, 11, 2, 8, 13)], ["TX", now + 1200]]);
  const b = E.board(rd, rt, now, quais[0]);
  assert.equal(b.etat, "DIRECT"); assert.equal(b.passages[0].time, now + 420); assert.ok(b.passages[0].realtime);
});

test("flux muet : théorique", () => {
  const b = E.board(rd, null, now, quais[0]);
  assert.equal(b.etat, "THEORIQUE"); assert.equal(b.passages[0].time, at(2026, 11, 2, 8, 2)); assert.equal(b.passages.length, 5);
});

test("fin de service et après minuit", () => {
  const tard = at(2026, 11, 2, 23, 59);
  assert.equal(E.board(rd, null, tard, quais[3]).passages[0].time, at(2026, 11, 3, 0, 20));
  const b = E.board(rd, null, tard, quais[0]);
  assert.equal(b.etat, "NUIT"); assert.equal(E.hourWithDay(b.passages[0].time, tard), "demain 08:02");
});

test("samedi et férié", () => {
  assert.equal(E.board(rd, null, at(2026, 11, 7, 7, 0), quais[0]).passages[0].time, at(2026, 11, 7, 9, 2));
  assert.equal(E.board(rd, null, at(2026, 11, 11, 7, 0), quais[0]).passages[0].time, at(2026, 11, 12, 8, 2));
});

test("où est mon bus", () => {
  const feed = E.parseFeed(readFileSync(dir + "tripupdate.pb"));
  const rt = E.predictions(R, quais, feed, now);
  const b = E.board(rd, rt, now, quais[0]);
  const stops = cat.lignes[0].directions.find(d => d.dir === 0).stops;
  const t = E.track(quais[0], stops, feed, b.passages, now);
  assert.equal(t.myIndex, 1); assert.equal(t.buses.length, 1);
  assert.equal(t.buses[0].trip, "T1"); assert.equal(t.buses[0].index, 1); assert.equal(t.far.length, 3);
});

test("formats", () => {
  assert.equal(E.wait(now + 30, now), "Proche"); assert.equal(E.wait(now + 250, now), "4 min"); assert.equal(E.wait(now + 3900, now), "1 h 05");
});

test("GPS", () => {
  const feed = E.parseFeed(readFileSync(dir + "tripupdate.pb"));
  const veh = E.parseFeed(readFileSync(dir + "vehicles.pb")).vehicles;
  assert.equal(veh.length, 1); assert.ok(Math.abs(veh[0].lat - 43.61075) < 1e-4);
  const rt = E.predictions(R, quais, feed, now);
  const b = E.board(rd, rt, now, quais[0]);
  const stops = cat.lignes[0].directions.find(d => d.dir === 0).stops;
  const t = E.track(quais[0], stops, feed, b.passages, now, 4, 5, 2, veh);
  assert.ok(t.buses[0].gps); assert.ok(Math.abs(t.buses[0].frac - 0.75) < 0.05);
});

test("partage", () => {
  const favs = [{ routeId: "6", dir: 0, stopId: "6236", star: true }, { routeId: "10", dir: 1, stopId: "1020", star: false }];
  const p = E.encodeShare(favs);
  assert.deepEqual(E.decodeShare(p), favs);
  // Même encodage que l'appli Android (Base64 URL sans remplissage)
  assert.equal(p, Buffer.from("6~0~6236~1,10~1~1020~0").toString("base64url"));
});
test("j'arrive", () => {
  const feed = E.parseFeed(readFileSync(dir + "tripupdate.pb"));
  const d = cat.lignes[0].directions.find(x => x.dir === 0);
  const stops = [...d.stops, { id: "EUR", name: "Euromédecine" }];
  const a = { routeId: "6-B", dir: 0, stopId: "VIA1", tripId: "T1", name: "Olivier", eta: null };
  assert.deepEqual(E.decodeArrivee(E.encodeArrivee(a)), { ...a, eta: null });
  const r = E.arrivee(a, rd, feed, [], stops, now);
  assert.ok(r.realtime); assert.ok(!r.arrived); assert.ok(r.eta > now + 420);
  assert.equal(r.dest, "Pierre Viala"); assert.ok(r.restants >= 0);
  // Même lien que l'appli Android
  assert.equal(E.encodeArrivee({ ...a, eta: 123 }), Buffer.from("6-B~0~VIA1~T1~Olivier~123").toString("base64url"));
});
console.log(`${n} tests réussis`);
