"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Temporary developer check that auth, usage limits, the AI provider and the
// database all work together. Replaced by the real content generator UI later.
export default function TestGenerate() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<string>("");

  async function run() {
    setBusy(true);
    setOutput("");
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "product",
        title: "New phone model in stock",
        price: "10% off this weekend",
        features: ["3 colors", "free case", "trade-in accepted"],
      }),
    });
    const body = await res.text();
    let shown = `HTTP ${res.status}: ${body || "(empty response)"}`;
    try {
      shown = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      // Not JSON; show the raw text.
    }
    setOutput(shown);
    setBusy(false);
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-2">
      <button type="button" onClick={run} disabled={busy} className="self-start rounded border px-4 py-2">
        {busy ? "Generating…" : "Run a test generation (uses 1 credit)"}
      </button>
      {output && <pre className="overflow-x-auto whitespace-pre-wrap rounded border p-3 text-sm">{output}</pre>}
    </section>
  );
}
