import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env } from "../env.js";

export function createClient() {
  return createSupabaseClient(env.supabaseUrl, env.supabaseServiceKey);
}
