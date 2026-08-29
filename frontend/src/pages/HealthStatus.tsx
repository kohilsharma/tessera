import { useQuery } from "@tanstack/react-query";
import { getHealth } from "../api/client";
import { PendingState, RetryableError } from "../components/uiStates";

export default function HealthStatus() {
  const query = useQuery({ queryKey: ["health"], queryFn: getHealth });

  if (query.isPending) return <PendingState>Checking system status…</PendingState>;
  if (query.isError)
    return (
      <RetryableError
        message={`System status unavailable: ${query.error.message}`}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );

  // The same stated page as Account (#37): a title over a register of facts. It
  // had no heading at all before the sweep, which left the one route a
  // signed-out visitor can reach as an unlabelled list of values.
  return (
    <main className="stated-page">
      <h1>System status</h1>
      <dl className="record-note">
        <div>
          <dt>API status</dt>
          <dd>{query.data.status}</dd>
        </div>
        <div>
          <dt>Database</dt>
          <dd>{query.data.db}</dd>
        </div>
        <div>
          <dt>Checked at</dt>
          <dd>
            <time dateTime={query.data.timestamp}>{query.data.timestamp}</time>
          </dd>
        </div>
      </dl>
    </main>
  );
}
