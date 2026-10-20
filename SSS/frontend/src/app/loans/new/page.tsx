import { useApi } from "@/lib/use-api";
import Loading from "../../loading";
import { LoanForm } from "./loan-form";

export default function NewLoanPage() {
  const zones = useApi<string[]>("/zones/names");
  if (zones.isPending) return <Loading />;
  return (
    <>
      <title>New loan · Shree Salasar Sarkar</title>
      <LoanForm zones={zones.data ?? []} />
    </>
  );
}
