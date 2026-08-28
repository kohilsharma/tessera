import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
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
          <p>
            <Link to="/stories">Browse Stories</Link> · <Link to="/search">Search</Link> ·{" "}
            <Link to="/briefs">My Briefs</Link>
          </p>
        </main>
      )}
    </DashboardShell>
  );
}
