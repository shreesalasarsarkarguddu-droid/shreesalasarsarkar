// Admin edit of data from the old software: one old account's details, and its receipts.
import { z } from "zod";
import { todayIST } from "@/lib/schedule";

const text = (max: number) => z.string().trim().max(max, { error: "Too long" });
const mobile = z.string().trim().regex(/^(\d{10})?$/, { error: "10 digits, or leave it empty" });
const money = z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/, { error: "Enter the amount (0 if none)" });
const whole = (min: number, max: number, error: string) =>
  z.string().trim().regex(/^\d{1,3}$/, { error }).refine((v) => Number(v) >= min && Number(v) <= max, { error });

export const oldAccountSchema = z.object({
  fno: z.string().trim().regex(/^\d{1,9}$/, { error: "Enter the folio number" }),
  borrower_name: z.string().trim().min(1, { error: "Enter the name" }).max(200, { error: "Too long" }),
  borrower_father: text(200),
  borrower_address: text(500),
  borrower_mobile: mobile,
  borrower_mobile2: mobile,
  guarantor_name: text(200),
  guarantor_father: text(200),
  guarantor_address: text(500),
  guarantor_mobile: mobile,
  guarantor_mobile2: mobile,
  finance_mode: text(40),
  vehicle_condition: text(40),
  vehicle_model: text(120),
  vehicle_variant: text(120),
  chassis_no: text(80),
  engine_no: text(80),
  model_year: z.string().trim().regex(/^(\d{4})?$/, { error: "4 digits, or leave it empty" }),
  registration_no: text(40),
  agreement_date: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, { error: "Enter the date" }),
  tenure_months: whole(1, 360, "1 to 360"),
  interval_months: whole(1, 12, "1 to 12"),
  finance_amount: money,
  interest_amount: money,
  agreement_amount: money,
  hp_amount: money,
  total_amount: money.refine((v) => Number(v) > 0, { error: "Must be more than 0" }),
  emi_amount: money,
});
export type OldAccountFields = keyof z.infer<typeof oldAccountSchema>;

/** The form, in sections: [field, label, kind] */
export const OLD_ACCOUNT_FORM: { title: string; fields: [OldAccountFields, string, "text" | "mobile" | "money" | "number" | "date"][] }[] = [
  {
    title: "Customer",
    fields: [
      ["borrower_name", "Name *", "text"],
      ["borrower_father", "Father / husband", "text"],
      ["borrower_mobile", "Mobile", "mobile"],
      ["borrower_mobile2", "Mobile 2", "mobile"],
      ["borrower_address", "Address", "text"],
    ],
  },
  {
    title: "Guarantor",
    fields: [
      ["guarantor_name", "Name", "text"],
      ["guarantor_father", "Father", "text"],
      ["guarantor_mobile", "Mobile", "mobile"],
      ["guarantor_mobile2", "Mobile 2", "mobile"],
      ["guarantor_address", "Address", "text"],
    ],
  },
  {
    title: "Vehicle",
    fields: [
      ["registration_no", "Registration no.", "text"],
      ["vehicle_model", "Model", "text"],
      ["vehicle_variant", "Colour / variant", "text"],
      ["model_year", "Model year", "number"],
      ["vehicle_condition", "Condition", "text"],
      ["chassis_no", "Chassis no.", "text"],
      ["engine_no", "Engine no.", "text"],
    ],
  },
  {
    title: "Loan",
    fields: [
      ["fno", "Folio no. *", "number"],
      ["agreement_date", "Agreement date", "date"],
      ["finance_mode", "Finance mode (CASH / bank)", "text"],
      ["tenure_months", "EMIs *", "number"],
      ["interval_months", "Months between EMIs *", "number"],
      ["finance_amount", "Finance amount (₹)", "money"],
      ["interest_amount", "Interest (₹)", "money"],
      ["agreement_amount", "Agreement amount (₹)", "money"],
      ["hp_amount", "HP amount (₹)", "money"],
      ["total_amount", "Total payable (₹) *", "money"],
      ["emi_amount", "EMI (₹)", "money"],
    ],
  },
];

/** Modes seen in the old software's receipts; any other is typed in. */
export const OLD_RECEIPT_MODES = ["CASH", "BOB", "SBI", "SSS", "BANK", "UPI", "CHEQUE"] as const;

export const oldReceiptSchema = z.object({
  paid_amount: z
    .string()
    .trim()
    .regex(/^\d{1,9}(\.\d{1,2})?$/, { error: "Enter the amount" })
    .refine((v) => Number(v) > 0, { error: "Must be more than 0" }),
  paid_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Enter the date" })
    .refine((v) => v <= todayIST(), { error: "Cannot be in the future" }),
  payment_mode: z.string().trim().min(1, { error: "Choose the mode" }).max(20, { error: "Too long" }),
  receipt_no: z.string().trim().regex(/^\d{0,12}$/, { error: "Digits only" }),
  cheque_no: text(40),
});
export type OldReceiptInput = z.input<typeof oldReceiptSchema>;

/** "60000.00" -> "60000" for the form */
export const plainMoney = (v: string | null | undefined) => (v == null ? "" : v.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1"));
