const STORAGE_KEY = "tessera_token";

export function getToken(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// The role, read straight off the stored token, for the one job that cannot wait
// for a round trip: painting the right theme before React mounts (#75). Not a
// security decision — the server verifies the signature on every request — so an
// unreadable token simply means "no role", and the theme falls back.
export function roleFromToken(): string | null {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    const { role } = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof role === "string" ? role : null;
  } catch {
    return null;
  }
}
