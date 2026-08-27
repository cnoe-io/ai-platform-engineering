// assisted-by Codex Codex-sonnet-4-6

export const MICROFRONTEND_CONTRACT_VERSION = "1.0";
export const MICROFRONTEND_INITIALIZE_MESSAGE_TYPE = "caipe.microfrontend.initialize.v1";
export const MICROFRONTEND_READY_MESSAGE_TYPE = "caipe.microfrontend.ready.v1";

export type MicrofrontendPreferenceValue = boolean | number | string;

export interface MicrofrontendHostContext {
  surface: "hosted" | "standalone";
  route: string;
  theme: "dark" | "light" | "system";
  locale: string;
  timezone: string;
  preferences: Record<string, MicrofrontendPreferenceValue>;
}

export interface MicrofrontendInitializeMessage {
  type: typeof MICROFRONTEND_INITIALIZE_MESSAGE_TYPE;
  version: typeof MICROFRONTEND_CONTRACT_VERSION;
  appId: string;
  context: MicrofrontendHostContext;
}

export function createMicrofrontendInitializeMessage(
  appId: string,
  context: MicrofrontendHostContext,
): MicrofrontendInitializeMessage {
  assertAppId(appId);
  if (!context.route.startsWith("/")) {
    throw new Error("microfrontend route must start with /");
  }
  return {
    type: MICROFRONTEND_INITIALIZE_MESSAGE_TYPE,
    version: MICROFRONTEND_CONTRACT_VERSION,
    appId,
    context,
  };
}

export function subscribeToMicrofrontendHost(
  appId: string,
  listener: (context: MicrofrontendHostContext) => void,
  options: { expectedOrigin?: string; sourceWindow?: Window } = {},
): () => void {
  assertAppId(appId);
  const sourceWindow = options.sourceWindow ?? window.parent;
  const expectedOrigin = options.expectedOrigin ?? window.location.origin;

  const onMessage = (event: MessageEvent): void => {
    if (event.origin !== expectedOrigin || event.source !== sourceWindow) return;
    if (!isInitializeMessage(event.data, appId)) return;
    listener(event.data.context);
    sourceWindow.postMessage(
      {
        type: MICROFRONTEND_READY_MESSAGE_TYPE,
        version: MICROFRONTEND_CONTRACT_VERSION,
        appId,
      },
      expectedOrigin,
    );
  };

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

function isInitializeMessage(value: unknown, appId: string): value is MicrofrontendInitializeMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<MicrofrontendInitializeMessage>;
  return (
    message.type === MICROFRONTEND_INITIALIZE_MESSAGE_TYPE &&
    message.version === MICROFRONTEND_CONTRACT_VERSION &&
    message.appId === appId &&
    Boolean(message.context) &&
    typeof message.context?.route === "string" &&
    message.context.route.startsWith("/") &&
    (message.context.surface === "hosted" || message.context.surface === "standalone") &&
    (message.context.theme === "dark" ||
      message.context.theme === "light" ||
      message.context.theme === "system") &&
    typeof message.context.locale === "string" &&
    typeof message.context.timezone === "string" &&
    typeof message.context.preferences === "object"
  );
}

function assertAppId(appId: string): void {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(appId)) {
    throw new Error("appId must be a valid Agentic App id");
  }
}
