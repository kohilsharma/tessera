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
  //
  // "ok" is the backend's own vocabulary, as ArticleDetail says of an Analysis
  // Text Mode: what the page states is what a reader can act on. The failing side
  // of each is reachable only in theory — a down database answers 500 and this
  // page shows the shared error treatment instead — but stating one value in
  // words and the other raw would be the worse half of the same choice.
  return (
    <main className="stated-page">
      <h1>System status</h1>
      <dl className="record-note">
        <div>
          <dt>API</dt>
          <dd>{query.data.status === "ok" ? "Responding" : "Not responding"}</dd>
        </div>
        <div>
          <dt>Database</dt>
          <dd>{query.data.db === "ok" ? "Connected" : "Unreachable"}</dd>
        </div>
        <div>
          <dt>Checked at</dt>
          <dd>
            <time dateTime={query.data.timestamp}>
              {new Date(query.data.timestamp).toLocaleString()}
            </time>
          </dd>
        </div>
      </dl>
    </main>
  );
}
