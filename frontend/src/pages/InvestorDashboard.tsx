import { useQuery } from "@tanstack/react-query";
import { getInvestorDashboard } from "../api/client";
import DashboardShell from "./DashboardShell";

export default function InvestorDashboard() {
  const query = useQuery({ queryKey: ["dashboard", "investor"], queryFn: getInvestorDashboard });

  return (
    <DashboardShell query={query}>
      {(data) => (
        <main>
          <h1>Investor dashboard</h1>
          <p>Watchlist: {data.watchlist.length === 0 ? "none yet" : data.watchlist.length}</p>
        </main>
      )}
    </DashboardShell>
  );
}
