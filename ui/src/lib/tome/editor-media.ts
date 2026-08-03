const MAX_EMBEDDED_IMAGE_BYTES = 2 * 1024 * 1024;

let mermaidInitialized = false;
let mermaidRenderId = 0;

/**
 * Render Mermaid fenced code blocks through Crepe's async preview hook.
 * Returning null leaves every other fenced language as a normal code block.
 */
export function renderTomeCodePreview(
  language: string,
  content: string,
  applyPreview: (value: null | string | HTMLElement) => void,
): null | void {
  if (language.trim().toLowerCase() !== "mermaid" || !content.trim()) return null;

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
      applyPreview(svg);
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
