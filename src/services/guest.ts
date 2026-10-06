import type { Repo } from "../data/repo";

/** Lämna gästläget: utloggning med Supabase, tillbaka till ägaren i demoläge. */
export async function leaveGuest(repo: Repo): Promise<void> {
  if (repo.setDemoRole) await repo.setDemoRole("owner");
  else await repo.signOut();
}
