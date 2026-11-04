// TaM to Move – page web. Favoris sauvegardés dans le navigateur (localStorage), rien n'est envoyé ailleurs.
import * as E from "./engine.js?v=12";
import { RELAIS } from "./config.js?v=12";

const MAX = 10;
const KEY = "ttm.favoris";
// Nouvelle visite : liste vide, la page propose d'ajouter un premier arrêt
const DEFAULTS = [];

const S = {
  favoris: load(), catalog: null, routes: {}, feed: null, rt: null, rtAt: null, alerts: [],
  loading: true, now: Date.now() / 1000, vehicles: [],
};
const APK = "https://github.com/Adso-De-Melk-Oli/tam-to-move-web/releases/latest/download/Tam-to-Move.apk";
const isAndroid = /Android/i.test(navigator.userAgent);

function load() {
  try { const v = JSON.parse(localStorage.getItem(KEY)); if (Array.isArray(v)) return v; } catch (e) {}
  return DEFAULTS;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S.favoris)); } catch (e) {} }

// ---------------------------------------------------------------- Données

async function json(url) { const r = await fetch(url, { cache: "no-cache" }); if (!r.ok) throw new Error(r.status); return r.json(); }

async function loadCatalog() {
  try { S.catalog = await json("data/catalog.json"); } catch (e) { S.catalog = null; }
  // Favoris complétés avec les noms et couleurs à jour
  if (S.catalog) {
    S.favoris = S.favoris.map(f => {
      const l = ligne(f.routeId), d = l && l.directions.find(x => x.dir === f.dir);
      const s = d && d.stops.find(x => x.id === f.stopId);
      return l ? { ...f, short: l.short, color: l.color, textColor: l.textColor, type: l.type, headsign: d ? d.headsign : f.headsign, stopName: s ? s.name : f.stopName } : f;
    });
    save();
  }
}

const ligne = id => S.catalog && S.catalog.lignes.find(l => l.routeId === id);
const norm = s => String(s || "").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Toutes les lignes et sens qui partent d'un arrêt (même nom) */
function stationQuais(name) {
  if (!S.catalog) return [];
  const n = norm(name), out = [];
  for (const l of S.catalog.lignes) for (const d of l.directions) for (const st of d.stops) {
    if (norm(st.name) !== n) continue;
    const key = E.quaiKey(l.routeId, d.dir, st.id);
    if (!out.some(q => q.key === key)) out.push({ key, routeId: l.routeId, short: l.short, color: l.color, textColor: l.textColor,
      type: l.type, dir: d.dir, stopId: st.id, stopName: st.name, headsign: d.headsign });
  }
  return out.sort((a, b) => (parseInt(a.short) || 999) - (parseInt(b.short) || 999) || String(a.short).localeCompare(b.short) || a.headsign.localeCompare(b.headsign));
}
const stationName = () => { const p = location.hash.slice(1).split("/").filter(Boolean); return p[0] === "arret" && p[1] ? decodeURIComponent(p[1]) : null; };

async function loadRoutes() {
  const arr = arriveeInfo();
  const st = stationName();
  const need = [...new Set([...S.favoris.map(f => f.routeId), ...(arr ? [arr.routeId] : []), ...(st ? stationQuais(st).map(q => q.routeId) : [])])].filter(id => !S.routes[id]);
  await Promise.all(need.map(async id => {
    const l = ligne(id);
    try { S.routes[id] = await json(`data/r/${l ? l.file : id}.json`); } catch (e) {}
  }));
}

async function loadRealtime() {
  if (!RELAIS) return;
  const now = Date.now() / 1000;
  try {
    const [tu, al, ve] = await Promise.all([
      fetch(RELAIS + "/trip-updates").then(r => r.ok ? r.arrayBuffer() : Promise.reject()),
      fetch(RELAIS + "/alerts").then(r => r.ok ? r.arrayBuffer() : null).catch(() => null),
      fetch(RELAIS + "/vehicles").then(r => r.ok ? r.arrayBuffer() : null).catch(() => null),
    ]);
    if (ve) { try { S.vehicles = E.parseFeed(new Uint8Array(ve)).vehicles; } catch (e) {} }
    S.feed = E.parseFeed(new Uint8Array(tu));
    S.rt = E.predictions(S.routes, S.favoris, S.feed, now);
    S.rtAt = now;
    if (al) S.alerts = E.alerts(S.favoris, E.parseFeed(new Uint8Array(al)), now);
  } catch (e) { /* flux muet : on garde le dernier état, puis bascule en théorique */ }
}

async function refresh() {
  await loadRoutes();
  await loadRealtime();
  S.loading = false;
  render();
}

