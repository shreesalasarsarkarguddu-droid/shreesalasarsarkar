import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import Loading from "@/app/loading";
import { rpc } from "@/lib/rpc";
import { DataManager, type Overview } from "./data-manager";

export default function DataPage() {
  const loaded = useQuery({
    queryKey: ["page", "settings-data"],
    queryFn: async () => {
      const { data, error } = await rpc<Overview>("admin_data_overview");
      if (error) throw new Error("Could not load data overview.");
      return data as Overview;
    },
  });
  if (loaded.isPending) return <Loading />;
  if (loaded.error) throw loaded.error;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <title>Data · Shree Salasar Sarkar</title>
      <div>
        <Link href="/settings" className="text-sm font-medium text-blue-700">
          ← Settings
        </Link>
        <h1 className="text-xl font-bold">Data</h1>
        <p className="text-sm text-slate-500">
          Backups, restore points and deleting data. Before every delete or restore, a restore point is saved automatically, so it
          can be undone.
        </p>
      </div>
      <DataManager o={loaded.data} />
    </div>
  );
}
