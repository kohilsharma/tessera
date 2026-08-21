import { useQuery } from "@tanstack/react-query";
import { getHealth } from "../api/client";

export default function HealthStatus() {
  const { data, error, isLoading } = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
  });

  if (isLoading) return <p role="status">Checking system status…</p>;
  if (error) return <p role="alert">System status unavailable: {(error as Error).message}</p>;

  return (
    <dl>
      <dt>API status</dt>
      <dd>{data!.status}</dd>
      <dt>Database</dt>
      <dd>{data!.db}</dd>
      <dt>Checked at</dt>
      <dd>{data!.timestamp}</dd>
    </dl>
  );
}
