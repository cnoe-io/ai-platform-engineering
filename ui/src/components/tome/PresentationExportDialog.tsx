"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Download,
  FilePlus2,
  Loader2,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";

import { BetaBadge } from "@/components/tome/BetaBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  buildPresentationPrompt,
  defaultPresentationRequirements,
  normalizePresentationDeck,
  normalizePresentationRequirements,
  presentationSourceRefs,
  type PresentationDeck,
  type PresentationRequirements,
  type PresentationSlide,
  type PresentationSourceScope,
} from "@/lib/tome/presentation";
import { parseFrontmatter, SPEC_BY_PATH } from "@/lib/tome/schema";
import { cn } from "@/lib/utils";

interface PageChoice {
  path: string;
  title: string;
  hidden: boolean;
}

type Step = "requirements" | "prompt" | "preview";

function errorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const value = body as { error?: unknown; message?: unknown };
  if (typeof value.error === "string") return value.error;
  if (value.error && typeof value.error === "object" && "message" in value.error) {
    const message = (value.error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return typeof value.message === "string" ? value.message : fallback;
}

interface AssistStreamEvent {
  type: string;
  data: Record<string, unknown>;
}

function assistStreamEvent(frame: string): AssistStreamEvent | null {
  let type = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) type = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  const data = JSON.parse(dataLines.join("\n")) as unknown;
  return data && typeof data === "object" && !Array.isArray(data)
    ? { type, data: data as Record<string, unknown> }
    : null;
}

async function consumeAssistStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: AssistStreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let separator = buffer.indexOf("\n\n");
    while (separator >= 0) {
      const event = assistStreamEvent(buffer.slice(0, separator));
      buffer = buffer.slice(separator + 2);
      if (event) onEvent(event);
      separator = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
  const tail = assistStreamEvent(buffer);
  if (tail) onEvent(tail);
}

function pageChoices(pages: Record<string, string>): PageChoice[] {
  return Object.entries(pages).map(([path, markdown]) => {
    const [frontmatter] = parseFrontmatter(markdown);
    return {
      path,
      title: typeof frontmatter.title === "string" && frontmatter.title.trim()
        ? frontmatter.title.trim()
        : (SPEC_BY_PATH.get(path)?.title ?? path),
      hidden: (frontmatter.kind ?? SPEC_BY_PATH.get(path)?.kind) === "hidden",
    };
  }).sort((left, right) => left.title.localeCompare(right.title));
}

