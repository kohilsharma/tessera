import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import DashboardError from "./DashboardError";
import { PendingState } from "../components/uiStates";

// The loading/error half of every dashboard, in one place. isPending rather than
// isLoading: a paused query (the browser went offline) is pending with isLoading
// false, so an isLoading branch falls straight through to a render with no data.
// Passing data to children only on success is what removes the `data!` asserts.
export default function DashboardShell<T>({
  query,
  children,
}: {
  query: UseQueryResult<T, Error>;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <PendingState>Loading your dashboard…</PendingState>;
  if (query.isError) return <DashboardError message={query.error.message} />;
  return <>{children(query.data)}</>;
}
