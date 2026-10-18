import type { Metadata } from "next";
import { requirePerm } from "@/lib/staff";
import { LoanForm } from "./loan-form";

export const metadata: Metadata = { title: "New loan · Shree Salasar Sarkar" };

export default async function NewLoanPage() {
  await requirePerm("new_loan");
  return <LoanForm />;
}
