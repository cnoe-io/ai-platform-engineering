function attachFullscreen(el) {
  if (el.dataset.fullscreenAttached) return;
  el.dataset.fullscreenAttached = 'true';
  el.addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen().catch(() => {});
    }
  });
}

function watchForMermaid() {
  // Attach to any diagrams already in the DOM
  document.querySelectorAll('.mermaid').forEach(attachFullscreen);

  // Watch for Mermaid injecting SVGs into .mermaid divs
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'svg') {
          const parent = node.closest('.mermaid');
          if (parent) attachFullscreen(parent);
        }
        node.querySelectorAll?.('.mermaid').forEach(attachFullscreen);
      }
    }
  });

  observer.observe(document.body, {childList: true, subtree: true});
  return observer;
}

let observer = null;

export function onRouteDidUpdate() {
  observer?.disconnect();
  observer = watchForMermaid();
}
