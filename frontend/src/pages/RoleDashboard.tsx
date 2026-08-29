import type { ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { getMe, type UserRole } from "../api/client";
import AdminDashboard from "./AdminDashboard";
import DashboardError from "./DashboardError";
import DashboardShell from "./DashboardShell";
import InvestorDashboard from "./InvestorDashboard";
import StudentDashboard from "./StudentDashboard";

// One map instead of one route per role: adding a role is an entry here, not an
// edit in App.tsx as well.
const DASHBOARDS: Record<UserRole, ComponentType> = {
  student: StudentDashboard,
  investor: InvestorDashboard,
  admin: AdminDashboard,
};

// The API's requireRole is the real guard (a hand-crafted request still gets a
// 403); this only spares a user a 403 they can do nothing about, so a role they
// do not hold never renders that dashboard's chrome. It also catches a role the
// SPA has no dashboard for, which would otherwise render blank.
export default function RoleDashboard() {
  const { role } = useParams();
  const query = useQuery({ queryKey: ["me"], queryFn: getMe });

  return (
    <DashboardShell query={query}>
      {(me) => {
        const Dashboard = role === me.role ? DASHBOARDS[me.role] : undefined;
        if (!Dashboard) {
          // "an investor", "a student": the role names are a closed set, so the
          // first letter decides the article correctly for every one of them.
          const article = /^[aeiou]/.test(me.role) ? "an" : "a";
          return <DashboardError message={`Your account is ${article} ${me.role}, so that dashboard is not yours.`} />;
        }
        return <Dashboard />;
      }}
    </DashboardShell>
  );
}
