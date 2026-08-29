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

  return (
    <main>
      <h1>Account</h1>
      <dl>
        <dt>Email</dt>
        <dd>{me.email}</dd>
        <dt>Role</dt>
        <dd>{me.role}</dd>
      </dl>
      <p>
        <Link to="/dashboard">Go to your dashboard</Link>
      </p>
      <button type="button" onClick={onLogout}>
        Log out
      </button>
    </main>
  );
}
