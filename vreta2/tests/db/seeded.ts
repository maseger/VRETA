// Delad startpunkt för databastesterna: en färsk databas med demoplatsen inlagd via Domain API.
import { Harness, type User } from "./harness";
import { seedDemo, type SeedIds, type SeedRole } from "../../src/data/seed/demoSeed";

export type Seeded = { h: Harness; owner: User; helper: User; reader: User; ids: SeedIds };

export async function seeded(): Promise<Seeded> {
  const h = await Harness.create();
  const owner = await h.user("agare");
  const helper = await h.user("medhjalpare");
  const reader = await h.user("lasare");
  const users: Record<SeedRole, User> = { owner, helper, reader };
  const ids = await seedDemo({
    bootstrap: (params) => h.api(owner, "bootstrap_site", params),
    ok: (as, type, payload) => h.ok(users[as], type, payload),
    join: async (as, token) => { await h.api(users[as], "redeem_guest_link", { token }); },
  });
  await h.jobs(owner);
  return { h, owner, helper, reader, ids };
}
