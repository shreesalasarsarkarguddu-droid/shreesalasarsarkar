// Visit remarks: the collection man went, the customer did not pay and said when he will.

/** One remark on one account (from public.account_remarks). */
export type Remark = {
  id: number;
  installment_no: number | null;
  remark: string;
  promise_date: string | null;
  created_at: string;
  by_name: string;
  /** written by the person looking */
  mine: boolean;
  /** a payment was entered after this remark */
  paid_after: boolean;
};

/** Remarks to show on the unpaid EMI row number `sno` (newest first). */
export const remarksFor = (remarks: Remark[] | undefined, sno: number) => (remarks ?? []).filter((r) => r.installment_no === sno);