function arriveeInfo() {
  const p = location.hash.slice(1).split("/").filter(Boolean);
  return p[0] === "arrivee" && p[1] ? E.decodeArrivee(p[1]) : null;
}

// ---------------------------------------------------------------- Rendu

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const nice = s => esc(String(s || "").replace(/ - /g, " – "));
const short = s => esc(String(s || "").split(" - ")[0]);
const pill = (f, small) => `<span class="pill${small ? " s" : ""}" style="background:#${esc(f.color)};color:#${esc(f.textColor || "FFFFFF")}">${esc(f.short)}</span>`;
const live = () => E.rtUsable(S.rt, S.now);

function glyph(tram, size = 18) {
  return tram
    ? `<svg width="${size}" height="${size}" viewBox="0 0 108 108" fill="#fff" stroke="#fff"><path d="M42 14L54 24L66 14M38 14H70M36 92L28 100M72 92L80 100" stroke-width="5" fill="none"/><path fill-rule="evenodd" stroke="none" d="M46 24h16a14 14 0 0 1 14 14v30a14 14 0 0 1-14 14H46a14 14 0 0 1-14-14V38a14 14 0 0 1 14-14zM44 32h20a6 6 0 0 1 6 6v10a6 6 0 0 1-6 6H44a6 6 0 0 1-6-6V38a6 6 0 0 1 6-6zM41 67a3 3 0 1 0 6 0a3 3 0 1 0-6 0zM61 67a3 3 0 1 0 6 0a3 3 0 1 0-6 0z"/></svg>`
    : `<svg width="${size}" height="${size}" viewBox="0 0 108 108" fill="#fff"><path fill-rule="evenodd" d="M43,26h22a9,9 0,0 1,9,9v32a9,9 0,0 1,-9,9h-22a9,9 0,0 1,-9,-9v-32a9,9 0,0 1,9,-9zM42,35h24a2,2 0,0 1,2,2v14a2,2 0,0 1,-2,2h-24a2,2 0,0 1,-2,-2v-14a2,2 0,0 1,2,-2zM40,64a3,3 0,1 0,6,0a3,3 0,1 0,-6,0zM62,64a3,3 0,1 0,6,0a3,3 0,1 0,-6,0z"/><path d="M38,74h7v6a2,2 0,0 1,-2,2h-3a2,2 0,0 1,-2,-2zM63,74h7v6a2,2 0,0 1,-2,2h-3a2,2 0,0 1,-2,-2z"/></svg>`;
}

function boards() {
  const rt = live() ? S.rt : null;
  return S.favoris.map(f => E.board(S.routes[f.routeId], rt, S.now, f));
}

function status() {
  if (S.loading && !S.rtAt) return `<span class="dot" style="background:var(--sec)"></span>Connexion au réseau TaM…`;
  if (live()) return `<span class="dot live"></span>En direct · mis à jour à ${E.hour(S.rtAt)}`;
  if (!RELAIS) return `<span class="dot" style="background:var(--warn)"></span>Horaires théoriques · relais non configuré`;
  if (S.rtAt) return `<span class="dot" style="background:var(--warn)"></span>Horaires théoriques · dernier direct à ${E.hour(S.rtAt)}`;
  return `<span class="dot" style="background:var(--warn)"></span>Horaires théoriques · flux TaM injoignable`;
}

