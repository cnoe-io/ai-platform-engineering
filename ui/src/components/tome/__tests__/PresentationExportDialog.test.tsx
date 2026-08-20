import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { PresentationExportDialog } from "@/components/tome/PresentationExportDialog";

const initialDeck = {
  title: "Project briefing",
  subtitle: "",
  slides: [
    {
      id: "overview",
      title: "Overview",
      subtitle: "Current state",
      bullets: [{ text: "Grounded overview", source_refs: ["overview.md"], generated: false }],
      visual: { kind: "diagram", description: "Source-backed diagram", source_refs: ["overview.md"] },
      speaker_notes: "Introduce the project.",
    },
    {
      id: "next-steps",
      title: "Next steps",
      subtitle: "",
      bullets: [{ text: "Approve the plan", source_refs: [], generated: true }],
      visual: null,
      speaker_notes: "",
    },
  ],
};

function streamedResponse(frames: string[]): Response {
  let sent = false;
  const stream = frames.join("");
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => {
          if (sent) return { done: true, value: undefined };
          sent = true;
          return { done: false, value: new Uint8Array(Buffer.from(stream)) };
        },
      }),
    },
  } as unknown as Response;
}

function generationStream(deck: typeof initialDeck): Response {
  return streamedResponse([
    "event: status\ndata: {\"message\":\"Generating a deck from 1 wiki source(s)…\"}\n\n",
    "event: token\ndata: {\"text\":\"{\\\"title\\\":\\\"Project briefing\\\"\"}\n\n",
    `event: complete\ndata: ${JSON.stringify({
      deck,
      model: "test-model",
      model_source: "environment",
    })}\n\n`,
  ]);
}

describe("PresentationExportDialog", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("opens an in-app popup and shows AI Assist output as it streams", async () => {
    const completedRequirements = {
      goal: "Create a streamed briefing.",
      key_message: "The project is ready for a decision.",
      audience: "Project sponsors",
      slide_count: 6,
      duration_minutes: 10,
      tone: "executive",
      technical_detail: "balanced",
      required_sections: "Context, decision, next steps",
      excluded_topics: "Unsupported forecasts",
      visual_mode: "both",
      visual_preferences: "Simple status visuals",
      include_speaker_notes: true,
    };
    const stream = [
      "event: status\ndata: {\"message\":\"Reviewing 1 selected wiki source(s)…\"}\n\n",
      "event: token\ndata: {\"text\":\"{\\\"goal\\\": \\\"Create a streamed\"}\n\n",
      `event: complete\ndata: ${JSON.stringify({
        requirements: completedRequirements,
        model: "provider/example-model",
        model_source: "environment",
      })}\n\n`,
    ].join("");
    jest.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/pages")) {
        return {
          ok: true,
          json: async () => ({
            data: {
              pages: {
                "overview.md": "---\ntitle: Overview\nkind: stable\n---\nVisible content",
              },
            },
          }),
        } as Response;
      }
      if (url.endsWith("/presentations/assist")) {
        return streamedResponse([stream]);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(
      <PresentationExportDialog
        slug="example-project"
        currentPath="overview.md"
        open
        onOpenChange={jest.fn()}
      />,
    );

    expect(screen.getByText("Beta")).toBeInTheDocument();

    const assistButton = screen.getByRole("button", { name: /Fill form with AI/ });
    await waitFor(() => expect(assistButton).toBeEnabled());
    fireEvent.click(assistButton);

    const streamDialog = await screen.findByRole("dialog", { name: /AI Assist stream/ });
    await within(streamDialog).findByText(/Create a streamed/);
    await within(streamDialog).findByText("Brief ready to review");
    expect(screen.getByDisplayValue("Create a streamed briefing.")).toBeInTheDocument();
    expect(within(streamDialog).getByRole("button", { name: "Review filled brief" })).toBeEnabled();
  });

  it("includes slide edits and reordered slides in a slide-scoped revision request", async () => {
    const generationBodies: Array<Record<string, unknown>> = [];
    jest.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/pages")) {
        return {
          ok: true,
          json: async () => ({
            data: {
              pages: {
                "overview.md": "---\ntitle: Overview\nkind: stable\n---\nVisible content",
              },
            },
          }),
        } as Response;
      }
      if (url.endsWith("/presentations/generate")) {
        generationBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return generationStream(initialDeck);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(
      <PresentationExportDialog
        slug="example-project"
        currentPath="overview.md"
        open
        onOpenChange={jest.fn()}
      />,
    );

    const composeButton = screen.getByRole("button", { name: /Compose prompt/ });
    await waitFor(() => expect(composeButton).toBeEnabled());
    fireEvent.click(composeButton);
    fireEvent.click(screen.getByRole("button", { name: /Generate deck/ }));

    const generationDialog = await screen.findByRole("dialog", { name: /AI deck generation stream/ });
    await within(generationDialog).findByText(/Project briefing/);
    fireEvent.click(await within(generationDialog).findByRole("button", { name: "Review deck" }));
    await screen.findByText("2 slides");
    expect(screen.getByRole("button", { name: /Export \.html/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export \.pptx/ })).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("Overview"), { target: { value: "Edited overview" } });
    fireEvent.change(screen.getByDisplayValue("Grounded overview"), { target: { value: "Human-edited overview" } });
    fireEvent.change(screen.getByDisplayValue("Source-backed diagram"), { target: { value: "Human-edited diagram" } });
    fireEvent.click(screen.getByRole("button", { name: /Move down/ }));
    fireEvent.change(screen.getByLabelText("Ask AI to refine"), {
      target: { value: "Make this slide more concise" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Revise slide/ }));

    await waitFor(() => expect(generationBodies).toHaveLength(2));
    const revision = generationBodies[1];
    expect(revision.slide_id).toBe("overview");
    expect(revision.revision_instruction).toBe(
      "Revise only slide overview: Make this slide more concise",
    );

    const existing = revision.existing_deck as typeof initialDeck;
    expect(existing.slides.map((slide) => slide.id)).toEqual(["next-steps", "overview"]);
    expect(existing.slides[1]).toMatchObject({
      title: "Edited overview",
      bullets: [{ text: "Human-edited overview", source_refs: [], generated: true }],
      visual: { description: "Human-edited diagram", source_refs: [] },
    });
  });
});
