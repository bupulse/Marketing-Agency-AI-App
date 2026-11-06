// Whether the PADDLE_PRICE_* environment variables may stand in for a plan's own Paddle price ids. They belong to the
// account of PADDLE_ENVIRONMENT (the hosting environment's Paddle account), so once Admin -> Settings -> Card payments
// runs on the other account (sandbox vs live), they are price ids of the wrong account and are ignored.
// getPaddleConfig() keeps this up to date; no imports, so plan-catalog can read it without a cycle.
let usable = true;

export function envPricesUsable(): boolean {
  return usable;
}

export function setEnvPricesUsable(value: boolean) {
  usable = value;
}