function viewHome() {
  const now = S.now;
  let h = `<div class="nav">${S.favoris.length ? `<a href="#/partage">Partager</a>` : "<span></span>"}<a class="action" href="#/arrets">Modifier</a></div>
    <h1>TaM to Move</h1><div class="subtitle">Bus et tram en direct · Métropole de Montpellier</div><div class="sub">${status()}</div>`;
  for (const a of S.alerts) {
    h += `<button class="alert" onclick="this.classList.toggle('open')"><div class="i">!</div><div><b>${esc(a.title)}</b>${a.text ? `<p>${esc(a.text)}</p>` : ""}</div></button>`;
  }
  if (!S.favoris.length) {
    h += `<div class="card" style="text-align:center;padding:26px 20px"><div style="font-size:40px">🚏</div>
      <div style="font-weight:600;font-size:17px;margin-top:6px">Bienvenue sur TaM to Move</div>
      <div class="dest" style="margin:8px 0 16px">Ajoute les arrêts que tu prends souvent : leurs prochains bus et trams s'affichent ici, en direct. Jusqu'à 10 arrêts, sur la ligne et dans le sens de ton choix. Ils restent dans ce navigateur.</div>
      <a class="btn" href="#/ajout">Ajouter ton premier arrêt</a></div>`;
  }
  // Cartes regroupées par arrêt ; le titre ouvre toutes les lignes de l'arrêt, la carte ouvre le suivi
  const groupes = [];
  for (const b of boards()) {
    const g = groupes.find(x => norm(x.name) === norm(b.quai.stopName));
    if (g) g.items.push(b); else groupes.push({ name: b.quai.stopName, items: [b] });
  }
  for (const g of groupes) {
  h += `<a class="sthead" href="#/arret/${encodeURIComponent(g.name)}"><span class="sn">${nice(g.name)}</span><span class="all">Toutes les lignes ›</span></a>`;
  for (const b of g.items) {
    const f = b.quai, first = b.passages.find(p => !p.canceled);
    const chip = { DIRECT: ["Direct", "var(--live)"], THEORIQUE: ["Théorique", "var(--warn)"], NUIT: ["Nuit", "var(--sec)"] }[b.etat];
    let body;
    if (!first) body = `<div class="rep">${b.sansHoraires ? "Téléchargement des horaires…" : "Aucun passage prévu"}</div>`;
    else if (b.etat === "NUIT") body = `<div class="night">Fin de service</div><div class="rep">Reprise vers ${E.hourWithDay(first.time, now)} · ${E.wait(first.time, now)}</div>`;
    else body = `<div class="big"><span class="w ${first.realtime ? "" : "th"}">${first.realtime ? "" : "≈ "}${E.wait(first.time, now)}</span>
      <span class="h">${first.realtime ? `<span class="dot live" style="width:7px;height:7px"></span>` : "vers "}${E.hourWithDay(first.time, now)}</span></div>`;
    const rest = b.passages.filter(p => p !== first).slice(0, 4);
    const next = rest.length ? `<div class="line"></div><div class="next">${rest.map(p => p.canceled
      ? `<div class="x"><b>Supprimé</b><span>${E.hour(p.time)}</span></div>`
      : `<div><b class="${p.realtime ? "" : "th"}">${p.realtime ? "" : "≈ "}${E.wait(p.time, now)}</b><span>${E.hourWithDay(p.time, now)}</span></div>`).join("")}</div>` : "";
    h += `<a class="card" href="#/suivi/${encodeURIComponent(f.key)}" style="color:inherit">
      <div class="row">${pill(f)}<div class="grow"><div class="stop ell">→ ${nice(f.headsign)}</div></div>
      ${chip ? `<span class="chip" style="color:${chip[1]};background:color-mix(in srgb,${chip[1]} 14%,transparent)">${chip[0]}</span>` : ""}</div>
      ${body}${next}</a>`;
  }
  }
  h += `<a class="card link" href="https://www.tam-voyages.com/fr" target="_blank" rel="noopener"><div><b>Site officiel TaM</b><span class="dest">tam-voyages.com · plans, tarifs, infos trafic</span></div><span style="color:var(--accent);font-size:20px">↗</span></a>
    <a class="card link" href="${APK}"><div><b>Appli Android</b><span class="dest">${isAndroid ? "widget, alertes « Pars maintenant » et dernier bus" : "à télécharger depuis un téléphone Android"}</span></div><span style="color:var(--accent);font-size:20px">↓</span></a>
    <div class="foot">≈ heure approximative, d'après les horaires théoriques. Tes arrêts restent dans ce navigateur.</div>
    <div class="foot t">Données TaM · Montpellier Méditerranée Métropole · licence ODbL</div>`;
  return h;
}

function viewArrets() {
  const f = S.favoris;
  let h = `<div class="nav"><a href="#/">‹ Accueil</a>${f.length ? `<a class="action" href="#/partage">Partager</a>` : ""}</div><h1>Mes arrêts</h1><div class="sub">${f.length}/${MAX} arrêts</div>`;
  if (f.length) {
    h += `<div class="group">${f.map((q, i) => `<div class="item">
      <button class="round del" data-del="${i}" aria-label="Retirer">–</button>${pill(q, true)}
      <div class="grow"><div class="ell" style="font-weight:600;font-size:15px">${nice(q.stopName)}</div><div class="dest ell" style="font-size:12px">→ ${nice(q.headsign)}</div></div>
      <button class="round mv" data-mv="${i}" data-d="-1" ${i === 0 ? "disabled" : ""} aria-label="Monter">↑</button>
      <button class="round mv" data-mv="${i}" data-d="1" ${i === f.length - 1 ? "disabled" : ""} aria-label="Descendre">↓</button></div>`).join("")}</div>
      <div class="gfoot">Les flèches règlent l'ordre d'affichage sur l'accueil.</div>`;
  }
  h += `<div class="group">${f.length >= MAX
    ? `<div class="add" style="color:var(--sec)"><span class="plus" style="background:var(--ter)">+</span>Liste complète (10 arrêts)</div>`
    : `<a class="add" href="#/ajout"><span class="plus">+</span>Ajouter un arrêt</a>`}</div>`;
  return h;
}

