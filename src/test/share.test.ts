import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText, shareStory } from "../services/share";

const img = { name: "a.jpg", blob: new Blob([new Uint8Array([1])], { type: "image/jpeg" }) };

function stubNavigator(nav: Partial<Navigator>) {
  vi.stubGlobal("navigator", nav);
}

afterEach(() => vi.unstubAllGlobals());

describe("delning", () => {
  it("kopierar texten före delningsmenyn och rapporterar att den ligger i urklipp", async () => {
    const order: string[] = [];
    stubNavigator({
      clipboard: { writeText: vi.fn(async () => { order.push("copy"); }) } as unknown as Clipboard,
      canShare: () => true,
      share: vi.fn(async () => { order.push("share"); }),
    });
    const copied = copyText("Berättelsen");
    const r = await shareStory("Berättelsen", [img], copied);
    expect(r).toEqual({ outcome: "shared", textCopied: true });
    expect(order).toEqual(["copy", "share"]);
  });

  it("säger ifrån när texten inte gick att kopiera", async () => {
    stubNavigator({
      clipboard: { writeText: vi.fn(async () => { throw new DOMException("nej", "NotAllowedError"); }) } as unknown as Clipboard,
      canShare: () => true,
      share: vi.fn(async () => undefined),
    });
    const r = await shareStory("Berättelsen", [img]);
    expect(r).toEqual({ outcome: "shared", textCopied: false });
  });

  it("avbruten delning räknas inte som delad", async () => {
    stubNavigator({
      clipboard: { writeText: vi.fn(async () => undefined) } as unknown as Clipboard,
      share: vi.fn(async () => { throw new DOMException("avbrutet", "AbortError"); }),
    });
    expect((await shareStory("Text", [])).outcome).toBe("cancelled");
  });
});
