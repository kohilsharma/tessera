import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getMe, logout } from "../api/client";

// Its own component, not inlined into AppShell's header: primary nav must
// render without waiting on this query, so a loading identity can never hold
// up Stories/Search/My Briefs.
export default function IdentityMenu() {
  const navigate = useNavigate();
  const { data, isPending } = useQuery({ queryKey: ["me"], queryFn: getMe });

  if (isPending || !data) return <span className="identity-placeholder" role="status">…</span>;

  function onLogout() {
    logout();
    navigate("/login");
  }

  return (
    <details className="identity-menu">
      <summary>
        <span className="identity-email">{data.email}</span>
        <span className="role-tag">{data.role}</span>
      </summary>
      <div className="identity-panel">
        <Link to="/account">Account</Link>
        <button type="button" onClick={onLogout}>
          Sign out
        </button>
      </div>
    </details>
  );
}