function viewAjout(q) {
  let h = `<div class="nav"><a href="#/arrets">‹ Mes arrêts</a></div><h1>Choisir une ligne</h1><div class="sub">Étape 1 sur 3</div>
    <input class="search" id="q" placeholder="Rechercher une ligne ou un arrêt" value="${esc(q || "")}" autocomplete="off">`;
  if (!S.catalog) return h + `<div class="msg">Réseau TaM en cours de chargement…</div>`;
  const n = s => s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
  const k = n((q || "").trim());
  const ls = S.catalog.lignes.filter(l => !k || n(l.short + " " + l.long).includes(k) || l.directions.some(d => d.stops.some(s => n(s.name).includes(k))));
  if (k.length >= 2) {
    const vus = new Set(), arrets = [];
    for (const l of S.catalog.lignes) for (const d of l.directions) for (const st of d.stops) {
      const nn = norm(st.name);
      if (!vus.has(nn) && n(st.name).includes(k)) { vus.add(nn); arrets.push(st.name); }
    }
    arrets.sort((a, b) => (n(a).startsWith(k) ? 0 : 1) - (n(b).startsWith(k) ? 0 : 1));
    if (arrets.length) h += `<div class="stitle">ARRÊTS</div><div class="group">${arrets.slice(0, 8).map(a => `<a class="item" href="#/arret/${encodeURIComponent(a)}" style="color:inherit">📍<div class="grow ell" style="font-size:15px">${nice(a)}</div><span class="dest">toutes les lignes ›</span></a>`).join("")}</div><div class="stitle">LIGNES</div>`;
  }
  h += `<div class="group">${ls.map(l => `<a class="item" href="#/ajout/${encodeURIComponent(l.routeId)}" style="color:inherit">
    <span style="width:44px">${pill(l)}</span><div class="grow"><div class="ell" style="font-size:15px;font-weight:500">${nice(l.long || l.directions.map(d => d.headsign).join(" ↔ "))}</div>
    <div class="dest" style="font-size:12px">${l.type === 0 ? "Tramway" : "Bus"}</div></div><span class="chev">›</span></a>`).join("") || `<div class="msg">Aucun résultat</div>`}</div>`;
  return h;
}

function viewSens(l) {
  if (l.directions.length === 1) { location.replace(`#/ajout/${encodeURIComponent(l.routeId)}/${l.directions[0].dir}`); return ""; }
  return `<div class="nav"><a href="#/ajout">‹ Lignes</a></div><h1>Quel sens ?</h1><div class="sub">Étape 2 sur 3 · ligne ${esc(l.short)}</div>
    <div class="group">${l.directions.map(d => `<a class="item" href="#/ajout/${encodeURIComponent(l.routeId)}/${d.dir}" style="color:inherit">${pill(l)}
    <div class="grow"><div class="stop ell">→ ${nice(d.headsign)}</div><div class="dest">depuis ${nice(d.stops[0]?.name)} · ${d.stops.length} arrêts</div></div><span class="chev">›</span></a>`).join("")}</div>`;
}

function viewArret(l, d) {
  const have = new Set(S.favoris.map(f => f.key));
  return `<div class="nav"><a href="#/ajout/${encodeURIComponent(l.routeId)}">‹ ${l.directions.length > 1 ? "Sens" : "Lignes"}</a></div>
    <h1>Quel arrêt ?</h1><div class="sub">Étape 3 sur 3 · ligne ${esc(l.short)} → ${nice(d.headsign)}</div>
    <div class="group" style="--lc:#${esc(l.color)}">${d.stops.map((s, i) => {
      const k = E.quaiKey(l.routeId, d.dir, s.id), on = have.has(k);
      return `<button class="st ${i === 0 ? "first" : ""} ${i === d.stops.length - 1 ? "last" : ""}" data-add="${esc(s.id)}" ${on ? "disabled" : ""}>
        <span class="rail"></span><span class="grow ell" style="font-size:15px">${nice(s.name)}</span>${on ? `<span class="ok">✓</span>` : ""}</button>`;
    }).join("")}</div><div class="gfoot">Touche un arrêt pour l'ajouter. Les arrêts déjà suivis sont cochés.</div>`;
}

