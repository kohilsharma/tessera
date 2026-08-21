import { Link } from "react-router-dom";

// Shared error fallback for the role dashboards: a role-guarded route hit with
// the wrong role's token — a 403 from the API, or a role mismatch RoleDashboard
// caught first — lands here instead of crashing on absent data.
export default function DashboardError({ message }: { message: string }) {
  return (
    <main>
      <p role="alert">{message}</p>
      <Link to="/dashboard">Go to your dashboard</Link>
    </main>
  );
}
