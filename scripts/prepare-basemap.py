#!/usr/bin/env python3
"""Gör om en georefererad karta (GeoPDF, GeoTIFF) till en grundbild för Vretakartan.

Utdata: <namn>.png (Web Mercator, så att MapLibre ritar den rätt) och <namn>.json med
bildens fyra hörn i WGS 84 och källans koordinatsystem. Ladda upp båda under
Vreta → Lager → Lägg till kartlager → "Jag har en hörnfil".

Kräver GDAL med Python-bindningar (installeras av .claude/hooks/session-start.sh).
Kör med python3.12 om systemets python3 saknar osgeo:

    python3.12 scripts/prepare-basemap.py baskarta.pdf ut/ --dpi 300 --max-px 6000
    python3.12 scripts/prepare-basemap.py karta.tif ut/ --ram-crs EPSG:3011   # ram i SWEREF 99 18 00

Kartfilerna visar fastighetens läge – lägg dem aldrig i repot.
"""
import argparse
import json
import os
import sys

try:
    from osgeo import gdal, osr
except ImportError:
    sys.exit("GDAL saknas för den här Python-versionen – prova python3.12 eller installera python3-gdal.")

gdal.UseExceptions()
gdal.SetConfigOption("GDAL_PAM_ENABLED", "NO")  # inga .aux.xml-filer bredvid utdata


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", help="GeoPDF, GeoTIFF eller annan georefererad raster")
    ap.add_argument("outdir", help="Katalog för PNG och hörnfil")
    ap.add_argument("--dpi", type=int, default=300, help="Upplösning för PDF (standard 300)")
    ap.add_argument("--max-px", type=int, default=6000, help="Största sida i pixlar (standard 6000)")
    ap.add_argument("--name", help="Filnamn utan ändelse (standard: källans namn)")
    ap.add_argument("--hela-bladet", action="store_true", help="Behåll teckenförklaring och marginaler (klipp inte vid kartramen)")
    ap.add_argument("--ram-fran", help="Hämta kartramen från en annan fil med samma blad (t.ex. baskartan)")
    ap.add_argument("--ram-crs", help="Koordinatsystem för kartramen om det skiljer sig från bildens, t.ex. EPSG:3011 (SWEREF 99 18 00)")
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    name = args.name or os.path.splitext(os.path.basename(args.source))[0]
    gdal.SetConfigOption("GDAL_PDF_DPI", str(args.dpi))

    src = gdal.Open(args.source)
    if src is None or not src.GetProjection():
        sys.exit("Källan saknar georeferens. Placera den i stället med tre stödpunkter i appen.")
    srs = osr.SpatialReference(wkt=src.GetProjection())
    source_crs = srs.GetName() or srs.GetAttrValue("PROJCS") or "okänt"

    # GeoPDF från kommuner har ofta en kartram (NEATLINE) – klipp bort teckenförklaring och marginaler
    warp_opts = dict(dstSRS="EPSG:3857", resampleAlg="bilinear", dstAlpha=True)
    neatline = src.GetMetadataItem("NEATLINE")
    if args.ram_fran:
        neatline = gdal.Open(args.ram_fran).GetMetadataItem("NEATLINE")
        if not neatline:
            sys.exit(f"{args.ram_fran} saknar kartram (NEATLINE).")
    if neatline and not args.hela_bladet:
        from osgeo import ogr
        geom = ogr.CreateGeometryFromWkt(neatline)
        if args.ram_crs:
            ram_srs = osr.SpatialReference()
            ram_srs.SetFromUserInput(args.ram_crs)
            ram_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
            srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
            geom.Transform(osr.CoordinateTransformation(ram_srs, srs))
        # Kartramen kan ha följt med från en tidigare omprojicering och ligga i ett annat
        # koordinatsystem än bilden; klipp bara om den faktiskt överlappar bilden.
        minx, maxx, miny, maxy = geom.GetEnvelope()
        gt = src.GetGeoTransform()
        xs = sorted([gt[0], gt[0] + gt[1] * src.RasterXSize])
        ys = sorted([gt[3], gt[3] + gt[5] * src.RasterYSize])
        if minx < xs[1] and maxx > xs[0] and miny < ys[1] and maxy > ys[0]:
            # Klipp längs själva ramen (inte dess omskrivna rektangel), via en tillfällig vektorfil
            cut = f"/vsimem/{name}_ram.geojson"
            ds = ogr.GetDriverByName("GeoJSON").CreateDataSource(cut)
            lyr = ds.CreateLayer("ram", srs=srs, geom_type=ogr.wkbPolygon)
            feat = ogr.Feature(lyr.GetLayerDefn())
            feat.SetGeometry(geom)
            lyr.CreateFeature(feat)
            ds = None
            warp_opts.update(cutlineDSName=cut, cropToCutline=True)
            print("Klipper vid kartramen (NEATLINE)")
        else:
            print("Kartramen ligger utanför bilden – klipper inte. Ange --ram-crs om ramen har ett annat koordinatsystem.")
    warped = f"/vsimem/{name}_3857.tif"
    gdal.Warp(warped, src, **warp_opts)
    w = gdal.Open(warped)
    scale = min(1.0, args.max_px / max(w.RasterXSize, w.RasterYSize))
    png = os.path.join(args.outdir, f"{name}.png")
    gdal.Translate(png, w, format="PNG", width=int(w.RasterXSize * scale), height=int(w.RasterYSize * scale))

    gt = w.GetGeoTransform()
    to_wgs = osr.CoordinateTransformation(
        osr.SpatialReference(wkt=w.GetProjection()),
        _wgs84(),
    )
    def corner(px: float, py: float) -> list:
        x = gt[0] + px * gt[1] + py * gt[2]
        y = gt[3] + px * gt[4] + py * gt[5]
        lat, lon, _ = to_wgs.TransformPoint(x, y)
        return [round(lon, 8), round(lat, 8)]

    W, H = w.RasterXSize, w.RasterYSize
    corners = [corner(0, 0), corner(W, 0), corner(W, H), corner(0, H)]
    with open(os.path.join(args.outdir, f"{name}.json"), "w", encoding="utf-8") as f:
        json.dump({"corners": corners, "source_crs": source_crs, "source": os.path.basename(args.source)}, f, ensure_ascii=False, indent=2)
    print(f"Klart: {png} och {name}.json (källa {source_crs}, {W}×{H} px före skalning)")


def _wgs84():
    s = osr.SpatialReference()
    s.ImportFromEPSG(4326)
    return s


if __name__ == "__main__":
    main()