function viewSuivi(key) {
  const f = S.favoris.find(x => x.key === key);
  if (!f) return `<div class="nav"><a href="#/">‹ Accueil</a></div><div class="msg">Arrêt introuvable.</div>`;
  const now = S.now, b = E.board(S.routes[f.routeId], live() ? S.rt : null, now, f);
  const ps = b.passages.filter(p => !p.canceled), first = ps[0];
  const l = ligne(f.routeId), d = l && l.directions.find(x => x.dir === f.dir);
  const t = d ? E.track(f, d.stops, live() ? S.feed : null, b.passages, now, 4, 4, 4, live() ? S.vehicles : []) : null;
  const tram = f.type === 0;
  let h = `<div class="nav"><a href="#/">‹ Accueil</a></div>
    <div class="row">${pill(f)}<h1 class="t2 ell">${short(f.stopName)}</h1></div>
    <div class="sub"><span class="dot ${live() ? "live" : ""}" style="${live() ? "" : "background:var(--warn)"}"></span>→ ${short(f.headsign)} · ${live() ? `positions ${t && t.buses.some(b => b.gps) ? "GPS " : ""}en direct · ${E.hour(S.rtAt)}` : "positions indisponibles"}</div>
    <a class="chipbtn" href="#/arret/${encodeURIComponent(f.stopName)}">🚏 Toutes les lignes à ${short(f.stopName)} ›</a>
    <div class="card row" style="padding:14px 16px"><div class="grow">
      <div style="font-size:30px;font-weight:700;letter-spacing:-.7px" class="${first && first.realtime ? "" : "th"}">${first ? (first.realtime ? "" : "≈ ") + E.wait(first.time, now) : "—"}</div>
      ${first ? `<div class="dest">prochain ${tram ? "tram" : "bus"} · ${E.hourWithDay(first.time, now)}</div>` : ""}</div>
      ${ps.length > 1 ? `<div style="text-align:right"><div class="dest">puis</div><div style="font-weight:600">${ps.slice(1, 3).map(p => (p.realtime ? "" : "≈ ") + E.wait(p.time, now)).join(" · ")}</div></div>` : ""}</div>`;
  if (!t) return h + `<div class="msg">Tracé indisponible pour l'instant.</div>`;
  const lc = "#" + f.color;
  h += `<div class="card" style="padding:0;--lc:${lc};--lcf:color-mix(in srgb,${lc} 30%,transparent)">`;
  if (t.far.length) {
    h += `<div class="far"><span class="lbl">À venir</span>${t.far.map(v => `<span class="v"><span class="mini" style="background:${lc};opacity:${v.realtime ? 1 : .5}">${glyph(tram, 13)}</span>${v.realtime ? "" : "≈ "}${E.wait(v.eta, now)}</span>`).join("")}</div>`;
  }
  h += `<div class="track">${t.stops.map((s, i) => `<div class="tr ${i === 0 ? "first" : ""} ${i === t.stops.length - 1 ? "last" : ""} ${i === t.myIndex ? "me" : ""} ${i > t.myIndex ? "after" : ""}">
    <span class="rail"></span><span class="n ell">${nice(s.name)}</span>${i === t.myIndex ? `<span class="me-tag">TON ARRÊT</span>` : ""}</div>`).join("")}
    ${(() => { // Terminus de la ligne, sous ton arrêt
      const term = d.terminus || d.headsign.split(" · ")[0];
      const lastId = t.stops[t.stops.length - 1].id, li = d.stops.findIndex(x => x.id === lastId);
      const reste = li >= 0 ? Math.max(0, d.stops.length - 1 - li) : 0;
      return `<div class="tr after last term"><span class="rail"></span><span class="grow"><span class="n ell">${nice(term)}</span><br><span class="dest" style="font-size:12px">Terminus${reste ? ` · ${reste} arrêt${reste > 1 ? "s" : ""} plus loin` : ""}</span></span></div>`;
    })()}
    ${t.buses.map(v => `<div class="bus ${v.estimated ? "est" : ""}" style="top:${Math.max(2, 6 + 54 * (v.index - 1) + 27 + 54 * v.frac - 15)}px"><span class="b" style="background:${lc}">${glyph(tram)}${v.gps ? `<i class="gps"></i>` : ""}</span>
      <span class="eta ${v.realtime ? "" : "th"}">${v.realtime ? "" : "≈ "}${E.wait(v.eta, now)}</span></div>`).join("")}</div></div>
    <div class="gfoot">${!t.buses.length && !t.far.length ? "Aucun passage prévu pour l'instant." : "Chaque pastille sur le tracé est un véhicule en route, avec son temps d'arrivée à ton arrêt. Point vert : position GPS réelle. Pastille pâle : position estimée d'après l'horaire. « À venir » : pas encore sur ce tronçon. Mise à jour toutes les 30 s."}</div>`;
  return h;
}

const shareLink = () => location.href.split("#")[0] + "#/import/" + E.encodeShare(S.favoris);

