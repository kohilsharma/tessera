import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getStudentDashboard } from "../api/client";
import DashboardShell from "./DashboardShell";
import {
  DashboardOnward,
  DashboardPage,
  DashboardRegister,
  RegisterRow,
} from "../components/dashboardArchetype";
import { EmptyState, EntryList } from "../components/uiStates";

// The Student surface (#36): the study collections themselves, as a register.
// A collection is an owned Brief (backend/src/routes/dashboard.ts), so each row
// opens the Brief it is — the count this page used to print was a number you
// could do nothing with.
export default function StudentDashboard() {
  const query = useQuery({ queryKey: ["dashboard", "student"], queryFn: getStudentDashboard });

  return (
    <DashboardShell query={query}>
      {(data) => (
        <DashboardPage
          role="student"
          folio="Student dashboard"
          title="Study desk"
          dek="Your study collections, and the corpus they are built from."
        >
          <DashboardRegister
            heading="Study collections"
            folio={`${data.studyCollections.length} registered`}
          >
            {data.studyCollections.length === 0 ? (
              <EmptyState>
                <p>No study collections yet — a collection is a Brief you own.</p>
                <p>
                  <Link to="/briefs/new">Start one</Link>, or{" "}
                  <Link to="/stories">browse the corpus</Link> first.
                </p>
              </EmptyState>
            ) : (
              <EntryList>
                {data.studyCollections.map((collection) => (
                  <RegisterRow
                    key={collection.id}
                    name={collection.title}
                    to={`/briefs/${collection.id}`}
                    meta={[{ term: "Category", value: collection.category }]}
                  />
                ))}
              </EntryList>
            )}
          </DashboardRegister>

          <DashboardOnward
            links={[
              { to: "/stories", label: "Browse Stories" },
              { to: "/search", label: "Search the corpus" },
              { to: "/briefs", label: "My Briefs" },
              { to: "/study", label: "Study flashcards" },
            ]}
          />
        </DashboardPage>
      )}
    </DashboardShell>
  );
}
