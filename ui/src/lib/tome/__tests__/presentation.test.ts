/** @jest-environment node */

import JSZip from "jszip";

import {
  buildPresentationPrompt,
  DEFAULT_PRESENTATION_REQUIREMENTS,
  defaultPresentationRequirements,
  normalizePresentationDeck,
  normalizePresentationRequirements,
  presentationSourceFromPage,
  presentationSourceUrl,
} from "@/lib/tome/presentation";
import { renderPresentationHtml } from "@/lib/tome/presentation-html";
import { renderPresentationPptx } from "@/lib/tome/presentation-pptx";

// PptxGenJS eagerly launches un-awaited node:fs/node:https dynamic imports,
// even for decks with no media. Jest's VM intentionally disables that import
// path; the renderer itself needs neither dependency for this text-only deck.
const releaseNameDescriptor = Object.getOwnPropertyDescriptor(process.release, "name")!;
beforeAll(() => Object.defineProperty(process.release, "name", { value: "jest", configurable: true }));
afterAll(() => Object.defineProperty(process.release, "name", releaseNameDescriptor));

const rawDeck = {
  title: "Example briefing",
  subtitle: "A source-grounded update",
  slides: [{
    id: "status",
    title: "Current status",
    subtitle: "",
    bullets: [
      { text: "The milestone is complete", source_refs: ["status.md"], generated: false },
      { text: "Prioritize the next risk", source_refs: [], generated: true },
    ],
    visual: {
      kind: "graphic",
      title: "Delivery milestones",
      layout: "timeline",
      groups: [
        { label: "Now", items: ["Design complete"] },
        { label: "Next", items: ["Launch review"] },
      ],
      connections: ["Design complete → Launch review"],
      description: "A simple milestone timeline",
      source_refs: ["status.md"],
    },
    speaker_notes: "Explain the source and recommendation separately.",
  }],
};

