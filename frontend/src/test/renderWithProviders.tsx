import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// A fresh QueryClient per test: the app's shared one would carry cached data
// between tests and make a "loading" assertion pass or fail by test order.
// Retries off so an error state is reached on the first rejection.
export function renderWithProviders(
  ui: ReactElement,
  { route = "/", path = "*" }: { route?: string; path?: string } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={path} element={ui} />
          {/* Somewhere for a post-submit navigate() to land, so a successful
              save doesn't log "No routes matched" noise from every test. */}
          {path !== "*" && <Route path="*" element={null} />}
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// The shape api/client.ts's fetch wrapper expects back.
export function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    blob: async () => new Blob(),
  } as Response;
}

export function listEnvelope<T>(items: T[], overrides: Partial<{ page: number; totalPages: number; total: number }> = {}) {
  return { items, page: 1, pageSize: 10, total: items.length, totalPages: 1, ...overrides };
}
