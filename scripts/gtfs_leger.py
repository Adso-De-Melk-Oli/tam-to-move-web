"""Horaires TaM allégés pour l'appli Android.

Le GTFS de la TaM (~7,5 Mo) contient beaucoup de fichiers et de colonnes que l'appli ne lit pas.
On garde seulement ce qu'elle utilise, recompressé au maximum, dans un zip au contenu identique
d'une nuit à l'autre si les horaires n'ont pas changé (même taille = pas de retéléchargement).

Usage : python3 scripts/gtfs_leger.py site/gtfs-leger.zip [GTFS.zip local]
"""
import csv, io, sys, urllib.request, zipfile

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


def main():
    sortie = sys.argv[1]
    data = open(sys.argv[2], "rb").read() if len(sys.argv) > 2 else urllib.request.urlopen(
        urllib.request.Request(GTFS, headers={"User-Agent": "TamToMove-pages"}), timeout=120).read()
    src = zipfile.ZipFile(io.BytesIO(data))
    noms = {n.rsplit("/", 1)[-1]: n for n in src.namelist()}
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for nom, cols in GARDER.items():
            if nom not in noms:
                continue
            texte = src.read(noms[nom]).decode("utf-8-sig")
            lecteur = csv.reader(io.StringIO(texte))
            tete = [c.strip() for c in next(lecteur)]
            garde = [i for i, c in enumerate(tete) if cols is None or c in cols]
            buf = io.StringIO()
            w = csv.writer(buf, lineterminator="\n")
            w.writerow([tete[i] for i in garde])
            for ligne in lecteur:
                if ligne:
                    w.writerow([ligne[i].strip() if i < len(ligne) else "" for i in garde])
            # Date fixe : le zip ne change que si les horaires changent
            info = zipfile.ZipInfo(nom, date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, buf.getvalue().encode("utf-8"), compresslevel=9)
    open(sortie, "wb").write(out.getvalue())
    print(f"GTFS TaM : {len(data)} octets → allégé : {len(out.getvalue())} octets ({100 * len(out.getvalue()) // len(data)} %)")


if __name__ == "__main__":
    main()