function presentationSubject(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function PresentationExportDialog({
  slug,
  currentPath,
  open,
  onOpenChange,
}: {
  slug: string;
  currentPath?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [step, setStep] = useState<Step>("requirements");
  const [scope, setScope] = useState<PresentationSourceScope>(currentPath ? "current" : "wiki");
  const [requirements, setRequirements] = useState<PresentationRequirements>(
    () => defaultPresentationRequirements(presentationSubject(slug)),
  );
  const [pages, setPages] = useState<PageChoice[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<string[]>(currentPath ? [currentPath] : []);
  const [prompt, setPrompt] = useState("");
  const [deck, setDeck] = useState<PresentationDeck | null>(null);
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
  const [revisionInstruction, setRevisionInstruction] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [loadingPages, setLoadingPages] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [assisting, setAssisting] = useState(false);
  const [assistInstruction, setAssistInstruction] = useState("");
  const [assistSummary, setAssistSummary] = useState<string | null>(null);
  const [assistStreamOpen, setAssistStreamOpen] = useState(false);
  const [assistOutput, setAssistOutput] = useState("");
  const [assistStatus, setAssistStatus] = useState("Ready");
  const [assistFinished, setAssistFinished] = useState(false);
  const [generationStreamOpen, setGenerationStreamOpen] = useState(false);
  const [generationOutput, setGenerationOutput] = useState("");
  const [generationStatus, setGenerationStatus] = useState("Ready");
  const [generationFinished, setGenerationFinished] = useState(false);
  const [generationStreamTitle, setGenerationStreamTitle] = useState("AI deck generation stream");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || pages.length > 0) return;
    let cancelled = false;
    setLoadingPages(true);
    setError(null);
    fetch(`/api/tome/projects/${encodeURIComponent(slug)}/pages`)
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(errorMessage(body, "Failed to load wiki pages"));
        if (!cancelled) setPages(pageChoices(body?.data?.pages ?? {}));
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Failed to load wiki pages");
      })
      .finally(() => {
        if (!cancelled) setLoadingPages(false);
      });
    return () => { cancelled = true; };
  }, [open, pages.length, slug]);

  const visiblePages = useMemo(() => pages.filter((page) => !page.hidden), [pages]);
  const sourcePaths = useMemo(() => {
    if (scope === "current") return currentPath ? [currentPath] : [];
    if (scope === "selected") return selectedPaths;
    return visiblePages.map((page) => page.path);
  }, [scope, currentPath, selectedPaths, visiblePages]);
  const sourceManifest = useMemo(
    () => sourcePaths.map((path) => {
      const page = pages.find((candidate) => candidate.path === path);
      return { path, title: page?.title ?? path };
    }),
    [pages, sourcePaths],
  );
  const selectedSlide = deck?.slides.find((slide) => slide.id === selectedSlideId) ?? deck?.slides[0] ?? null;

  const updateRequirement = <K extends keyof PresentationRequirements>(
    key: K,
    value: PresentationRequirements[K],
  ) => setRequirements((current) => ({ ...current, [key]: value }));

  const composePrompt = () => {
    setError(null);
    if (!requirements.goal.trim() || !requirements.audience.trim()) {
      setError("Goal and audience are required before composing the prompt.");
      return;
    }
    if (sourcePaths.length === 0) {
      setError("Select at least one source page.");
      return;
    }
    setPrompt(buildPresentationPrompt(requirements, sourceManifest));
    setStep("prompt");
  };

  const fillWithAi = async () => {
    if (sourcePaths.length === 0) {
      setError("Select at least one source page before using AI Assist.");
      return;
    }
    setAssisting(true);
    setError(null);
    setAssistSummary(null);
    setAssistOutput("");
    setAssistStatus("Connecting to AI Assist…");
    setAssistFinished(false);
    setAssistStreamOpen(true);
    try {
      const response = await fetch(`/api/tome/projects/${encodeURIComponent(slug)}/presentations/assist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_scope: scope,
          paths: sourcePaths,
          current_requirements: requirements,
          instruction: assistInstruction,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(errorMessage(body, "AI Assist failed"));
      }
      if (!response.body) throw new Error("AI Assist returned no stream");
      let completed = false;
      let receivedOutput = false;
      await consumeAssistStream(response.body, (event) => {
        if (event.type === "status" && typeof event.data.message === "string") {
          setAssistStatus(event.data.message);
        } else if (event.type === "token" && typeof event.data.text === "string") {
          const text = event.data.text;
          receivedOutput = true;
          setAssistOutput((current) => current + text);
          setAssistStatus("Building your presentation brief…");
        } else if (event.type === "complete") {
          const nextRequirements = normalizePresentationRequirements(
            event.data.requirements,
            requirements,
          );
          setRequirements(nextRequirements);
          if (!receivedOutput) setAssistOutput(JSON.stringify(event.data.requirements, null, 2));
          const nextModel = typeof event.data.model === "string" ? event.data.model : null;
          setAssistSummary(
            nextModel
              ? `AI Assist filled the brief with ${nextModel}. Review or edit anything before continuing.`
              : "AI Assist filled the brief. Review or edit anything before continuing.",
          );
          setAssistStatus("Brief ready to review");
          setAssistFinished(true);
          completed = true;
        } else if (event.type === "error") {
          throw new Error(
            typeof event.data.message === "string" ? event.data.message : "AI Assist failed",
          );
        }
      });
      if (!completed) throw new Error("AI Assist stream ended before the brief was ready");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "AI Assist failed";
      setError(message);
      setAssistStatus(message);
      setAssistFinished(true);
    } finally {
      setAssisting(false);
    }
  };

  const generate = async (options?: { existing?: PresentationDeck; instruction?: string; slideId?: string }) => {
    setGenerating(true);
    setError(null);
    setGenerationOutput("");
    setGenerationStatus("Connecting to presentation AI…");
    setGenerationFinished(false);
    setGenerationStreamTitle(
      options?.instruction
        ? (options.slideId ? "AI slide revision stream" : "AI deck revision stream")
        : "AI deck generation stream",
    );
    setGenerationStreamOpen(true);
    try {
      const response = await fetch(`/api/tome/projects/${encodeURIComponent(slug)}/presentations/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_scope: scope,
          paths: sourcePaths,
          prompt,
          ...(options?.existing ? { existing_deck: options.existing } : {}),
          ...(options?.instruction ? { revision_instruction: options.instruction } : {}),
          ...(options?.slideId ? { slide_id: options.slideId } : {}),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(errorMessage(body, "Presentation generation failed"));
      }
      if (!response.body) throw new Error("Presentation generation returned no stream");
      let completed = false;
      let receivedOutput = false;
      await consumeAssistStream(response.body, (event) => {
        if (event.type === "status" && typeof event.data.message === "string") {
          setGenerationStatus(event.data.message);
        } else if (event.type === "token" && typeof event.data.text === "string") {
          const text = event.data.text;
          receivedOutput = true;
          setGenerationOutput((current) => current + text);
          setGenerationStatus(options?.instruction ? "Refining the deck…" : "Building the deck…");
        } else if (event.type === "complete") {
          const nextDeck = normalizePresentationDeck(event.data.deck, sourcePaths);
          setDeck(nextDeck);
          setSelectedSlideId((current) => (
            nextDeck.slides.some((slide) => slide.id === current)
              ? current
              : nextDeck.slides[0]?.id ?? null
          ));
          if (!receivedOutput) setGenerationOutput(JSON.stringify(event.data.deck, null, 2));
          setModel(typeof event.data.model === "string" ? event.data.model : null);
          setRevisionInstruction("");
          setStep("preview");
          setGenerationStatus("Deck ready to review");
          setGenerationFinished(true);
          completed = true;
        } else if (event.type === "error") {
          throw new Error(
            typeof event.data.message === "string"
              ? event.data.message
              : "Presentation generation failed",
          );
        }
      });
      if (!completed) throw new Error("Presentation stream ended before the deck was ready");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Presentation generation failed";
      setError(message);
      setGenerationStatus(message);
      setGenerationFinished(true);
    } finally {
      setGenerating(false);
    }
  };

  const updateSlide = (id: string, patch: Partial<PresentationSlide>) => {
    setDeck((current) => current ? {
      ...current,
      slides: current.slides.map((slide) => slide.id === id ? { ...slide, ...patch } : slide),
    } : current);
  };

  const updateBulletText = (slide: PresentationSlide, value: string) => {
    const lines = value.split("\n").map((line) => line.trim()).filter(Boolean);
    const bullets = lines.map((text, index) => {
      const previous = slide.bullets[index];
      if (previous?.text === text) return previous;
      return { text, source_refs: [], generated: true };
    });
    updateSlide(slide.id, { bullets });
  };

  const moveSlide = (id: string, delta: -1 | 1) => {
    setDeck((current) => {
      if (!current) return current;
      const index = current.slides.findIndex((slide) => slide.id === id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= current.slides.length) return current;
      const slides = [...current.slides];
      [slides[index], slides[target]] = [slides[target], slides[index]];
      return { ...current, slides };
    });
  };

  const addSlide = () => {
    const id = `slide-${Date.now()}`;
    const slide: PresentationSlide = {
      id,
      title: "New slide",
      subtitle: "",
      bullets: [{ text: "Add content", source_refs: [], generated: true }],
      visual: null,
      speaker_notes: "",
    };
    setDeck((current) => current ? { ...current, slides: [...current.slides, slide] } : current);
    setSelectedSlideId(id);
  };

  const removeSlide = (id: string) => {
    setDeck((current) => {
      if (!current || current.slides.length === 1) return current;
      const slides = current.slides.filter((slide) => slide.id !== id);
      setSelectedSlideId(slides[0]?.id ?? null);
      return { ...current, slides };
    });
  };

  const exportDeck = async (format: "html" | "pptx") => {
    if (!deck) return;
    setExporting(true);
    setError(null);
    try {
      const response = await fetch(`/api/tome/projects/${encodeURIComponent(slug)}/presentations/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deck, format }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(errorMessage(body, `${format.toUpperCase()} export failed`));
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `presentation.${format}`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${format.toUpperCase()} export failed`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(92vh,900px)] max-w-6xl flex-col gap-3 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 pb-4 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Export as presentation
            <BetaBadge />
          </DialogTitle>
          <DialogDescription>
            {step === "requirements" && "Start with useful defaults, or let AI Assist build the brief from your selected sources."}
            {step === "prompt" && "Review and edit the exact generation prompt before invoking the model."}
            {step === "preview" && "Edit, reorder, refine, and export as HTML or editable PowerPoint."}
          </DialogDescription>
          <div className="flex gap-2 pt-2 text-xs">
            {(["requirements", "prompt", "preview"] as Step[]).map((item, index) => (
              <span key={item} className={cn("rounded-full px-2 py-1", step === item ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{index + 1}. {item}</span>
            ))}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden px-6">
          {step === "requirements" && (
            <ScrollArea className="h-full pr-4">
              <div className="space-y-5 py-2">
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                    <div className="min-w-0 flex-1 space-y-1">
                      <Label htmlFor="presentation-ai-guidance" className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-primary" /> AI Assist
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Uses the selected wiki pages to fill the goal, audience, key message, sections, exclusions, tone, detail, timing, and visual guidance.
                      </p>
                      <Input
                        id="presentation-ai-guidance"
                        value={assistInstruction}
                        onChange={(event) => setAssistInstruction(event.target.value)}
                        placeholder="Optional guidance, e.g. prepare a board update focused on delivery risk"
                        className="mt-2 bg-background"
                      />
                    </div>
                    <Button
                      type="button"
                      onClick={() => void fillWithAi()}
                      disabled={loadingPages || assisting || sourcePaths.length === 0}
                    >
                      {assisting ? <Loader2 className="animate-spin" /> : <Sparkles />}
                      {assisting ? "Reviewing sources…" : "Fill form with AI"}
                    </Button>
                  </div>
                  {assistSummary && <p role="status" className="mt-3 text-xs text-primary">{assistSummary}</p>}
                </div>

                <div className="grid gap-5 lg:grid-cols-2">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Source scope</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        ["current", "Current page"],
                        ["selected", "Selected pages"],
                        ["wiki", "Entire wiki"],
                      ] as const).map(([value, label]) => (
                        <button key={value} type="button" disabled={value === "current" && !currentPath} onClick={() => setScope(value)} className={cn("rounded-md border p-2 text-left text-xs", scope === value ? "border-primary bg-primary/5" : "border-border", "disabled:opacity-40")}>{label}</button>
                      ))}
                    </div>
                  </div>
                  {scope === "selected" && (
                    <div className="space-y-2">
                      <Label>Select wiki pages</Label>
                      <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
                        {loadingPages ? <p className="p-2 text-xs text-muted-foreground">Loading pages…</p> : visiblePages.map((page) => (
                          <label key={page.path} className="flex cursor-pointer items-start gap-2 rounded p-2 text-xs hover:bg-muted">
                            <input type="checkbox" checked={selectedPaths.includes(page.path)} onChange={(event) => setSelectedPaths((current) => event.target.checked ? [...current, page.path] : current.filter((path) => path !== page.path))} />
                            <span><span className="block font-medium">{page.title}</span><span className="font-mono text-[10px] text-muted-foreground">{page.path}</span></span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  <Field label="Goal" required><Textarea value={requirements.goal} onChange={(event) => updateRequirement("goal", event.target.value)} placeholder="What should this presentation accomplish?" /></Field>
                  <Field label="Key message"><Input value={requirements.keyMessage} onChange={(event) => updateRequirement("keyMessage", event.target.value)} placeholder="The one idea the audience should remember" /></Field>
                  <Field label="Audience" required><Input value={requirements.audience} onChange={(event) => updateRequirement("audience", event.target.value)} placeholder="e.g., engineering leadership" /></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Slide count"><Input type="number" min={3} max={30} value={requirements.slideCount} onChange={(event) => updateRequirement("slideCount", Math.max(3, Math.min(30, Number(event.target.value) || 3)))} /></Field>
                    <Field label="Speaking minutes"><Input type="number" min={1} max={180} value={requirements.durationMinutes ?? ""} onChange={(event) => updateRequirement("durationMinutes", event.target.value ? Number(event.target.value) : null)} /></Field>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Tone"><select value={requirements.tone} onChange={(event) => updateRequirement("tone", event.target.value as PresentationRequirements["tone"])} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="executive">Executive</option><option value="conversational">Conversational</option><option value="formal">Formal</option><option value="persuasive">Persuasive</option></select></Field>
                    <Field label="Technical detail"><select value={requirements.technicalDetail} onChange={(event) => updateRequirement("technicalDetail", event.target.value as PresentationRequirements["technicalDetail"])} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="low">Low</option><option value="balanced">Balanced</option><option value="high">High</option></select></Field>
                  </div>
                  <Field label="Visual content"><select value={requirements.visualMode} onChange={(event) => updateRequirement("visualMode", event.target.value as PresentationRequirements["visualMode"])} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="diagrams">Diagrams</option><option value="graphics">Graphics</option><option value="both">Diagrams and graphics</option><option value="none">Text only</option></select></Field>
                  <Field label="Required sections or topics"><Textarea value={requirements.requiredSections} onChange={(event) => updateRequirement("requiredSections", event.target.value)} placeholder="Opening context, architecture, risks, next steps…" /></Field>
                  <Field label="Topics to exclude"><Textarea value={requirements.excludedTopics} onChange={(event) => updateRequirement("excludedTopics", event.target.value)} placeholder="Anything the deck should avoid" /></Field>
                  <Field label="Visual or branding preferences"><Textarea value={requirements.visualPreferences} onChange={(event) => updateRequirement("visualPreferences", event.target.value)} /></Field>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={requirements.includeSpeakerNotes} onChange={(event) => updateRequirement("includeSpeakerNotes", event.target.checked)} /> Include speaker notes</label>
                  <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                    {sourcePaths.length} source page{sourcePaths.length === 1 ? "" : "s"} selected. Hidden agent-only pages are excluded from Entire wiki.
                  </div>
                </div>
                </div>
              </div>
            </ScrollArea>
          )}

          {step === "prompt" && (
            <div className="flex h-full flex-col gap-3 py-2">
              <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                Source bodies are attached securely by the server after access checks. The manifest below shows exactly which pages will be included.
              </div>
              <Textarea aria-label="Presentation prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} className="min-h-0 flex-1 resize-none font-mono text-xs leading-relaxed" />
            </div>
          )}

          {step === "preview" && deck && (
            <div className="grid h-full min-h-0 grid-cols-[260px_minmax(0,1fr)] gap-4 py-2">
              <div className="flex min-h-0 flex-col rounded-md border">
                <div className="flex items-center justify-between border-b p-2"><span className="text-xs font-semibold">{deck.slides.length} slides</span><Button size="sm" variant="ghost" onClick={addSlide}><Plus /> Add</Button></div>
                <ScrollArea className="min-h-0 flex-1">
                  <div className="space-y-1 p-2">
                    {deck.slides.map((slide, index) => (
                      <button key={slide.id} type="button" onClick={() => setSelectedSlideId(slide.id)} className={cn("w-full rounded-md border p-2 text-left", selectedSlide?.id === slide.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted")}>
                        <span className="text-[10px] text-muted-foreground">{index + 1}</span>
                        <span className="block truncate text-xs font-medium">{slide.title}</span>
                        <span className="mt-1 block truncate text-[10px] text-muted-foreground">{presentationSourceRefs(slide).length ? `${presentationSourceRefs(slide).length} source refs` : "Generated"}</span>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </div>
              {selectedSlide && (
                <ScrollArea className="h-full pr-4">
                  <div className="space-y-4 pb-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => moveSlide(selectedSlide.id, -1)}><ArrowUp /> Move up</Button><Button size="sm" variant="outline" onClick={() => moveSlide(selectedSlide.id, 1)}><ArrowDown /> Move down</Button></div>
                      <Button size="sm" variant="outline" onClick={() => removeSlide(selectedSlide.id)} disabled={deck.slides.length === 1}><Trash2 /> Remove</Button>
                    </div>
                    <Field label="Slide title"><Input value={selectedSlide.title} onChange={(event) => updateSlide(selectedSlide.id, { title: event.target.value })} /></Field>
                    <Field label="Subtitle"><Input value={selectedSlide.subtitle} onChange={(event) => updateSlide(selectedSlide.id, { subtitle: event.target.value })} /></Field>
                    <Field label="Bullets (one per line)"><Textarea value={selectedSlide.bullets.map((bullet) => bullet.text).join("\n")} onChange={(event) => updateBulletText(selectedSlide, event.target.value)} className="min-h-36" /></Field>
                    <div className="flex flex-wrap gap-1">
                      {selectedSlide.bullets.map((bullet, index) => <span key={`${bullet.text}-${index}`} className={cn("rounded-full px-2 py-1 text-[10px]", bullet.source_refs.length > 0 && !bullet.generated ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200" : "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200")}>{bullet.source_refs.length > 0 && !bullet.generated ? bullet.source_refs.join(", ") : "Generated"}</span>)}
                    </div>
                    <Field label="Visual type"><select value={selectedSlide.visual?.kind ?? "diagram"} onChange={(event) => updateSlide(selectedSlide.id, { visual: selectedSlide.visual ? { ...selectedSlide.visual, kind: event.target.value as "diagram" | "graphic" } : null })} disabled={!selectedSlide.visual} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="diagram">Diagram</option><option value="graphic">Graphic</option></select></Field>
                    <Field label="Suggested visual"><Textarea value={selectedSlide.visual?.description ?? ""} onChange={(event) => updateSlide(selectedSlide.id, { visual: event.target.value.trim() ? (selectedSlide.visual ? { ...selectedSlide.visual, description: event.target.value, source_refs: [] } : { kind: requirements.visualMode === "graphics" ? "graphic" : "diagram", description: event.target.value, title: "", layout: "flow", groups: [], connections: [], source_refs: [] }) : null })} /></Field>
                    <Field label="Speaker notes"><Textarea value={selectedSlide.speaker_notes} onChange={(event) => updateSlide(selectedSlide.id, { speaker_notes: event.target.value })} className="min-h-32" /></Field>
                    <div className="rounded-md border p-3">
                      <Label htmlFor="presentation-revision">Ask AI to refine</Label>
                      <Textarea id="presentation-revision" value={revisionInstruction} onChange={(event) => setRevisionInstruction(event.target.value)} placeholder="e.g., Make the recommendation more concise and add a source-backed risk" className="mt-2" />
                      <div className="mt-2 flex gap-2"><Button size="sm" variant="outline" disabled={!revisionInstruction.trim() || generating} onClick={() => void generate({ existing: deck, instruction: `Revise only slide ${selectedSlide.id}: ${revisionInstruction}`, slideId: selectedSlide.id })}><Sparkles /> Revise slide</Button><Button size="sm" variant="outline" disabled={!revisionInstruction.trim() || generating} onClick={() => void generate({ existing: deck, instruction: revisionInstruction })}><Sparkles /> Revise deck</Button></div>
                    </div>
                  </div>
                </ScrollArea>
              )}
            </div>
          )}
        </div>

        {error && <p role="alert" className="mx-6 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error} Your requirements, prompt, and draft are preserved for retry.</p>}
        <DialogFooter className="border-t px-6 py-4">
          {step === "requirements" && <Button onClick={composePrompt} disabled={loadingPages}><FilePlus2 /> Compose prompt</Button>}
          {step === "prompt" && <><Button variant="outline" onClick={() => setStep("requirements")}>Back</Button><Button onClick={() => void generate()} disabled={!prompt.trim() || generating}>{generating ? <Loader2 className="animate-spin" /> : <Sparkles />} Generate deck</Button></>}
          {step === "preview" && deck && <><span className="mr-auto self-center text-xs text-muted-foreground">{model ? `Generated with ${model}` : "Configured presentation model"}</span><Button variant="outline" onClick={() => setStep("prompt")}>Edit prompt</Button><Button variant="outline" onClick={() => void generate()} disabled={generating}>{generating ? <Loader2 className="animate-spin" /> : <RotateCcw />} Regenerate</Button><Button variant="outline" onClick={() => void exportDeck("html")} disabled={exporting}>{exporting ? <Loader2 className="animate-spin" /> : <Download />} Export .html</Button><Button onClick={() => void exportDeck("pptx")} disabled={exporting}>{exporting ? <Loader2 className="animate-spin" /> : <Download />} Export .pptx</Button></>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={assistStreamOpen} onOpenChange={setAssistStreamOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> AI Assist stream
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2" aria-live="polite">
            {assisting && <Loader2 className="h-4 w-4 animate-spin" />}
            {assistStatus}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-80 rounded-md border bg-muted/30 p-4">
          <div role="log" aria-live="polite" aria-label="AI Assist streamed output">
            {assistOutput
              ? <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">{assistOutput}</pre>
              : <p className="text-sm text-muted-foreground">Waiting for the first response…</p>}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button
            type="button"
            onClick={() => setAssistStreamOpen(false)}
            disabled={!assistFinished}
          >
            {assistFinished && !error ? "Review filled brief" : "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={generationStreamOpen} onOpenChange={setGenerationStreamOpen}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> {generationStreamTitle}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2" aria-live="polite">
            {generating && <Loader2 className="h-4 w-4 animate-spin" />}
            {generationStatus}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-[28rem] rounded-md border bg-muted/30 p-4">
          <div role="log" aria-live="polite" aria-label="Presentation generation streamed output">
            {generationOutput
              ? <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">{generationOutput}</pre>
              : <p className="text-sm text-muted-foreground">Waiting for the first slide content…</p>}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button
            type="button"
            onClick={() => setGenerationStreamOpen(false)}
            disabled={!generationFinished}
          >
            {generationFinished && !error ? "Review deck" : "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}{required ? " *" : ""}</Label>{children}</div>;
}
