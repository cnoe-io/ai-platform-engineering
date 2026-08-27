export function renderMicrofrontendClient(appId) {
  const safeAppId = JSON.stringify(appId);
  return `<script>
    (() => {
      const appId = ${safeAppId};
      const initializeType = "caipe.microfrontend.initialize.v1";
      const readyType = "caipe.microfrontend.ready.v1";
      window.addEventListener("message", (event) => {
        const message = event.data;
        if (event.origin !== window.location.origin || event.source !== window.parent) return;
        if (!message || message.type !== initializeType || message.version !== "1.0" || message.appId !== appId) return;
        const context = message.context || {};
        document.documentElement.dataset.caipeSurface = context.surface || "hosted";
        document.documentElement.dataset.caipeTheme = context.theme || "system";
        const density = context.preferences && context.preferences.density;
        if (document.body) document.body.classList.toggle("compact", density !== "comfortable");
        const textScale = context.preferences && context.preferences.textScale;
        const textScales = { small: "0.9", default: "1", large: "1.12", xl: "1.25" };
        document.documentElement.style.setProperty(
          "--app-font-scale",
          textScales[textScale] || textScales.default,
        );
        window.dispatchEvent(new CustomEvent("caipe:microfrontend-initialize", { detail: context }));
        window.parent.postMessage({ type: readyType, version: "1.0", appId }, event.origin);
      });
    })();
  </script>`;
}
