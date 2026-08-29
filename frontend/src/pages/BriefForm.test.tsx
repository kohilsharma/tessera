import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BriefForm from "./BriefForm";
import { jsonResponse, renderWithProviders } from "../test/renderWithProviders";

const existingBrief = {
  id: "b1",
  title: "Supply chain watch",
  note: "Tracking packaging capacity.",
  category: "technology" as const,
  articleCapacityLimit: 12,
  coverImageKey: null,
  coverImageUrl: null,
  ownerId: "u1",
  articleCount: 0,
  createdAt: "2026-01-02T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  articles: [],
};

// Create is /briefs/new (no :id); edit is /briefs/:id/edit.
const editRoute = { route: "/briefs/b1/edit", path: "/briefs/:id/edit" };

describe("BriefForm — validation", () => {
  it("blocks submission and names the empty required field, without calling the API", async () => {
    renderWithProviders(<BriefForm />);

    await userEvent.click(screen.getByRole("button", { name: "Create Brief" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Title is required");
    expect(screen.getByLabelText("Title")).toHaveAttribute("aria-invalid", "true");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a non-positive article capacity", async () => {
    renderWithProviders(<BriefForm />);

    await userEvent.type(screen.getByLabelText("Title"), "A Brief");
    await userEvent.clear(screen.getByLabelText("Article capacity"));
    await userEvent.type(screen.getByLabelText("Article capacity"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Create Brief" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Must be a positive integer");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("clears a field's error as soon as the field is edited", async () => {
    renderWithProviders(<BriefForm />);

    await userEvent.click(screen.getByRole("button", { name: "Create Brief" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Title is required");

    await userEvent.type(screen.getByLabelText("Title"), "A");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("BriefForm — submission", () => {
  it("disables the submit button and shows progress while the request is in flight", async () => {
    let resolve: (res: Response) => void = () => {};
    vi.mocked(fetch).mockReturnValue(new Promise<Response>((r) => (resolve = r)));

    renderWithProviders(<BriefForm />);
    await userEvent.type(screen.getByLabelText("Title"), "A Brief");
    await userEvent.click(screen.getByRole("button", { name: "Create Brief" }));

    const button = await screen.findByRole("button", { name: "Saving…" });
    expect(button).toBeDisabled();

    resolve(jsonResponse(existingBrief, 201));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Saving…" })).not.toBeInTheDocument());
  });

  it("posts every field and re-enables the button after a failure", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: "Brief violates a database constraint" }, 422));

    renderWithProviders(<BriefForm />);
    await userEvent.type(screen.getByLabelText("Title"), "A Brief");
    await userEvent.type(screen.getByLabelText("Note"), "Some context");
    await userEvent.selectOptions(screen.getByLabelText("Category"), "science");
    await userEvent.click(screen.getByRole("button", { name: "Create Brief" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Brief violates a database constraint");
    expect(screen.getByRole("button", { name: "Create Brief" })).toBeEnabled();

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      title: "A Brief",
      note: "Some context",
      category: "science",
      articleCapacityLimit: 20,
    });
  });
});

describe("BriefForm — edit mode UI states", () => {
  it("shows a loading state while the existing Brief is fetched", () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));

    renderWithProviders(<BriefForm />, editRoute);

    expect(screen.getByRole("status")).toHaveTextContent("Loading Brief…");
  });

  it("shows an error state with a working retry when the Brief will not load", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ error: "Brief not found" }, 404))
      .mockResolvedValueOnce(jsonResponse(existingBrief));

    renderWithProviders(<BriefForm />, editRoute);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this Brief: Brief not found");

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByLabelText("Title")).toHaveValue("Supply chain watch");
  });

  it("populates every field from the loaded Brief and PATCHes the change", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(existingBrief));

    renderWithProviders(<BriefForm />, editRoute);

    expect(await screen.findByLabelText("Title")).toHaveValue("Supply chain watch");
    expect(screen.getByLabelText("Note")).toHaveValue("Tracking packaging capacity.");
    expect(screen.getByLabelText("Category")).toHaveValue("technology");
    expect(screen.getByLabelText("Article capacity")).toHaveValue(12);

    await userEvent.clear(screen.getByLabelText("Title"));
    await userEvent.type(screen.getByLabelText("Title"), "Renamed Brief");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      const [url, init] = vi.mocked(fetch).mock.calls.at(-1)! as [string, RequestInit];
      expect(url).toBe("/api/v1/briefs/b1");
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(init.body as string).title).toBe("Renamed Brief");
    });
  });
});


