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

// The Student surface (#36): the Briefs and Flashcards a Student owns.
// Each row
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
          title="Your desk"
          dek="Review Flashcards, revisit saved Briefs, and study from cited reporting."
        >
          <DashboardRegister heading="Flashcards" folio={`${data.flashcards.dueCount} due`}>
            <EntryList>
              <RegisterRow
                name={
                  data.flashcards.dueCount > 0
                    ? `Review ${data.flashcards.dueCount} flashcard${data.flashcards.dueCount === 1 ? "" : "s"}`
                    : data.flashcards.totalCount > 0
                      ? "No flashcards due"
                      : "Make your first flashcards"
                }
                to="/study"
                note={
                  data.flashcards.dueCount > 0
                    ? "Ready for review now."
                    : data.flashcards.totalCount > 0
                      ? "Your review queue is clear."
                      : "Build a cited deck from a Story or Brief analysis."
                }
                meta={[
                  { term: "Due now", value: data.flashcards.dueCount },
                  { term: "In deck", value: data.flashcards.totalCount },
                ]}
              />
            </EntryList>
          </DashboardRegister>

          <DashboardRegister
            heading="My Briefs"
            folio={`${data.studyCollections.length} saved`}
          >
            {data.studyCollections.length === 0 ? (
              <EmptyState>
                <p>No Briefs yet. Create one to keep your own cited reading.</p>
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
