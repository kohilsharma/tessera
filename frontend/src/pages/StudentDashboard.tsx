import { useQuery } from "@tanstack/react-query";
import { getStudentDashboard } from "../api/client";
import DashboardError from "./DashboardError";

export default function StudentDashboard() {
  const { data, error, isLoading } = useQuery({ queryKey: ["dashboard", "student"], queryFn: getStudentDashboard });

  if (isLoading) return <p role="status">Loading your dashboard…</p>;
  if (error) return <DashboardError message={(error as Error).message} />;

  return (
    <main>
      <h1>Student dashboard</h1>
      <p>
        Study collections:{" "}
        {data!.studyCollections.length === 0 ? "none yet" : data!.studyCollections.length}
      </p>
    </main>
  );
}
