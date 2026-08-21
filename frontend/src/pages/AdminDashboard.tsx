import { useQuery } from "@tanstack/react-query";
import { getAdminDashboard, USER_ROLES } from "../api/client";
import DashboardShell from "./DashboardShell";

export default function AdminDashboard() {
  const query = useQuery({ queryKey: ["dashboard", "admin"], queryFn: getAdminDashboard });

  return (
    <DashboardShell query={query}>
      {(data) => (
        <main>
          <h1>Admin dashboard</h1>
          <dl>
            {/* Rows come from the role list, so a fourth role needs no edit here. */}
            {USER_ROLES.map((role) => (
              <div key={role}>
                <dt>{role}</dt>
                <dd>{data.userCounts[role]}</dd>
              </div>
            ))}
          </dl>
        </main>
      )}
    </DashboardShell>
  );
}
