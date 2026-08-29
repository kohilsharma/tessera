import { Link } from "react-router-dom";
import { ErrorState } from "../components/uiStates";

// Shared error fallback for the role dashboards: a role-guarded route hit with
// the wrong role's token — a 403 from the API, or a role mismatch RoleDashboard
// caught first — lands here instead of crashing on absent data. A refusal, not
// a failure, so it wears the error treatment with no retry: the same request
// would be refused again.
export default function DashboardError({ message }: { message: string }) {
  return (
    <main>
      <ErrorState>
        <p>{message}</p>
        <Link to="/dashboard">Go to your dashboard</Link>
      </ErrorState>
    </main>
  );
}
