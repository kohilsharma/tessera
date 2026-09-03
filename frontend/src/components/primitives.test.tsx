import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button, CitationChip, EmptyState, ErrorState, LoadingState, RefusedState, TextField } from "./primitives";

describe("shared primitives", () => {
  it("renders accessible states and token-backed controls", () => {
    render(
      <>
        <LoadingState label="Loading stories" />
        <EmptyState title="No stories">Search the corpus to begin.</EmptyState>
        <ErrorState message="The request failed" onRetry={vi.fn()} />
        <RefusedState role="Admin" />
        <TextField label="Query" placeholder="Search" />
        <Button>Save</Button>
        <CitationChip evidenceId="A1" publisher="Example" href="/articles/1" />
      </>,
    );

    expect(screen.getByRole("status", { name: "Loading stories" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No stories" })).toBeInTheDocument();
    expect(screen.getByRole("alert", { name: /restricted/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Query")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "A1 · Example" })).toHaveAttribute("href", "/articles/1");
  });

  it("states the visible and total rows in a bounded list", async () => {
    const { EntryList } = await import("./uiStates");
    render(
      <EntryList total={31}>
        <li>One</li>
        <li>Two</li>
        <li>Three</li>
        <li>Four</li>
        <li>Five</li>
      </EntryList>,
    );

    expect(screen.getByText("Showing 5 of 31")).toBeInTheDocument();
    expect(screen.getByRole("list")).toBeInTheDocument();
  });
});
