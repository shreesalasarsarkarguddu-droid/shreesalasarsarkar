export const PAYMENT_MODES = ["CASH", "BOB", "SBI", "SSS"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
