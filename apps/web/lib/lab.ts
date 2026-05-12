"use client";

// Tiny client-side "secret tab" gate. A keystroke listener watches for the
// magic word "saiyeesh" typed anywhere on the page (case-insensitive); when
// matched, it pushes to /lab. Cleared after each match so it can fire again.
//
// Also exposes a hook for ticker inputs to opt-in: pass the ticker value
// to maybeUnlockLab() — if it matches the magic word, push to /lab and
// suppress the normal navigation.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const MAGIC = "saiyeesh";

export function useLabUnlock() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;

    let buffer = "";
    let lastKey = 0;

    function onKey(e: KeyboardEvent) {
      // Ignore modifier-laden keystrokes; ignore non-printable keys.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1) return;
      const now = Date.now();
      // Reset the buffer if the user paused for more than 2s between keystrokes.
      if (now - lastKey > 2000) buffer = "";
      lastKey = now;
      buffer = (buffer + e.key.toLowerCase()).slice(-MAGIC.length);
      if (buffer === MAGIC) {
        buffer = "";
        router.push("/lab");
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);
}

/**
 * Call from any ticker-input submit handler. Returns true if the value matched
 * the magic word and the navigation was intercepted; the caller should bail
 * out of its normal "go to /agents/<ticker>" logic in that case.
 */
export function maybeUnlockLab(ticker: string | undefined | null, router: ReturnType<typeof useRouter>): boolean {
  if (!ticker) return false;
  if (ticker.trim().toLowerCase() === MAGIC) {
    router.push("/lab");
    return true;
  }
  return false;
}