function viewPartage() {
  const link = shareLink();
  let qr = "";
  try { const q = qrcode(0, "M"); q.addData(link); q.make(); qr = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); } catch (e) {}
  return `<div class="nav"><a href="#/arrets">‹ Mes arrêts</a></div><h1>Partager mes arrêts</h1>
    <div class="sub">${S.favoris.length} arrêts et leur ordre</div>
    <div class="card" style="text-align:center"><div class="qr">${qr}</div>
      <p class="dest" style="margin-top:12px;line-height:19px">Scanne ce code avec l'appareil photo de l'autre téléphone, ou ouvre le lien sur un autre appareil : tes arrêts y sont copiés.</p></div>
    <button class="btn" data-copy>Copier le lien</button>
    ${navigator.share ? `<button class="btn s" data-share>Envoyer… (SMS, WhatsApp, e-mail)</button>` : ""}
    <div class="gfoot" style="text-align:center">Le lien contient seulement la liste des arrêts. Aucun compte, rien n'est stocké en ligne.</div>`;
}

let pendingImport = null;
function viewImport(payload) {
  const items = E.decodeShare(payload).slice(0, MAX);
  pendingImport = items.map(x => {
    const l = ligne(x.routeId), d = l && l.directions.find(y => y.dir === x.dir), st = d && d.stops.find(y => y.id === x.stopId);
    return { key: E.quaiKey(x.routeId, x.dir, x.stopId), routeId: x.routeId, short: l ? l.short : x.routeId, color: l ? l.color : "8A8A8E",
      textColor: l ? l.textColor : "FFFFFF", type: l ? l.type : 3, dir: x.dir, stopId: x.stopId, stopName: st ? st.name : x.stopId,
      headsign: d ? d.headsign : "?", star: x.star };
  });
  if (!pendingImport.length) return `<div class="nav"><a href="#/">‹ Accueil</a></div><div class="msg">Lien de partage illisible.</div>`;
  const have = new Set(S.favoris.map(f => f.key));
  return `<div class="nav"><a href="#/">‹ Annuler</a></div><h1>Arrêts reçus</h1><div class="sub">${pendingImport.length} arrêt(s) partagé(s) avec toi</div>
    <div class="group">${pendingImport.map(q => `<div class="item">${pill(q, true)}<div class="grow"><div class="ell" style="font-weight:600;font-size:15px">${nice(q.stopName)}</div>
      <div class="dest ell" style="font-size:12px">→ ${nice(q.headsign)}</div></div>${have.has(q.key) ? `<span class="dest">déjà suivi</span>` : ""}</div>`).join("")}</div>
    <div style="height:16px"></div>
    <button class="btn" data-import="add">Ajouter à ma liste</button>
    <button class="btn s" data-import="replace">Remplacer ma liste</button>
    ${isAndroid ? `<a class="btn s" href="tamtomove://import/${esc(payload)}">Ouvrir dans l'appli TaM to Move</a>
      <a class="btn s" href="${APK}">Télécharger l'appli Android</a>` : ""}
    <div class="gfoot" style="text-align:center">10 arrêts au maximum. Tes arrêts restent dans ce navigateur.</div>`;
}

// Écran par arrêt : toutes les lignes et sens, ＋ pour suivre
function viewStation(name) {
  const back = `<div class="nav"><a href="#/">‹ Accueil</a></div>`;
  if (!S.catalog) return back + `<div class="msg">Réseau TaM en cours de chargement…</div>`;
  const qs = stationQuais(name), now = S.now;
  const rt = live() && S.feed ? E.predictions(S.routes, qs, S.feed, now) : null;
  const suivis = new Set(S.favoris.map(f => f.key));
  let h = back + `<h1>${nice(name)}</h1><div class="sub"><span class="dot ${rt ? "live" : ""}" style="${rt ? "" : "background:var(--warn)"}"></span>${qs.length} ligne${qs.length > 1 ? "s" : ""} et sens · ${rt ? "en direct" : "horaires théoriques"}</div>`;
  if (!qs.length) return h + `<div class="msg">Aucune ligne trouvée pour cet arrêt.</div>`;
  h += `<div class="group">${qs.map(q => {
    const b = E.board(S.routes[q.routeId], rt, now, q, 3);
    const ps = b.passages.filter(p => !p.canceled).slice(0, 3);
    const txt = !S.routes[q.routeId] ? "Chargement…" : ps.length ? ps.map(p => (p.realtime ? "" : "≈ ") + E.wait(p.time, now)).join(" · ") : "Pas de passage prévu";
    const act = suivis.has(q.key) ? `<a class="dest" href="#/suivi/${encodeURIComponent(q.key)}">✓ suivi ›</a>`
      : `<button class="round plusb" data-addq="${esc(q.key)}" aria-label="Suivre">+</button>`;
    return `<div class="item"><span style="width:44px">${pill(q)}</span><div class="grow"><div class="ell" style="font-weight:600;font-size:15px">→ ${nice(q.headsign)}</div><div class="dest ell" style="font-size:13px">${txt}</div></div>${act}</div>`;
  }).join("")}</div><div class="gfoot">Touche ＋ pour suivre une ligne dans ce sens : elle rejoint ton accueil (10 arrêts au maximum). « ≈ » : heure théorique.</div>`;
  return h;
}

// « J'arrive » : la personne qui reçoit le lien voit ce bus arriver, en direct
function viewArrivee() {
  const a = arriveeInfo();
  const nav = `<div class="nav"><a href="#/">TaM to Move</a></div>`;
  if (!a) return nav + `<div class="msg">Lien « J'arrive » illisible.</div>`;
  const l = ligne(a.routeId), d = l && l.directions.find(x => x.dir === a.dir);
  if (!S.catalog) return nav + `<div class="msg">Chargement du réseau TaM…</div>`;
  if (!d) return nav + `<div class="msg">Ligne introuvable.</div>`;
  const stops = [...d.stops, ...(d.terminusId ? [{ id: d.terminusId, name: d.terminus }] : [])];
  const now = S.now, r = E.arrivee(a, S.routes[a.routeId], live() ? S.feed : null, live() ? S.vehicles : [], stops, now);
  const tram = ["1", "2", "3", "4", "5"].includes(String(l.short).trim());
  const veh = tram ? "tram" : String(l.short).trim().toUpperCase() === "A" ? "bustram" : "bus";
  const qui = a.name ? esc(a.name) : "Ton contact";
  const dest = nice(r.dest || "son arrêt");
  let h = nav + `<div class="row" style="gap:10px;margin:6px 0 4px">${pill(l)}<h1 style="margin:0">${qui} arrive</h1></div>
    <div class="sub">en ${veh} ${esc(l.short)} → ${dest}</div>`;
  if (r.arrived) {
    h += `<div class="card"><div style="font-size:30px;font-weight:700">Arrivé ✓</div><div class="dest">${qui} est arrivé${a.name ? "" : "(e)"} à ${dest}${r.eta ? ` vers ${E.hour(r.eta)}` : ""}. Le suivi est terminé.</div></div>`;
  } else {
    h += `<div class="card"><div class="dest">Arrivée prévue à ${dest}</div>
      <div style="font-size:34px;font-weight:700;letter-spacing:-.8px" class="${r.realtime ? "" : "th"}">${r.eta ? (r.realtime ? "" : "≈ ") + E.hour(r.eta) : "—"}</div>
      <div class="dest">${r.eta ? E.wait(r.eta, now) : ""}${r.restants != null ? ` · ${r.restants === 0 ? "prochain arrêt" : `${r.restants} arrêt${r.restants > 1 ? "s" : ""} avant`}` : ""}</div>
      <div class="dest" style="margin-top:6px"><span class="dot ${r.realtime ? "live" : ""}" style="${r.realtime ? "" : "background:var(--warn)"}"></span>${r.realtime ? (r.gps ? "Position GPS en direct" : "En direct") : "Heure prévue (direct TaM indisponible)"}${S.rtAt ? ` · mis à jour à ${E.hour(S.rtAt)}` : ""}</div></div>`;
    if (r.prochains.length) {
      h += `<div class="card" style="padding:6px 0;--lc:#${esc(l.color)};--lcf:color-mix(in srgb,#${esc(l.color)} 30%,transparent)"><div class="track">${r.prochains.slice(-6).map((n, i, all) =>
        `<div class="tr ${i === 0 ? "first" : ""} ${i === all.length - 1 ? "last me" : ""}"><span class="rail"></span><span class="n ell">${nice(n)}</span>${i === all.length - 1 ? `<span class="me-tag">DESCENTE</span>` : ""}</div>`).join("")}</div></div>`;
    }
  }
  h += `<div class="gfoot">Seul le ${veh} est suivi, grâce aux données publiques de la TaM : la position de ${qui} n'est pas partagée. Mise à jour toutes les 30 s.</div>
    ${isAndroid ? `<a class="btn s" href="${APK}">Installer TaM to Move sur Android</a>` : ""}`;
  return h;
}

