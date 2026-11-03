# Diagnostic : compare, pour chaque ligne et sens, le parcours retenu au parcours le plus long du GTFS.
import csv, io, json, sys, zipfile
from collections import defaultdict, Counter
z = zipfile.ZipFile(sys.argv[1]); cat = json.load(open(sys.argv[2]))
def rows(n): return csv.DictReader(io.TextIOWrapper(z.open(n), "utf-8-sig"))
names = {r["stop_id"]: r["stop_name"] for r in rows("stops.txt")}
routes = {r["route_id"]: r for r in rows("routes.txt")}
trips = {r["trip_id"]: (r["route_id"], int(r.get("direction_id") or 0)) for r in rows("trips.txt")}
st = defaultdict(list)
for r in rows("stop_times.txt"):
    st[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"]))
pat = defaultdict(Counter)
for t, v in st.items():
    if t in trips: pat[trips[t]][tuple(s for _, s in sorted(v))] += 1
for l in cat["lignes"]:
    rid = l["routeId"]; print(f"== {l['short']} « {routes[rid]['route_long_name']} »")
    for d in l["directions"]:
        c = pat[(rid, d["dir"])]
        longest = max(c, key=len)
        chosen = [s["id"] for s in d["stops"]]
        top = c.most_common(4)
        flag = "" if len(chosen) + 1 >= len(longest) else "  <<< PLUS COURT que le plus long"
        print(f"  sens {d['dir']} → {d['headsign']} : {len(chosen)+1} arrêts, {names.get(chosen[0])} … ; plus long {len(longest)} ({names.get(longest[0])} → {names.get(longest[-1])}, {c[longest]} trajets){flag}")
        for p, n in top: print(f"      {n:4d} trajets · {len(p):2d} arrêts · {names.get(p[0])} → {names.get(p[-1])}")
