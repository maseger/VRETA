// Utan VITE_SUPABASE_URL körs appen helt i webbläsaren (demoläge): samma databas, samma migreringar och
// samma Domain API i PGlite, med påhittade exempeldata.
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || "";
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || "";
export const MODE: "demo" | "supabase" = SUPABASE_URL && SUPABASE_ANON_KEY ? "supabase" : "demo";
export const BASE = import.meta.env.BASE_URL;
