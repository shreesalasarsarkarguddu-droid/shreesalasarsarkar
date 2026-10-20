import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useStaff } from "@/lib/auth";
import Loading from "@/app/loading";
import { createClient } from "@/lib/supabase/server";
import { UsersManager, type UserRow } from "./users-manager";

export default function UsersPage() {
  const staff = useStaff();
  void staff;
  const search = useSearchParams();
  const sp = Object.fromEntries(search) as Record<string, string | undefined>;
  void sp;
  const page = useQuery({
    queryKey: ["page", "SSS/frontend/src/app/users/page.tsx", search.toString()],
    queryFn: async () => {
      const supabase = await createClient();
      const { data, error } = await supabase.rpc("admin_list_users");
      return { data, error };
    },
  });
  if (page.isPending) return <Loading />;
  if (page.error) throw page.error;
  const { data, error } = page.data;
  if (error) throw new Error("Could not load users.");

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <title>Users · Shree Salasar Sarkar</title>
      <div>
        <h1 className="text-xl font-bold">Users</h1>
        <p className="text-sm text-slate-500">Create logins for your staff and choose what each person can do. Only admins can see this page.</p>
      </div>
      <UsersManager users={data as UserRow[]} />
    </div>
  );
}