describe("TOME presentation export", () => {
  it("starts with a complete, subject-aware brief", () => {
    const requirements = defaultPresentationRequirements("Example Project");
    expect(requirements.goal).toContain("Example Project");
    expect(requirements.keyMessage).toContain("Example Project");
    expect(requirements.audience).toBeTruthy();
    expect(requirements.requiredSections).toContain("next steps");
    expect(requirements.excludedTopics).toBeTruthy();
  });

  it("normalizes AI Assist requirements and preserves safe fallbacks", () => {
    const requirements = normalizePresentationRequirements({
      goal: "Prepare the launch decision",
      key_message: "Evidence supports the next milestone",
      audience: "Project sponsors",
      slide_count: 99,
      duration_minutes: 20,
      tone: "persuasive",
      technical_detail: "low",
      required_sections: "Decision, evidence, risks",
      excluded_topics: "Unsupported forecasts",
      visual_mode: "graphics",
      visual_preferences: "Simple decision visuals",
      include_speaker_notes: false,
    });
    expect(requirements.slideCount).toBe(30);
    expect(requirements.tone).toBe("persuasive");
    expect(requirements.includeSpeakerNotes).toBe(false);
    expect(requirements.visualMode).toBe("graphics");
    expect(requirements.goal).toBe("Prepare the launch decision");
  });

  it("builds a reviewable prompt with the selected source manifest", () => {
    const prompt = buildPresentationPrompt(
      { ...DEFAULT_PRESENTATION_REQUIREMENTS, goal: "Align on delivery", audience: "Project sponsors" },
      [{ path: "status.md", title: "Status" }],
    );
    expect(prompt).toContain("Goal: Align on delivery");
    expect(prompt).toContain("Audience: Project sponsors");
    expect(prompt).toContain("Visual content: both");
    expect(prompt).toContain("Status (status.md)");
    expect(prompt).toContain("Mark synthesis");
  });

  it("sanitizes source content and validates model citations", () => {
    expect(presentationSourceFromPage("status.md", "---\ntitle: Status\n---\nVisible <!-- private -->")).toEqual({
      path: "status.md",
      title: "Status",
      content: "Visible",
    });
    expect(normalizePresentationDeck(rawDeck, ["status.md"]).slides[0].bullets[0].generated).toBe(false);
    expect(() => normalizePresentationDeck(rawDeck, ["overview.md"])).toThrow(
      "references an unselected page: status.md",
    );
  });

  it("builds encoded canonical links for nested wiki and repository sources", () => {
    expect(presentationSourceUrl(
      "https://tome.example.test/projects/example-project/tome/wiki/",
      "repos/example-repository/architecture notes.md",
    )).toBe(
      "https://tome.example.test/projects/example-project/tome/wiki/repos/example-repository/architecture%20notes.md",
    );
  });

  it("renders editable slides, source footers, and speaker notes into a valid pptx", async () => {
    const deck = normalizePresentationDeck(rawDeck, ["status.md"]);
    const sourceBaseUrl = "https://tome.example.test/projects/example-project/tome/wiki/";
    const bytes = await renderPresentationPptx({ deck, projectName: "Example Project", sourceBaseUrl });
    expect(Buffer.from(bytes.subarray(0, 2)).toString("ascii")).toBe("PK");
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file("[Content_Types].xml")).not.toBeNull();
    const slide = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const slideRelations = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
    const notes = await zip.file("ppt/notesSlides/notesSlide1.xml")!.async("string");
    expect(slide).toContain("Current status");
    expect(slide).toContain("Sources: ");
    expect(slide).toContain("[1] status.md");
    expect(slide).toContain("Prioritize the next risk  AI");
    expect(slide).toContain("GRAPHIC");
    expect(slide).toContain("Delivery milestones");
    expect(slide).toContain("Design complete");
    expect(slide).not.toContain("A simple milestone timeline");
    expect(slideRelations).toContain("https://tome.example.test/projects/example-project/tome/wiki/status.md");
    expect(notes).toContain("Explain the source and recommendation separately.");
    expect(notes).toContain("https://tome.example.test/projects/example-project/tome/wiki/status.md");
  });

  it("renders a self-contained, source-traceable HTML presentation", () => {
    const deck = normalizePresentationDeck(rawDeck, ["status.md"]);
    const html = renderPresentationHtml({
      deck,
      projectName: "Example Project",
      sourceBaseUrl: "https://tome.example.test/projects/example-project/tome/wiki/",
    });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Current status");
    expect(html).toContain("[1] https://tome.example.test/projects/example-project/tome/wiki/status.md");
    expect(html).toContain("href=\"https://tome.example.test/projects/example-project/tome/wiki/status.md\"");
    expect(html).toContain("Speaker notes");
    expect(html).toContain("Graphic");
    expect(html).toContain("visual-canvas timeline");
    expect(html).toContain("Design complete → Launch review");
    expect(html).toContain("IntersectionObserver");
  });

  it("turns legacy prose diagrams into bounded HTML nodes", () => {
    const legacyDeck = normalizePresentationDeck({
      title: "Architecture",
      slides: [{
        id: "architecture",
        title: "Platform architecture",
        bullets: [],
        visual: {
          kind: "diagram",
          description: "Layered architecture with swim lanes. Lane 1 'Clients': boxes 'Web UI' and 'Events'. Lane 2 'Services': boxes 'API' and 'Worker'. Connecting arrows: Clients → Services",
          source_refs: [],
        },
      }],
    }, []);
    const html = renderPresentationHtml({
      deck: legacyDeck,
      projectName: "Example Project",
      sourceBaseUrl: "https://tome.example.test/projects/example-project/tome/wiki/",
    });
    expect(html).toContain("visual-canvas layers");
    expect(html).toContain("<b>Clients</b>");
    expect(html).toContain("visual-node\">Web UI</span>");
    expect(html).toContain("Clients → Services");
    expect(html).not.toContain("<p>Layered architecture with swim lanes");
  });
});
