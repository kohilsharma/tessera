import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getInvestorDashboard } from "../api/client";
import DashboardShell from "./DashboardShell";
import { EmptyState } from "../components/uiStates";

export default function InvestorDashboard() {
  const query = useQuery({ queryKey: ["dashboard", "investor"], queryFn: getInvestorDashboard });

  return (
    <DashboardShell query={query}>
      {(data) => (
        <main>
          <h1>Investor dashboard</h1>
          <h2>Sectors</h2>
          {data.sectors.length === 0 ? (
            <EmptyState>
              No sectors yet — run <code>npm run seed</code> in <code>backend/</code> to load the corpus.
            </EmptyState>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">Sector</th>
                  <th scope="col">Stories</th>
                  <th scope="col">Articles</th>
                </tr>
              </thead>
              <tbody>
                {data.sectors.map((sector) => (
                  <tr key={sector.category}>
                    <th scope="row">
                      <Link to={`/stories?category=${sector.category}`}>{sector.category}</Link>
                    </th>
                    <td>{sector.storyCount}</td>
                    <td>{sector.articleCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p>
            <Link to="/stories">Browse Stories</Link> · <Link to="/search">Search</Link> ·{" "}
            <Link to="/briefs">My Briefs</Link>
          </p>
        </main>
      )}
    </DashboardShell>
  );
}
