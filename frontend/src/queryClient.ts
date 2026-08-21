import { QueryClient } from "@tanstack/react-query";

// Module-level rather than created inside main.tsx, so the api client can drop the
// cache when the identity behind it changes. Nothing cached here is anonymous —
// ["me"] and every dashboard belong to one user.
export const queryClient = new QueryClient();
