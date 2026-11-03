#!/usr/bin/env python3
"""
Prépare les données de la page web (lancé chaque jour par GitHub Actions) :
  site/data/catalog.json   lignes → sens → arrêts (dans l'ordre)
  site/data/r/<ligne>.json horaires théoriques de chaque ligne, alignés sur les arrêts du catalogue
Usage : python3 scripts/build_data.py [dossier_sortie] [gtfs.zip local]
"""
import csv, io, json, os, sys, time, unicodedata, urllib.request, zipfile
from collections import defaultdict

GTFS = "https://gtfsproxy.e-tam.fr/COMMON/GTFS.zip"


def norm(s):
    return unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode().lower()


def pretty(s):
    if norm(s).strip() == "euromedecine":
        return "Euromédecine"
    letters = [c for c in s if c.isalpha()]
    if not letters or sum(c.isupper() for c in letters) * 10 < len(letters) * 8:
        return s
    return " ".join(w[:1].upper() + w[1:] for w in s.lower().split(" "))


def parse_time(t):
    p = (t or "").strip().split(":")
    try:
        return int(p[0]) * 3600 + int(p[1]) * 60 + (int(p[2]) if len(p) > 2 else 0)
    except (ValueError, IndexError):
        return None


def rows(z, name):
    match = [n for n in z.namelist() if n.split("/")[-1] == name]
    if not match:
        return
    with z.open(match[0]) as f:
        for r in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")):
            yield {k.strip(): (v or "").strip() for k, v in r.items() if k}


def safe(rid):
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in rid)


