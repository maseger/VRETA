import { describe, expect, it } from "vitest";
import { parseMapPackage } from "../services/mapPackage";

const corners = [[17.6, 59.9], [17.61, 59.9], [17.61, 59.89], [17.6, 59.89]];
const img = "data:image/webp;base64," + btoa("RIFF....WEBP");
const pkg = (layers: unknown[]) => JSON.stringify({ format: "vreta-kartpaket", version: 1, layers });

describe("kartpaket", () => {
  it("läser lager och lägger grundbilden först", () => {
    const layers = parseMapPackage(pkg([
      { name: "Plan", kind: "overlay", taken_on: "2021-12-02", corners, image: img },
      { name: "Karta", kind: "base", taken_on: "2021-06-07", corners, source_crs: "SWEREF99 TM", image: img },
    ]));
    expect(layers.map((l) => l.name)).toEqual(["Karta", "Plan"]);
    expect(layers[0].opacity).toBe(1);
    expect(layers[1].opacity).toBe(0.7);
    expect(layers[0].image.type).toBe("image/webp");
    expect(layers[0].image.size).toBe(12);
  });

  it("avvisar annat än kartpaket", () => {
    expect(() => parseMapPackage("{}")).toThrow("inte ett kartpaket");
    expect(() => parseMapPackage("inte json")).toThrow("inte ett kartpaket");
  });

  it("kräver fyra hörn och känd bildtyp", () => {
    expect(() => parseMapPackage(pkg([{ name: "X", kind: "base", corners: corners.slice(0, 3), image: img }]))).toThrow("fyra giltiga hörn");
    expect(() => parseMapPackage(pkg([{ name: "X", kind: "base", corners, image: "data:text/html;base64,AA==" }]))).toThrow("okänt format");
  });
});
