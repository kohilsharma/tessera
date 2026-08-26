import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getStudentDashboard } from "../api/client";
import DashboardShell from "./DashboardShell";

export default function StudentDashboard() {
  const query = useQuery({ queryKey: ["dashboard", "student"], queryFn: getStudentDashboard });

  return (
    <DashboardShell query={query}>
      {(data) => (
        <main>
          <h1>Student dashboard</h1>
          <p>
            Study collections:{" "}
            {data.studyCollections.length === 0 ? "none yet" : data.studyCollections.length}
          </p>
          <p>
            <Link to="/stories">Browse Stories</Link>
          </p>
        </main>
      )}
    </DashboardShell>
  );
}
