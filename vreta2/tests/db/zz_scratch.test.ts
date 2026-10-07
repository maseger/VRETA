import { test } from "vitest";
import { freshDb } from "/home/user/VRETA/vreta2/tests/db/pglite";
test("migrations", async () => { const db = await freshDb(); const r = await db.query("select count(*) from core.table_registry"); console.log(r.rows); });
