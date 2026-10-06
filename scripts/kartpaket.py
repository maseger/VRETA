#!/usr/bin/env python3
"""Packar ett eller flera kartlager till en enda fil som appen läser in med ett tryck.

Varje lager är en bild och en hörnfil från prepare-basemap.py. Bilden görs om till WebP
så att paketet blir litet nog för mobilen. Läs in paketet under
Vreta → Lägg till kartlager → Kartpaket.

    python3.12 scripts/kartpaket.py ut/vreta-kartpaket.json \\
      --lager "Baskarta" base 2021-06-07 ut/baskarta.png ut/baskarta.json \\
      --lager "Situationsplan" overlay 2021-12-02 ut/situationsplan.png ut/situationsplan.json

Grundbilden (base) ska komma först. Paketet visar fastighetens läge – lägg det aldrig i repot.
"""
import argparse
import base64
import json
import os
import sys

try:
    from osgeo import gdal
except ImportError:
    sys.exit("GDAL saknas för den här Python-versionen – prova python3.12 eller installera python3-gdal.")

gdal.UseExceptions()
gdal.SetConfigOption("GDAL_PAM_ENABLED", "NO")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out", help="Paketfil (.json)")
    ap.add_argument("--lager", nargs=5, action="append", required=True, metavar=("NAMN", "TYP", "DATUM", "BILD", "HÖRNFIL"),
                    help="TYP är base eller overlay, DATUM ÅÅÅÅ-MM-DD eller -")
    ap.add_argument("--kvalitet", type=int, default=85, help="WebP-kvalitet 1–100 (standard 85)")
    args = ap.parse_args()

    layers = []
    for name, kind, date, image, corners_file in args.lager:
        if kind not in ("base", "overlay"):
            sys.exit(f"Okänd typ {kind!r} – använd base eller overlay.")
        with open(corners_file, encoding="utf-8") as f:
            meta = json.load(f)
        webp = f"/vsimem/{os.path.basename(image)}.webp"
        gdal.Translate(webp, image, format="WEBP", creationOptions=[f"QUALITY={args.kvalitet}"])
        data = gdal.VSIFOpenL(webp, "rb")
        gdal.VSIFSeekL(data, 0, 2)
        size = gdal.VSIFTellL(data)
        gdal.VSIFSeekL(data, 0, 0)
        raw = gdal.VSIFReadL(1, size, data)
        gdal.VSIFCloseL(data)
        gdal.Unlink(webp)
        layers.append({
            "name": name,
            "kind": kind,
            "taken_on": None if date == "-" else date,
            "corners": meta["corners"],
            "source_crs": meta.get("source_crs", ""),
            "image": "data:image/webp;base64," + base64.b64encode(raw).decode("ascii"),
        })
        print(f"{name}: {size // 1024} kB")

    layers.sort(key=lambda l: l["kind"] != "base")  # grundbilden först
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"format": "vreta-kartpaket", "version": 1, "layers": layers}, f, ensure_ascii=False)
    print(f"Klart: {args.out} ({os.path.getsize(args.out) // 1024} kB)")


if __name__ == "__main__":
    main()
