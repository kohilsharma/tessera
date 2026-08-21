import { useQuery } from "@tanstack/react-query";
import { getInvestorDashboard } from "../api/client";
import DashboardError from "./DashboardError";

export default function InvestorDashboard() {
  const { data, error, isLoading } = useQuery({ queryKey: ["dashboard", "investor"], queryFn: getInvestorDashboard });

  if (isLoading) return <p role="status">Loading your dashboard…</p>;
  if (error) return <DashboardError message={(error as Error).message} />;

  return (
    <main>
      <h1>Investor dashboard</h1>
      <p>Watchlist: {data!.watchlist.length === 0 ? "none yet" : data!.watchlist.length}</p>
    </main>
  );
}