let lastQuery = "";
function render() {
  S.now = Date.now() / 1000;
  const p = decodeURIComponent(location.hash.slice(1) || "/").split("/").filter(Boolean);
  let h;
  if (p[0] === "arrets") h = viewArrets();
  else if (p[0] === "ajout" && p[1]) {
    const l = ligne(p[1]);
    if (!l) h = viewAjout(lastQuery);
    else if (p[2] == null) h = viewSens(l);
    else { const d = l.directions.find(x => x.dir === +p[2]); h = d ? viewArret(l, d) : viewSens(l); }
  } else if (p[0] === "ajout") h = viewAjout(lastQuery);
  else if (p[0] === "suivi") h = viewSuivi(p.slice(1).join("/"));
  else if (p[0] === "partage") h = viewPartage();
  else if (p[0] === "import") h = viewImport(p[1] || "");
  else if (p[0] === "arrivee") h = viewArrivee();
  else if (p[0] === "arret" && p[1]) h = viewStation(p.slice(1).join("/"));
  else h = viewHome();
  const app = $("#app");
  // Ne pas reconstruire la page pendant une saisie (garde le clavier ouvert)
  if (document.activeElement && document.activeElement.id === "q" && p[0] === "ajout" && !p[1]) return;
  app.innerHTML = h;
}

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), 2600);
}

