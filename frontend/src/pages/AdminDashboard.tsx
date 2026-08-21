import { useQuery } from "@tanstack/react-query";
import { getAdminDashboard } from "../api/client";
import DashboardError from "./DashboardError";

export default function AdminDashboard() {
  const { data, error, isLoading } = useQuery({ queryKey: ["dashboard", "admin"], queryFn: getAdminDashboard });

  if (isLoading) return <p role="status">Loading your dashboard…</p>;
  if (error) return <DashboardError message={(error as Error).message} />;

  return (
    <main>
      <h1>Admin dashboard</h1>
      <dl>
        <dt>Students</dt>
        <dd>{data!.userCounts.student}</dd>
        <dt>Investors</dt>
        <dd>{data!.userCounts.investor}</dd>
        <dt>Admins</dt>
        <dd>{data!.userCounts.admin}</dd>
      </dl>
    </main>
  );
}
