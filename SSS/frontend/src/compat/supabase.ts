// "@/lib/supabase/server" for the copied server actions: only .rpc() is used there, sent to the Laravel API.
import { rpc } from "@/lib/rpc";

export async function createClient() {
  return { rpc };
}
