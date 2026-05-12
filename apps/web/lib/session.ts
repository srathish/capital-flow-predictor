// Client-side session ID. Stored in localStorage so the same browser sees
// the same watchlist across page reloads. Renew by clearing localStorage.

const KEY = "cfp_session_id";

export function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(KEY);
  if (!id || id.length < 8) {
    id = newSessionId();
    window.localStorage.setItem(KEY, id);
  }
  return id;
}

function newSessionId(): string {
  // 16 random hex bytes — long enough that collisions are not a worry.
  const buf = new Uint8Array(16);
  if (typeof window !== "undefined" && window.crypto) {
    window.crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function resetSessionId(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(KEY);
}
