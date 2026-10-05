import { describe, expect, it } from "vitest";
import { areaM2, closeRing, cornersFromControlPoints, lengthM, pointInPolygon, zoneAt, type LngLat } from "../geo/geo";

const square = closeRing([[15, 60], [15.001, 60], [15.001, 60.001], [15, 60.001]]);

describe("geometri för Vretakartan", () => {
  it("avgör om en punkt ligger i en zon", () => {
    expect(pointInPolygon([15.0005, 60.0005], square)).toBe(true);
    expect(pointInPolygon([15.002, 60.0005], square)).toBe(false);
  });
  it("räknar ut area och längd i meter", () => {
    // 0,001° longitud vid 60°N ≈ 55,6 m, 0,001° latitud ≈ 111,2 m
    expect(areaM2(square)).toBeGreaterThan(6100);
    expect(areaM2(square)).toBeLessThan(6250);
    expect(lengthM([[15, 60], [15, 60.001]])).toBeCloseTo(111.2, 0);
  });
  it("väljer den minsta zonen som innehåller punkten (AC-23)", () => {
    const small = closeRing([[15.0004, 60.0004], [15.0006, 60.0004], [15.0006, 60.0006], [15.0004, 60.0006]]);
    const zones = [{ id: "stor", geom: square }, { id: "liten", geom: small }, { id: "utan", geom: null }];
    expect(zoneAt([15.0005, 60.0005], zones)?.id).toBe("liten");
    expect(zoneAt([15.0002, 60.0002], zones)?.id).toBe("stor");
    expect(zoneAt([16, 61], zones)).toBeNull();
  });
  it("georefererar en ritning med tre stödpunkter", () => {
    // En bild 1000 × 500 px som täcker exakt kvadraten (norr uppåt)
    const pts = [
      { pixel: [0, 0] as [number, number], lngLat: [15, 60.001] as LngLat },
      { pixel: [1000, 0] as [number, number], lngLat: [15.001, 60.001] as LngLat },
      { pixel: [0, 500] as [number, number], lngLat: [15, 60] as LngLat },
    ];
    const c = cornersFromControlPoints(pts, 1000, 500);
    expect(c[2][0]).toBeCloseTo(15.001, 6);
    expect(c[2][1]).toBeCloseTo(60, 6);
    expect(() => cornersFromControlPoints([pts[0], pts[0], pts[0]], 10, 10)).toThrow(/linje/);
  });
});