// The one behaviour #35 adds rather than restyles: the Brief form's own cover
// control. Everything else in the Form archetype is presentation, which jsdom
// cannot judge — see #28's testing decisions.
describe("BriefForm — the cover image control", () => {
  // jsdom implements neither, and the preview and the owner-only existing cover
  // both arrive as object URLs — the same stubs the record pages' test needs.
  function stubObjectUrls(url: string) {
    URL.createObjectURL = () => url;
    URL.revokeObjectURL = () => {};
  }

  const file = () => new File(["bytes"], "cover.png", { type: "image/png" });

  it("shows the file the owner picked, and uploads it once the Brief is saved", async () => {
    stubObjectUrls("blob:selected");
    vi.mocked(fetch).mockResolvedValue(jsonResponse(existingBrief, 201));

    renderWithProviders(<BriefForm />);
    await userEvent.type(screen.getByLabelText("Title"), "A Brief");
    await userEvent.upload(screen.getByLabelText("Cover image"), file());

    // The image itself is decorative (alt=""), so the note beside it is what
    // states which image is about to be saved.
    expect(screen.getByText(/cover\.png/)).toBeInTheDocument();
    expect(document.querySelector("img")).toHaveAttribute("src", "blob:selected");

    await userEvent.click(screen.getByRole("button", { name: "Create Brief" }));

    await waitFor(() => {
      const [url, init] = vi.mocked(fetch).mock.calls.at(-1)! as [string, RequestInit];
      expect(url).toBe("/api/v1/briefs/b1/cover-image");
      expect(init.method).toBe("POST");
      expect((init.body as FormData).get("coverImage")).toBeInstanceOf(File);
    });
  });

  it("shows the existing cover in edit mode until a new file replaces it", async () => {
    stubObjectUrls("blob:existing");
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        ...existingBrief,
        coverImageKey: "briefs/b1/cover.png",
        coverImageUrl: "/api/v1/briefs/b1/cover-image",
      }),
    );

    renderWithProviders(<BriefForm />, editRoute);

    expect(await screen.findByText("Current cover")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector("img")).toBeInTheDocument());

    await userEvent.upload(screen.getByLabelText("Cover image"), file());
    expect(screen.getByText(/cover\.png/)).toBeInTheDocument();
  });

  it("reports a failed upload without creating a second Brief on retry", async () => {
    stubObjectUrls("blob:selected");
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(existingBrief, 201))
      .mockResolvedValueOnce(jsonResponse({ error: "Cover image must be an image" }, 415))
      .mockResolvedValue(jsonResponse(existingBrief));

    renderWithProviders(<BriefForm />);
    await userEvent.type(screen.getByLabelText("Title"), "A Brief");
    await userEvent.upload(screen.getByLabelText("Cover image"), file());
    await userEvent.click(screen.getByRole("button", { name: "Create Brief" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Cover image must be an image");

    await userEvent.click(screen.getByRole("button", { name: "Create Brief" }));

    // The Brief already exists, so the retry updates it rather than POSTing a
    // duplicate.
    await waitFor(() => {
      const patched = vi.mocked(fetch).mock.calls.find(([, init]) => (init as RequestInit)?.method === "PATCH");
      expect(patched?.[0]).toBe("/api/v1/briefs/b1");
    });
    const creates = vi
      .mocked(fetch)
      .mock.calls.filter(([url, init]) => url === "/api/v1/briefs" && (init as RequestInit)?.method === "POST");
    expect(creates).toHaveLength(1);
  });
});
