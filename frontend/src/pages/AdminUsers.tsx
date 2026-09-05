import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ApiError, getAdminUser, getAdminUsers, updateAdminUser, USER_ROLES, type AdminUser, type UserRole } from "../api/client";
import { DateStamp, Entry, EntryRegister, FilterRegister, IndexPage } from "../components/indexArchetype";
import { EmptyState, ErrorState, PendingState, RefusedState, RetryableError } from "../components/uiStates";
import { RecordMasthead, RecordSection } from "../components/recordArchetype";

const roleLabels: Record<UserRole, string> = { student: "Student", investor: "Investor", admin: "Admin" };

export default function AdminUsers() {
  const { id } = useParams();
  return id ? <AdminUserDetail id={id} /> : <AdminUserIndex />;
}

function AdminUserIndex() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const q = params.get("q") ?? "";
  const role = params.get("role") as UserRole | "";
  const active = params.get("active");
  const query = useQuery({
    queryKey: ["admin-users", { page, q, role, active }],
    queryFn: () => getAdminUsers({ page, q: q || undefined, role: role || undefined, active: active === null || active === "" ? undefined : active === "true" }),
  });
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    next.delete("page");
    setParams(next);
  };
  return (
    <IndexPage title="Users">
      <FilterRegister label="Filter users">
        <label className="filter-field">Search <input type="search" value={q} onChange={(e) => update("q", e.target.value)} /></label>{" "}
        <label className="filter-field">Role <select value={role} onChange={(e) => update("role", e.target.value)}><option value="">All roles</option>{USER_ROLES.map((item) => <option key={item} value={item}>{roleLabels[item]}</option>)}</select></label>{" "}
        <label className="filter-field">Status <select value={active ?? ""} onChange={(e) => update("active", e.target.value)}><option value="">All accounts</option><option value="true">Active</option><option value="false">Deactivated</option></select></label>
      </FilterRegister>
      {query.isPending && <PendingState>Loading users…</PendingState>}
      {query.isError && (query.error instanceof ApiError && query.error.status === 403 ? <RefusedState role="your role">{query.error.message}</RefusedState> : <RetryableError message={query.error.message} onRetry={() => query.refetch()} retrying={query.isFetching} />)}
      {query.isSuccess && query.data.items.length === 0 && <EmptyState><p>No users match these filters.</p></EmptyState>}
      {query.isSuccess && query.data.items.length > 0 && (
        <EntryRegister envelope={query.data} onGoToPage={(next) => { const nextParams = new URLSearchParams(params); nextParams.set("page", String(next)); setParams(nextParams); }}>
          {query.data.items.map((user) => <Entry key={user.id} to={`/admin/users/${user.id}`} title={user.email} meta={[{ term: "Role", value: roleLabels[user.role] }, { term: "Status", value: user.active ? "Active" : "Deactivated" }, { term: "Created", value: <DateStamp iso={user.createdAt} /> }]} />)}
        </EntryRegister>
      )}
    </IndexPage>
  );
}

function AdminUserDetail({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["admin-user", id], queryFn: () => getAdminUser(id) });
  const update = useMutation({ mutationFn: (input: Partial<Pick<AdminUser, "role" | "active">>) => updateAdminUser(id, input), onSuccess: (user) => queryClient.setQueryData(["admin-user", id], user) });
  if (query.isPending) return <main><PendingState>Loading this user…</PendingState></main>;
  if (query.isError) return <main>{query.error instanceof ApiError && query.error.status === 403 ? <RefusedState role="your role">{query.error.message}</RefusedState> : <RetryableError message={query.error.message} onRetry={() => query.refetch()} retrying={query.isFetching} />}</main>;
  const user = query.data;
  if (!user) return <main><EmptyState><p>This user no longer exists.</p></EmptyState></main>;
  return (
    <main className="record">
      <RecordMasthead folio="User account" back={{ to: "/admin/users", label: "All users" }} title={user.email} dek={user.active ? "This account can authenticate." : "This account is deactivated and cannot authenticate."} ledger={[{ term: "Role", value: roleLabels[user.role] }, { term: "Status", value: user.active ? "Active" : "Deactivated" }, { term: "Created", value: <DateStamp iso={user.createdAt} withTime /> }]} />
      <RecordSection heading="Account controls">
        {update.error && (update.error instanceof ApiError && update.error.status === 403 ? <RefusedState role="Admin"><p>{update.error.message}</p></RefusedState> : <ErrorState><p>{update.error.message}</p><button type="button" onClick={() => update.variables && update.mutate(update.variables)} disabled={update.isPending}>Retry</button></ErrorState>)}
        <div className="record-actions">
          <label className="filter-field">Role <select value={user.role} disabled={update.isPending} onChange={(e) => update.mutate({ role: e.target.value as UserRole })}>{USER_ROLES.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label>
          <button type="button" disabled={update.isPending} onClick={() => update.mutate({ active: !user.active })}>{user.active ? "Deactivate account" : "Reactivate account"}</button>
        </div>
        <p className="record-prose">Deactivation is reversible. Tessera keeps the account and its owned records; there is no delete action.</p>
      </RecordSection>
    </main>
  );
}
