// Supabase-läget med utkorg och läscache, så att fångst och hämtning fungerar utan nät.
import type { Capture, CaptureInput, ChecklistItem, MapLayer, Media, Observation, Pickup, PickupItem, StorageLocation, Structure, UsageEvent, VObject, Zone } from "../domain/types";
import { Outbox, isNetworkError, type OutboxOp } from "./outbox";
import type { MediaInput, Receipt } from "./repo";
import { SupabaseRepo } from "./supabaseRepo";

type MediaPayload = Omit<MediaInput, "original" | "clean">;

export class OfflineSupabaseRepo extends SupabaseRepo {
  private outbox: Outbox;

  constructor(url: string, anonKey: string, outbox = new Outbox()) {
    super(url, anonKey);
    this.outbox = outbox;
  }

  private async queueOr<T>(online: () => Promise<T>, offline: () => Promise<T>): Promise<T> {
    if (!navigator.onLine) return offline();
    try {
      return await online();
    } catch (e) {
      if (isNetworkError(e)) return offline();
      throw e;
    }
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (navigator.onLine) {
      try {
        const v = await load();
        await this.outbox.cachePut(key, v);
        return v;
      } catch (e) {
        if (!isNetworkError(e)) throw e;
      }
    }
    const v = await this.outbox.cacheGet<T>(key);
    if (v === undefined) throw new Error("Inte tillgängligt offline – öppna sidan en gång när du har nät.");
    return v;
  }

  // ---- skrivningar som köas
  override async saveMedia(input: MediaInput): Promise<Media> {
    return this.queueOr(
      () => super.saveMedia(input),
      async () => {
        const { original, clean, ...payload } = input;
        await this.outbox.enqueue("media", payload satisfies MediaPayload, { original, clean });
        const t = new Date().toISOString();
        return {
          id: input.id, site_id: "", created_at: t, created_by: "", updated_at: t, archived_at: null, kind: "image",
          original_path: "", clean_path: null, mime: input.mime, width: input.width, height: input.height, caption: "",
          role: input.role ?? "general", has_people: input.has_people ?? false, visibility: "shareable",
          entity_type: input.entity_type, entity_id: input.entity_id,
        };
      },
    );
  }

  override async saveCapture(id: string, input: CaptureInput): Promise<Capture> {
    return this.queueOr(
      () => super.saveCapture(id, input),
      async () => {
        await this.outbox.enqueue("capture", { id, input });
        const t = new Date().toISOString();
        return { id, site_id: "", created_at: t, created_by: "", updated_at: t, archived_at: null, input, sync_state: "local", proposal_id: null };
      },
    );
  }

  override async toggleChecklistItem(item: ChecklistItem, done: boolean): Promise<void> {
    await this.queueOr(() => super.toggleChecklistItem(item, done), async () => void (await this.outbox.enqueue("checklist", { item, done })));
    const key = `checklist:${item.pickup_id}`;
    const list = await this.outbox.cacheGet<ChecklistItem[]>(key);
    if (list) await this.outbox.cachePut(key, list.map((i) => (i.id === item.id ? { ...i, done } : i)));
  }

  override async completePickup(id: string, receipts: Receipt[], locationId: string | null): Promise<void> {
    await this.queueOr(() => super.completePickup(id, receipts, locationId), async () => void (await this.outbox.enqueue("complete_pickup", { id, receipts, locationId })));
    const p = await this.outbox.cacheGet<Pickup>(`pickup:${id}`);
    if (p) await this.outbox.cachePut(`pickup:${id}`, { ...p, status: "completed" });
  }

  override async capturesWithoutProposal(): Promise<Capture[]> {
    const queued = (await this.outbox.list()).filter((o) => o.kind === "capture").map((o) => {
      const { id, input } = o.payload as { id: string; input: CaptureInput };
      return { id, input, sync_state: "local", proposal_id: null, site_id: "", created_at: o.created_at, created_by: "", updated_at: o.created_at, archived_at: null } as Capture;
    });
    if (!navigator.onLine) return queued;
    try {
      return [...(await super.capturesWithoutProposal()), ...queued];
    } catch (e) {
      if (isNetworkError(e)) return queued;
      throw e;
    }
  }

  // ---- läsningar som behövs ute på en hämtning
  override pickups(): Promise<Pickup[]> { return this.cached("pickups", () => super.pickups()); }
  override async pickup(id: string): Promise<Pickup | null> { return this.cached(`pickup:${id}`, () => super.pickup(id)); }
  override pickupItems(id: string): Promise<PickupItem[]> { return this.cached(`pickup_items:${id}`, () => super.pickupItems(id)); }
  override checklist(id: string): Promise<ChecklistItem[]> { return this.cached(`checklist:${id}`, () => super.checklist(id)); }
  override storageLocations(): Promise<StorageLocation[]> { return this.cached("storage_locations", () => super.storageLocations()); }
  override objects(): Promise<VObject[]> { return this.cached("objects", () => super.objects()); }

  // ---- Vretakartan fungerar offline (FR-076): grundbilder, zoner, byggnader och kartlager cachas
  override zones(): Promise<Zone[]> { return this.cached("zones", () => super.zones()); }
  override structures(): Promise<Structure[]> { return this.cached("structures", () => super.structures()); }
  override mapLayers(): Promise<MapLayer[]> { return this.cached("map_layers", () => super.mapLayers()); }
  override allUsageEvents(): Promise<UsageEvent[]> { return this.cached("usage_events", () => super.allUsageEvents()); }
  override observations(): Promise<Observation[]> { return this.cached("observations", () => super.observations()); }
  override async mapImage(layer: MapLayer): Promise<Blob | null> {
    const key = `map_image:${layer.id}:${layer.updated_at}`;
    const hit = await this.outbox.cacheGet<Blob>(key);
    if (hit) return hit;
    const blob = await super.mapImage(layer);
    if (blob) await this.outbox.cachePut(key, blob);
    return blob;
  }

  // ---- synk
  override async pendingSync(): Promise<number> {
    return this.outbox.count();
  }

  override async flushOutbox(): Promise<number> {
    if (!navigator.onLine) return 0;
    const { done } = await this.outbox.flush((op) => this.replay(op));
    return done;
  }

  private async replay(op: OutboxOp): Promise<void> {
    switch (op.kind) {
      case "media": {
        const p = op.payload as MediaPayload;
        await super.saveMedia({ ...p, original: op.blobs!.original, clean: op.blobs!.clean });
        return;
      }
      case "capture": {
        const { id, input } = op.payload as { id: string; input: CaptureInput };
        await super.saveCapture(id, input);
        return;
      }
      case "checklist": {
        const { item, done } = op.payload as { item: ChecklistItem; done: boolean };
        await super.toggleChecklistItem(item, done);
        return;
      }
      case "complete_pickup": {
        const { id, receipts, locationId } = op.payload as { id: string; receipts: Receipt[]; locationId: string | null };
        await super.completePickup(id, receipts, locationId);
        return;
      }
    }
  }
}