def build(z, out):
    routes = {}
    for r in rows(z, "routes.txt"):
        rid = r["route_id"]
        rt = r.get("route_type") or "3"
        routes[rid] = dict(short=r.get("route_short_name") or rid, long=pretty(r.get("route_long_name", "")),
                           color=r["route_color"].upper() if len(r.get("route_color", "")) == 6 else "8A8A8E",
                           text=r["route_text_color"].upper() if len(r.get("route_text_color", "")) == 6 else "FFFFFF",
                           type=int(rt) if rt.isdigit() else 3)
    trips, girouette = {}, {}
    for r in rows(z, "trips.txt"):
        trips[r["trip_id"]] = (r.get("route_id", ""), r.get("service_id", ""), int(r.get("direction_id") or 0))
        girouette[r["trip_id"]] = (r.get("trip_headsign") or "").strip()
    names, pos = {}, {}
    for r in rows(z, "stops.txt"):
        names[r["stop_id"]] = r.get("stop_name", "")
        try:
            pos[r["stop_id"]] = (round(float(r["stop_lat"]), 6), round(float(r["stop_lon"]), 6))
        except (KeyError, ValueError):
            pass

    # Une seule lecture de stop_times : on garde (seq, arrêt, heure) par trajet
    st = defaultdict(list)
    for r in rows(z, "stop_times.txt"):
        tid = r.get("trip_id")
        if tid in trips:
            t = parse_time(r.get("departure_time") or r.get("arrival_time"))
            st[tid].append((int(r.get("stop_sequence") or -1), r.get("stop_id"), t))
    for v in st.values():
        v.sort()

    # Trajet type par ligne et sens : parcours du jour (travaux, déviations (travaux, déviations
    # publiées par la TaM), sinon sur toute la période ; à égalité le plus long, puis le plus petit identifiant.
    from datetime import datetime
    from zoneinfo import ZoneInfo
    today = datetime.now(ZoneInfo("Europe/Paris")).date()
    tstr = today.strftime("%Y%m%d")
    dow = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"][today.weekday()]
    active = set()
    for r in rows(z, "calendar.txt"):
        if r.get(dow) == "1" and (r.get("start_date") or "0") <= tstr <= (r.get("end_date") or "99999999"):
            active.add(r["service_id"])
    for r in rows(z, "calendar_dates.txt"):
        if r.get("date") == tstr:
            if r.get("exception_type") == "1":
                active.add(r["service_id"])
            elif r.get("exception_type") == "2":
                active.discard(r["service_id"])
    by_line = defaultdict(list)
    for tid in st:
        route, service, d = trips[tid]
        by_line[(route, d)].append(tid)
    rep = {}
    for k, ids in by_line.items():
        pool = [t for t in ids if trips[t][1] in active] or ids
        groups = defaultdict(list)
        for t in pool:
            groups[tuple(x[1] for x in st[t])].append(t)
        # Parcours complet : le plus long parmi les parcours fréquents du jour (les services partiels,
        # dépôt ou fin de ligne anticipée, sont plus courts ; les variantes rares sont écartées)
        maxc = max(len(g) for g in groups.values())
        seuil = max(2, int(0.15 * maxc)) if maxc >= 2 else 1
        ok = [g for g in groups.values() if len(g) >= seuil] or list(groups.values())
        best = max(sorted(ok, key=min), key=lambda g: (len(st[g[0]]), len(g)))
        rep[k] = min(best)

    lignes, used_by_route = [], {}
    for rid, m in routes.items():
        dirs, ddata = [], {}
        for d in (0, 1):
            tid = rep.get((rid, d))
            if not tid or len(st[tid]) < 2:
                continue
            seq = [x[1] for x in st[tid]]
            stops = []
            for s in seq[:-1]:
                if s not in stops:
                    stops.append(s)
            idx = {s: i for i, s in enumerate(stops)}
            dirs.append({"dir": d, "headsign": pretty(names.get(seq[-1], "?")), "terminus": pretty(names.get(seq[-1], "?")),
                         "stops": [dict({"id": s, "name": pretty(names.get(s, s))},
                                    **({"lat": pos[s][0], "lon": pos[s][1]} if s in pos else {})) for s in stops]})
            tl = []
            for t2, v in st.items():
                if trips[t2][0] != rid or trips[t2][2] != d:
                    continue
                last = v[-1][1]
                times = [None] * len(stops)
                for _, s, t in v:
                    if s in idx and s != last and t is not None and times[idx[s]] is None:
                        times[idx[s]] = t
                if any(x is not None for x in times):
                    tl.append([trips[t2][1], t2, times])
            tl.sort(key=lambda x: min(t for t in x[2] if t is not None))
            ddata[str(d)] = {"stops": stops, "trips": tl}
        # Lignes en boucle (tram 4) : deux sens vers le même terminus → girouette propre au sens
        # (« Garcia Lorca A » → « Sens A »), puis le premier arrêt desservi : « Sens A · via … »
        if len(dirs) == 2 and norm(dirs[0]["headsign"]) == norm(dirs[1]["headsign"]):
            sets = []
            for x in dirs:
                cnt = defaultdict(int)
                for t2, (r2, _, d2) in trips.items():
                    if r2 == rid and d2 == x["dir"] and girouette.get(t2):
                        cnt[girouette[t2]] += 1
                sets.append([h for h, _ in sorted(cnt.items(), key=lambda kv: -kv[1])])
            propres = [next((h for h in sets[i] if norm(h) not in {norm(o) for o in sets[1 - i]}), None) for i in (0, 1)]
            for i, x in enumerate(dirs):
                base = x["headsign"]
                label = base
                if all(propres):
                    h = propres[i].strip()
                    suf = h[len(base):].strip() if norm(h).startswith(norm(base)) else ""
                    label = "Sens " + suf.upper() if 1 <= len(suf) <= 3 else pretty(h)
                start = x["stops"][0]["name"] if x["stops"] else ""
                via = next((st2["name"] for st2 in x["stops"][1:] if norm(st2["name"]) not in (norm(start), norm(base))), None)
                x["headsign"] = label + (" · via " + via if via else "")
        if dirs:
            lignes.append({"routeId": rid, "short": m["short"], "long": m["long"], "color": m["color"],
                           "textColor": m["text"], "type": m["type"], "directions": dirs, "file": safe(rid)})
            used_by_route[rid] = ddata
    lignes.sort(key=lambda l: (0 if l["type"] == 0 else 1, int(l["short"]) if l["short"].isdigit() else 999, l["short"]))

    services = {}
    for r in rows(z, "calendar.txt"):
        days = "".join("1" if r.get(k) == "1" else "0" for k in
                       ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"])
        services[r["service_id"]] = [days, r.get("start_date", ""), r.get("end_date", "")]
    exc = defaultdict(list)
    for r in rows(z, "calendar_dates.txt"):
        exc[r["service_id"]].append([r.get("date", ""), int(r.get("exception_type") or 0)])

    os.makedirs(f"{out}/r", exist_ok=True)
    now = int(time.time())
    for l in lignes:
        dd = used_by_route[l["routeId"]]
        svc = {t[0] for d in dd.values() for t in d["trips"]}
        data = {"routeId": l["routeId"], "generatedAt": now,
                "services": {s: services.get(s, ["0000000", "", ""]) for s in sorted(svc)},
                "exceptions": {s: exc[s] for s in sorted(svc) if s in exc},
                "dirs": dd}
        with open(f"{out}/r/{l['file']}.json", "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    with open(f"{out}/catalog.json", "w", encoding="utf-8") as f:
        json.dump({"generatedAt": now, "lignes": lignes}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(lignes)} lignes écrites dans {out}")


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "site/data"
    local = sys.argv[2] if len(sys.argv) > 2 else None
    data = open(local, "rb").read() if local else urllib.request.urlopen(
        urllib.request.Request(GTFS, headers={"User-Agent": "TamToMove-web/1.0"}), timeout=120).read()
    build(zipfile.ZipFile(io.BytesIO(data)), out)


if __name__ == "__main__":
    main()
