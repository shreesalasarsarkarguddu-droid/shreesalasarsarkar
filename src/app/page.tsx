import { redirect } from "next/navigation";
import { getStaff } from "@/lib/staff";
import { homeFor } from "@/lib/permissions";

export default async function Home() {
  redirect(homeFor(await getStaff()));
}
