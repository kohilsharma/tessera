import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { getMe, logout } from "../api/client";

export default function Account() {
  const navigate = useNavigate();
  const { data, error, isLoading } = useQuery({ queryKey: ["me"], queryFn: getMe });

  function onLogout() {
    logout();
    navigate("/login");
  }

  if (isLoading) return <p role="status">Loading account…</p>;
  if (error) return <p role="alert">Could not load account: {(error as Error).message}</p>;

  return (
    <main>
      <h1>Account</h1>
      <dl>
        <dt>Email</dt>
        <dd>{data!.email}</dd>
        <dt>Role</dt>
        <dd>{data!.role}</dd>
      </dl>
      <button type="button" onClick={onLogout}>
        Log out
      </button>
    </main>
  );
}
