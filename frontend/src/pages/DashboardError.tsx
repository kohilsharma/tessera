import { Link } from "react-router-dom";

// Shared 403/error fallback for the three role dashboards below: a role-guarded
// route hit directly with the wrong role's token lands here instead of crashing.
export default function DashboardError({ message }: { message: string }) {
  return (
    <main>
      <p role="alert">{message}</p>
      <Link to="/dashboard">Go to your dashboard</Link>
    </main>
  );
}
