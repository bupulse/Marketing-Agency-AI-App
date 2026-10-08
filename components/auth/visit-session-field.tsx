"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const read = () => {
  try {
    return sessionStorage.getItem("bp_sid") ?? "";
  } catch {
    return ""; // storage blocked: the sign-up simply isn't linked
  }
};

/** Hidden field with the anonymous visit session id the marketing tracker keeps in sessionStorage (no cookies), so a sign-up can be linked to its visit. */
export function VisitSessionField() {
  const value = useSyncExternalStore(subscribe, read, () => "");
  return <input type="hidden" name="visitSession" value={value} />;
}
