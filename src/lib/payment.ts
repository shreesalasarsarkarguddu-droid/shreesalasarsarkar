export const PAYMENT_MODES = ["CASH", "CHEQUE", "BOB", "SBI", "BANK"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
