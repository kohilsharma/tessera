import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { getMe } from "../api/client";
import DashboardError from "./DashboardError";

// Login/Register land here rather than on a role-specific route directly: the
// role only becomes known once /auth/me resolves, so this is the one place
// that decides which of /dashboard/{student,investor,admin} to send a user to.
export default function DashboardRedirect() {
  const { data, error, isLoading } = useQuery({ queryKey: ["me"], queryFn: getMe });

  if (isLoading) return <p role="status">Loading your dashboard…</p>;
  if (error) return <DashboardError message={`Could not load your account: ${(error as Error).message}`} />;

  return <Navigate to={`/dashboard/${data!.role}`} replace />;
}
