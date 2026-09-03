import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { getMe, logout, updateColorMode, type User } from "../api/client";
import { Field } from "../components/formArchetype";
import { PendingState, RetryableError } from "../components/uiStates";
import { COLOR_MODES, themeForRole, type ColorMode } from "../theme";

// The reader's own words for the three stored values. 'system' is named for what
// it defers to, because that is the whole difference between it and the other two.
const MODE_LABELS: Record<ColorMode, string> = {
  system: "Match my device",
  light: "Always light",
  dark: "Always dark",
};

export default function Account() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["me"], queryFn: getMe });

  // Written straight into ["me"] rather than invalidated: ThemeSync reads that
  // cache entry, so the answer *is* the repaint. An invalidate would repaint on
  // the refetch instead, one round trip after the reader chose.
  const setMode = useMutation({
    mutationFn: updateColorMode,
    onSuccess: (user: User) => queryClient.setQueryData(["me"], user),
  });

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
  const theme = themeForRole(me.role);

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
        {/* Stated, not offered: the Role Theme is a fact of the role (DESIGN.md
            §3), so it belongs in the register beside the role that decides it
            rather than in the control below — which is the half that *is* the
            reader's. Named in full because a bare "Theme" is a GDELT subject
            code everywhere else in the product (CONTEXT.md). */}
        <div>
          <dt>Role Theme</dt>
          <dd>{theme} — set by your role</dd>
        </div>
      </dl>
      <Field
        id="color-mode"
        label="Appearance"
        error={setMode.isError ? setMode.error.message : undefined}
        hint="Light or dark, within your Role Theme."
      >
        {(props) => (
          <select
            {...props}
            value={me.colorMode}
            disabled={setMode.isPending}
            onChange={(event) => setMode.mutate(event.target.value as ColorMode)}
          >
            {COLOR_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="record-actions">
        <Link className="record-command" to="/dashboard">
          Go to your dashboard
        </Link>
        <button type="button" onClick={onLogout}>
          Sign out
        </button>
      </div>
    </main>
  );
}
