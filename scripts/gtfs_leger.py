"""Horaires TaM allégés pour l'appli Android.

Le GTFS de la TaM (~7,5 Mo) contient beaucoup de fichiers et de colonnes que l'appli ne lit pas.
On garde seulement ce qu'elle utilise, recompressé au maximum, dans un zip au contenu identique
d'une nuit à l'autre si les horaires n'ont pas changé (même taille = pas de retéléchargement).

Usage : python3 scripts/gtfs_leger.py site/gtfs-leger.zip [GTFS.zip local]
"""
import csv, datetime, io, sys, urllib.request, zipfile

GTFS = "https://gtfsproxy.e-tam.fr/COMMON/GTFS.zip"
# Fichiers et colonnes lus par l'appli (GtfsImporter.kt)
GARDER = {
    "routes.txt": ["route_id", "route_short_name", "route_long_name", "route_type", "route_color", "route_text_color"],
    "trips.txt": ["route_id", "service_id", "trip_id", "trip_headsign", "direction_id"],
    "stops.txt": ["stop_id", "stop_name", "stop_lat", "stop_lon"],
    "stop_times.txt": ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"],
    "calendar.txt": None,          # petit : gardé entier
    "calendar_dates.txt": None,
}


# Seules les courses qui circulent dans les 35 prochains jours sont gardées (l'appli vérifie chaque jour)
FENETRE = 35


def services_actifs(src, noms):
    """Services qui circulent au moins un jour entre hier et hier + FENETRE."""
    debut = datetime.date.today() - datetime.timedelta(days=1)
    jours = [debut + datetime.timedelta(days=i) for i in range(FENETRE + 1)]
    cles = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    actifs = set()
    if "calendar.txt" in noms:
        for r in csv.DictReader(io.StringIO(src.read(noms["calendar.txt"]).decode("utf-8-sig"))):
            r = {k.strip(): (v or "").strip() for k, v in r.items()}
            for j in jours:
                d = j.strftime("%Y%m%d")
                if r.get(cles[j.weekday()]) == "1" and (not r.get("start_date") or r["start_date"] <= d) and (not r.get("end_date") or d <= r["end_date"]):
                    actifs.add(r["service_id"]); break
    if "calendar_dates.txt" in noms:
        fin = jours[-1].strftime("%Y%m%d"); deb = jours[0].strftime("%Y%m%d")
        for r in csv.DictReader(io.StringIO(src.read(noms["calendar_dates.txt"]).decode("utf-8-sig"))):
            r = {k.strip(): (v or "").strip() for k, v in r.items()}
            if r.get("exception_type") == "1" and deb <= r.get("date", "") <= fin:
                actifs.add(r["service_id"])
    return actifs


def main():
    sortie = sys.argv[1]
    data = open(sys.argv[2], "rb").read() if len(sys.argv) > 2 else urllib.request.urlopen(
        urllib.request.Request(GTFS, headers={"User-Agent": "TamToMove-pages"}), timeout=120).read()
    src = zipfile.ZipFile(io.BytesIO(data))
    noms = {n.rsplit("/", 1)[-1]: n for n in src.namelist()}
    actifs = services_actifs(src, noms)
    courses = set()
    for r in csv.DictReader(io.StringIO(src.read(noms["trips.txt"]).decode("utf-8-sig"))):
        r = {k.strip(): (v or "").strip() for k, v in r.items()}
        if r["service_id"] in actifs:
            courses.add(r["trip_id"])
    print(f"Services actifs sur {FENETRE} jours : {len(actifs)} ; courses gardées : {len(courses)}")
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for nom, cols in GARDER.items():
            if nom not in noms:
                continue
            texte = src.read(noms[nom]).decode("utf-8-sig")
            lecteur = csv.reader(io.StringIO(texte))
            tete = [c.strip() for c in next(lecteur)]
            garde = [i for i, c in enumerate(tete) if cols is None or c in cols]
            # Filtre des courses hors période (trips et stop_times), lignes et arrêts gardés entiers
            filtre = tete.index("trip_id") if nom in ("trips.txt", "stop_times.txt") else (tete.index("service_id") if nom in ("calendar.txt", "calendar_dates.txt") else None)
            valeurs = courses if nom in ("trips.txt", "stop_times.txt") else actifs
            n_in = n_out = 0
            buf = io.StringIO()
            w = csv.writer(buf, lineterminator="\n")
            w.writerow([tete[i] for i in garde])
            for ligne in lecteur:
                if not ligne:
                    continue
                n_in += 1
                if filtre is not None and (ligne[filtre].strip() if filtre < len(ligne) else "") not in valeurs:
                    continue
                n_out += 1
                w.writerow([ligne[i].strip() if i < len(ligne) else "" for i in garde])
            print(f"  {nom} : {n_out}/{n_in} lignes")
            # Date fixe : le zip ne change que si les horaires changent
            info = zipfile.ZipInfo(nom, date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, buf.getvalue().encode("utf-8"), compresslevel=9)
    open(sortie, "wb").write(out.getvalue())
    print(f"GTFS TaM : {len(data)} octets → allégé : {len(out.getvalue())} octets ({100 * len(out.getvalue()) // len(data)} %)")


if __name__ == "__main__":
    main()
