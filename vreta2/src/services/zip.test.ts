import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { crc32, zip } from "./zip";

describe("exportens ZIP", () => {
  test("CRC32 stämmer", () => {
    expect(crc32(new TextEncoder().encode("123456789")).toString(16)).toBe("cbf43926");
  });
  test("paketet går att packa upp och innehållet är oförändrat", async () => {
    const data = new TextEncoder().encode(JSON.stringify({ hej: "Vreta – åäö" }));
    const img = new Uint8Array(5000).map((_, i) => (i * 7) % 256);
    const blob = zip([{ name: "vreta.json", data }, { name: "media/abc/original.jpg", data: img }]);
    const dir = mkdtempSync(join(tmpdir(), "vreta-zip-"));
    const file = join(dir, "x.zip");
    writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
    const list = execFileSync("python3", ["-c", `import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print(z.read('vreta.json').decode());print(len(z.read('media/abc/original.jpg')))`, file]).toString();
    expect(list).toContain("None");
    expect(list).toContain("Vreta – åäö");
    expect(list).toContain("5000");
  });
});
