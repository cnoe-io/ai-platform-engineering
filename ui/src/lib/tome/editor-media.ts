import { parseTomeEmbed, type TomeEmbed } from "@/lib/tome/embeds";

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

function embedRemoveButtonMarkup(label: string): string {
  return [
    '<div class="tome-embed-toolbar">',
    `<button type="button" class="tome-embed-remove" aria-label="Remove ${label} embed">`,
    '<span aria-hidden="true">✕</span>',
    "<span>Remove embed</span>",
    "</button>",
    "</div>",
  ].join("");
}

function embedProviderLabel(provider: string): string {
  if (provider === "arxiv") return "arXiv";
  if (provider === "youtube") return "YouTube";
  if (provider === "vidcast") return "Vidcast";
  return provider;
}

export function createEmbedPreview(embed: TomeEmbed): HTMLElement {
  const node = document.createElement("div");
  node.className = `tome-embed-preview tome-${embed.provider}-preview`;
  node.dataset.embedProvider = embed.provider;
  node.dataset.embedSrc = embed.src;
  node.dataset.embedTitle = embed.title;
  const frame = document.createElement("div");
  frame.className = `tome-embed-frame tome-${embed.kind}-frame`;
  const fallback = document.createElement("a");
  fallback.className = "tome-embed-link";
  fallback.href = embed.watchUrl;
  fallback.target = "_blank";
  fallback.rel = "noopener noreferrer";
  fallback.textContent = `${embed.linkLabel}: ${embed.title}`;
  node.insertAdjacentHTML(
    "beforeend",
    embedRemoveButtonMarkup(embedProviderLabel(embed.provider)),
  );
  node.append(frame, fallback);
  return node;
}

export function createEmbedError(provider: string, message: string): HTMLElement {
  const node = document.createElement("div");
  node.className = `tome-embed-error tome-${provider}-error`;
  node.setAttribute("role", "alert");
  node.insertAdjacentHTML("beforeend", embedRemoveButtonMarkup(embedProviderLabel(provider)));
  const text = document.createElement("span");
  text.textContent = message;
  node.append(text);
  return node;
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
  const embed = parseTomeEmbed(normalizedLanguage, content);
  if (embed) {
    const providerLabel = embedProviderLabel(normalizedLanguage);
    if (embed.ok === false) {
      applyPreview(
        createEmbedError(
          normalizedLanguage,
          `Could not embed ${providerLabel}: ${embed.error}`,
        ),
      );
      return;
    }

    // Crepe sanitizes all preview markup and deliberately removes iframes.
    // Emit inert data here; CrepeEditor re-validates it and creates the iframe
    // after the sanitizer has completed.
    applyPreview(createEmbedPreview(embed.value));
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

/** Create validated external iframes inside sanitized Crepe placeholders. */
export function hydrateEmbedPreviews(root: ParentNode): void {
  root
    .querySelectorAll<HTMLElement>(
      ".tome-embed-preview:not([data-embed-hydrated])",
    )
    .forEach((preview) => {
      preview.dataset.embedHydrated = "true";
      const provider = preview.dataset.embedProvider ?? "";
      const parsed = parseTomeEmbed(
        provider,
        [
          `url: ${preview.dataset.embedSrc ?? ""}`,
          `title: ${preview.dataset.embedTitle ?? "Embedded content"}`,
        ].join("\n"),
      );
      const frame = preview.querySelector<HTMLElement>(".tome-embed-frame");
      if (!parsed || !parsed.ok || !frame) {
        preview.classList.add("tome-embed-error");
        preview.setAttribute("role", "alert");
        preview.textContent = "The external embed could not be loaded safely.";
        return;
      }

      const iframe = document.createElement("iframe");
      iframe.className = `tome-embed-iframe tome-${parsed.value.provider}-iframe`;
      iframe.src = parsed.value.src;
      iframe.title = parsed.value.title;
      iframe.setAttribute("loading", "lazy");
      if (parsed.value.provider === "youtube") {
        iframe.setAttribute(
          "allow",
          "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
        );
        iframe.setAttribute("allowfullscreen", "");
      } else if (parsed.value.provider === "vidcast") {
        iframe.setAttribute("allow", "fullscreen; autoplay; clipboard-write");
        iframe.setAttribute("allowfullscreen", "");
      }
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
