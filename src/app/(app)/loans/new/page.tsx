import type { Metadata } from "next";
import { LoanForm } from "./loan-form";

export const metadata: Metadata = { title: "New loan · Shree Salasar Sarkar" };

export default function NewLoanPage() {
  return <LoanForm />;
}
