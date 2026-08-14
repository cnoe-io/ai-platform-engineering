import { parseVidcastEmbed } from "@/lib/tome/vidcast";

const MAX_EMBEDDED_IMAGE_BYTES = 2 * 1024 * 1024;

let mermaidInitialized = false;
let mermaidRenderId = 0;

function mermaidPreviewMarkup(svg: string): string {
  return [
    '<div class="tome-mermaid-preview">',
    '<button type="button" class="tome-mermaid-expand" aria-label="Expand Mermaid diagram" title="Expand diagram">',
    '<span aria-hidden="true">⛶</span>',
    "<span>Expand</span>",
    "</button>",
    '<div class="tome-mermaid-canvas">',
    svg,
    "</div>",
    "</div>",
  ].join("");
}

/**
 * Render Mermaid fenced code blocks through Crepe's async preview hook.
 * Returning null leaves every other fenced language as a normal code block.
 */
export function renderTomeCodePreview(
  language: string,
  content: string,
  applyPreview: (value: null | string | HTMLElement) => void,
): null | void {
  const normalizedLanguage = language.trim().toLowerCase();
  if (normalizedLanguage === "vidcast") {
    const parsed = parseVidcastEmbed(content);
    if (parsed.ok === false) {
      const node = document.createElement("div");
      node.className = "tome-vidcast-error";
      node.setAttribute("role", "alert");
      node.textContent = `Could not embed Vidcast: ${parsed.error}`;
      applyPreview(node);
      return;
    }

    // Crepe sanitizes all preview markup and deliberately removes iframes.
    // Emit inert data here; CrepeEditor re-validates it and creates the iframe
    // after the sanitizer has completed.
    const node = document.createElement("div");
    node.className = "tome-vidcast-preview";
    node.dataset.vidcastSrc = parsed.value.src;
    node.dataset.vidcastTitle = parsed.value.title;
    const frame = document.createElement("div");
    frame.className = "tome-vidcast-frame";
    const fallback = document.createElement("a");
    fallback.className = "tome-vidcast-link";
    fallback.href = parsed.value.watchUrl;
    fallback.target = "_blank";
    fallback.rel = "noopener noreferrer";
    fallback.textContent = `Watch ${parsed.value.title} on Vidcast`;
    node.append(frame, fallback);
    applyPreview(node);
    return;
  }

  if (normalizedLanguage !== "mermaid" || !content.trim()) return null;

  const renderId = `tome-mermaid-${mermaidRenderId++}`;
  void import("mermaid")
    .then(async ({ default: mermaid }) => {
      if (!mermaidInitialized) {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
        });
        mermaidInitialized = true;
      }
      const { svg } = await mermaid.render(renderId, content);
      applyPreview(mermaidPreviewMarkup(svg));
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Invalid Mermaid diagram";
      const node = document.createElement("div");
      node.className = "tome-mermaid-error";
      node.setAttribute("role", "alert");
      node.textContent = `Could not render Mermaid diagram: ${message}`;
      applyPreview(node);
    });
}

/** Create validated Vidcast iframes inside sanitized Crepe placeholders. */
export function hydrateVidcastPreviews(root: ParentNode): void {
  root
    .querySelectorAll<HTMLElement>(
      ".tome-vidcast-preview:not([data-vidcast-hydrated])",
    )
    .forEach((preview) => {
      preview.dataset.vidcastHydrated = "true";
      const parsed = parseVidcastEmbed(
        [
          `url: ${preview.dataset.vidcastSrc ?? ""}`,
          `title: ${preview.dataset.vidcastTitle ?? "Vidcast video"}`,
        ].join("\n"),
      );
      const frame = preview.querySelector<HTMLElement>(".tome-vidcast-frame");
      if (!parsed.ok || !frame) {
        preview.classList.add("tome-vidcast-error");
        preview.setAttribute("role", "alert");
        preview.textContent = "The Vidcast embed could not be loaded safely.";
        return;
      }

      const iframe = document.createElement("iframe");
      iframe.className = "tome-vidcast-iframe";
      iframe.src = parsed.value.src;
      iframe.title = parsed.value.title;
      iframe.setAttribute("loading", "lazy");
      iframe.setAttribute("allow", "fullscreen; autoplay; clipboard-write");
      iframe.setAttribute("allowfullscreen", "");
      iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      frame.replaceChildren(iframe);
    });
}

/**
 * Crepe defaults pasted images to temporary `blob:` URLs. Embed small images
 * in the Markdown instead so saved wiki revisions remain self-contained.
 */
export function imageFileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    return Promise.reject(new Error("Only image files can be embedded."));
  }
  if (file.size > MAX_EMBEDDED_IMAGE_BYTES) {
    return Promise.reject(
      new Error("Images must be 2 MB or smaller so the wiki page can be saved safely."),
    );
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("The image could not be read."));
    };
    reader.onerror = () => reject(new Error("The image could not be read."));
    reader.readAsDataURL(file);
  });
}
