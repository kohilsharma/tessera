import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMe } from "../api/client";
import { getToken, roleFromToken } from "../auth/token";
import { applyTheme, writeModeHint, readModeHint } from "../theme";

/**
 * Renders nothing; keeps <html> wearing the signed-in reader's theme (#75).
 *
 * It sits beside <App /> rather than inside it because App.tsx is the route table
 * and nothing else, and because the theme is a property of the session rather than
 * of any route — the attribute must be right on /login too.
 *
 * `enabled` is load-bearing: a signed-out visitor who asks /auth/me gets a 401,
 * and authFetch answers a 401 by hard-navigating to /login. Unguarded, that is a
 * redirect loop on the login page itself.
 */
export function ThemeSync() {
  const { data } = useQuery({ queryKey: ["me"], queryFn: getMe, enabled: !!getToken() });

  // The token's role is what main.tsx already painted with; it holds until the
  // server's answer arrives, so a reload never flashes the signed-out theme.
  const role = data?.role ?? roleFromToken();
  const mode = data?.colorMode ?? readModeHint();

  useEffect(() => {
    writeModeHint(mode);
    applyTheme(role, mode);
    if (mode !== "system") return;

    // Only 'system' tracks the OS. The listener is the whole reason this is a
    // component and not a one-shot call in main.tsx.
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const onChange = () => applyTheme(role, mode);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [role, mode]);

  return null;
}
