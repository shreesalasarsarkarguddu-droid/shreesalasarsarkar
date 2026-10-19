import type { Metadata } from "next";
import { requirePerm } from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";
import { LoanForm } from "./loan-form";

export const metadata: Metadata = { title: "New loan · Shree Salasar Sarkar" };

export default async function NewLoanPage() {
  await requirePerm("new_loan");
  const { data } = await (await createClient()).from("zones").select("name").eq("active", true).order("name");
  return <LoanForm zones={(data ?? []).map((z) => z.name as string)} />;
}
