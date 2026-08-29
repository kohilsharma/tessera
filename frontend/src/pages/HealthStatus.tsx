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

  return (
    <dl>
      <dt>API status</dt>
      <dd>{query.data.status}</dd>
      <dt>Database</dt>
      <dd>{query.data.db}</dd>
      <dt>Checked at</dt>
      <dd>{query.data.timestamp}</dd>
    </dl>
  );
}
