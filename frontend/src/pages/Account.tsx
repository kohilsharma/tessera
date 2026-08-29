import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { getMe, logout } from "../api/client";
import { PendingState, RetryableError } from "../components/uiStates";

export default function Account() {
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ["me"], queryFn: getMe });

  function onLogout() {
    logout();
    navigate("/login");
  }

  if (query.isPending) return <PendingState>Loading account…</PendingState>;
  if (query.isError)
    return (
      <RetryableError
        message={`Could not load account: ${query.error.message}`}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );

  const me = query.data;

  // A stated page (#37): a title over a register of facts and the band of what
  // can be done about them. No archetype of its own — the facts are the record
  // page's note register and the actions are its action band, because this is a
  // record of two facts, not an index, a form, or a dashboard.
  return (
    <main className="stated-page">
      <h1>Account</h1>
      <dl className="record-note">
        <div>
          <dt>Email</dt>
          <dd>{me.email}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{me.role}</dd>
        </div>
      </dl>
      <div className="record-actions">
        <Link className="record-command" to="/dashboard">
          Go to your dashboard
        </Link>
        <button type="button" onClick={onLogout}>
          Log out
        </button>
      </div>
    </main>
  );
}
