import { describe, expect, it } from "vitest";
import { Outbox, type OutboxOp } from "../data/outbox";

let n = 0;

describe("utkorgen (AC-02, AC-15)", () => {
  it("sparar fångst med foto offline och skickar i ordning när nätet kommer tillbaka", async () => {
    const box = new Outbox(`outbox-${n++}`);
    const photo = new Blob(["jpeg"], { type: "image/jpeg" });
    await box.enqueue("media", { id: "m1" }, { original: photo, clean: photo });
    await box.enqueue("capture", { id: "c1", input: { text: "Gammal spis", kind: "find", media_ids: ["m1"] } });
    expect(await box.count()).toBe(2);

    const sent: OutboxOp[] = [];
    const result = await box.flush(async (op) => void sent.push(op));
    expect(result).toEqual({ done: 2, remaining: 0 });
    expect(sent.map((o) => o.kind)).toEqual(["media", "capture"]);
    expect(await sent[0].blobs!.clean.text()).toBe("jpeg");
  });

  it("behåller allt och ordningen om ett steg misslyckas", async () => {
    const box = new Outbox(`outbox-${n++}`);
    await box.enqueue("media", { id: "m1" });
    await box.enqueue("capture", { id: "c1" });
    await box.enqueue("checklist", { id: "x" });
    let calls = 0;
    const first = await box.flush(async (op) => {
      calls++;
      if (op.kind === "capture") throw new Error("nätet föll bort");
    });
    expect(first).toEqual({ done: 1, remaining: 2 });
    expect(calls).toBe(2);
    const left = await box.list();
    expect(left.map((o) => o.kind)).toEqual(["capture", "checklist"]);
    expect(left[0].attempts).toBe(1);
    expect((await box.flush(async () => undefined)).remaining).toBe(0);
  });

  it("cachar läsningar för offline", async () => {
    const box = new Outbox(`outbox-${n++}`);
    await box.cachePut("pickup:1", { title: "Kakelugn" });
    expect(await box.cacheGet("pickup:1")).toEqual({ title: "Kakelugn" });
  });
});