// ---------------------------------------------------------------- Actions

document.addEventListener("click", async e => {
  const el = e.target.closest("[data-del],[data-mv],[data-add],[data-addq],[data-copy],[data-share],[data-import]");
  if (!el) return;
  if (el.dataset.copy != null) {
    try { await navigator.clipboard.writeText(shareLink()); toast("Lien copié"); } catch (x) { prompt("Copie ce lien :", shareLink()); }
    return;
  }
  if (el.dataset.share != null) {
    try { await navigator.share({ title: "Mes arrêts TaM", text: "Mes arrêts TaM sur TaM to Move", url: shareLink() }); } catch (x) {}
    return;
  }
  if (el.dataset.import != null && pendingImport) {
    const replace = el.dataset.import === "replace";
    const base = replace ? [] : S.favoris;
    const add = pendingImport.filter(n => !base.some(f => f.key === n.key));
    S.favoris = [...base, ...add].slice(0, MAX); save();
    toast(replace ? `Liste remplacée : ${S.favoris.length} arrêts` : `${Math.min(add.length, MAX - base.length)} arrêt(s) ajouté(s)`);
    pendingImport = null; location.hash = "#/"; refresh();
    return;
  }
  if (el.dataset.addq != null) {
    const q = stationQuais(stationName() || "").find(x => x.key === el.dataset.addq);
    if (!q || S.favoris.some(f => f.key === q.key)) return;
    if (S.favoris.length >= MAX) return toast("10 arrêts maximum : retires-en un d'abord.");
    S.favoris.push(q); save(); toast(`Ajouté : ${q.short} → ${q.headsign.split(" · ")[0]}`); refresh();
    return;
  }
  if (el.dataset.del != null) {
    S.favoris.splice(+el.dataset.del, 1); save(); render();
  } else if (el.dataset.mv != null) {
    const i = +el.dataset.mv, j = i + +el.dataset.d;
    if (j >= 0 && j < S.favoris.length) { const [x] = S.favoris.splice(i, 1); S.favoris.splice(j, 0, x); save(); render(); }
  } else if (el.dataset.add != null) {
    const p = decodeURIComponent(location.hash.slice(1)).split("/").filter(Boolean);
    const l = ligne(p[1]), d = l && l.directions.find(x => x.dir === +p[2]), s = d && d.stops.find(x => x.id === el.dataset.add);
    if (!s) return;
    if (S.favoris.length >= MAX) return toast("10 arrêts maximum : retires-en un d'abord.");
    S.favoris.push({ key: E.quaiKey(l.routeId, d.dir, s.id), routeId: l.routeId, short: l.short, color: l.color, textColor: l.textColor,
      type: l.type, dir: d.dir, stopId: s.id, stopName: s.name, headsign: d.headsign });
    save(); toast(`Ajouté : ${l.short} · ${s.name}`);
    location.hash = "#/arrets";
    refresh();
  }
});
document.addEventListener("input", e => {
  if (e.target.id !== "q") return;
  lastQuery = e.target.value;
  const el = e.target, pos = el.selectionStart;
  el.blur(); render(); const n = $("#q"); n.focus(); n.setSelectionRange(pos, pos);
});
addEventListener("hashchange", () => { render(); scrollTo(0, 0); if (arriveeInfo() || stationName()) refresh(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });

// ---------------------------------------------------------------- Démarrage

render();
loadCatalog().then(refresh);
setInterval(() => { if (!document.hidden) refresh(); }, 30000);
setInterval(() => { if (!document.hidden) render(); }, 15000);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
