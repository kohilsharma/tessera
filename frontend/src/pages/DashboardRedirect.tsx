import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { getMe } from "../api/client";
import DashboardShell from "./DashboardShell";

// Login/Register land here rather than on a role-specific route directly: the
// role only becomes known once /auth/me resolves, so this is the one place that
// decides which of /dashboard/{student,investor,admin} to send a user to. A role
// with no dashboard is RoleDashboard's to reject, once it is on that route.
export default function DashboardRedirect() {
  const query = useQuery({ queryKey: ["me"], queryFn: getMe });

  return (
    <DashboardShell query={query}>
      {(me) => <Navigate to={`/dashboard/${me.role}`} replace />}
    </DashboardShell>
  );
}
