export interface AgentCompletionPreferences {
  browserEnabled: boolean;
  chimeEnabled: boolean;
}

export interface AgentCompletionAlert {
  agentName?: string;
  conversationId: string;
  messageId: string;
}

export type BrowserNotificationCapability = NotificationPermission | "unsupported";

const STORAGE_KEYS = {
  browserEnabled: "caipe-agent-completion-browser-enabled",
  chimeEnabled: "caipe-agent-completion-chime-enabled",
} as const;

const DEFAULT_PREFERENCES: AgentCompletionPreferences = {
  browserEnabled: false,
  chimeEnabled: false,
};

let settingsLoadPromise: Promise<AgentCompletionPreferences> | null = null;
let audioContext: AudioContext | null = null;

function readBoolean(key: string): boolean | undefined {
  if (typeof window === "undefined") return undefined;
  const value = window.localStorage.getItem(key);
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export function readCachedAgentCompletionPreferences(): AgentCompletionPreferences {
  return {
    browserEnabled: readBoolean(STORAGE_KEYS.browserEnabled) ?? DEFAULT_PREFERENCES.browserEnabled,
    chimeEnabled: readBoolean(STORAGE_KEYS.chimeEnabled) ?? DEFAULT_PREFERENCES.chimeEnabled,
  };
}

export function cacheAgentCompletionPreferences(preferences: AgentCompletionPreferences): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEYS.browserEnabled,String(preferences.browserEnabled));
  window.localStorage.setItem(STORAGE_KEYS.chimeEnabled,String(preferences.chimeEnabled));
  settingsLoadPromise = Promise.resolve(preferences);
}

export async function loadAgentCompletionPreferences(): Promise<AgentCompletionPreferences> {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  if (settingsLoadPromise) return settingsLoadPromise;

  settingsLoadPromise = fetch("/api/settings",{ cache: "no-store" })
    .then(async (response) => {
      const body = await response.json();
      if (!response.ok || !body.success) {
        throw new Error(body.error || "Could not load notification preferences");
      }
      const notifications = body.data?.notifications;
      const preferences = {
        browserEnabled: notifications?.agent_completion_browser_enabled === true,
        chimeEnabled: notifications?.agent_completion_chime_enabled === true,
      };
      cacheAgentCompletionPreferences(preferences);
      return preferences;
    })
    .catch(() => readCachedAgentCompletionPreferences());

  return settingsLoadPromise;
}

export function resetAgentCompletionPreferenceLoad(): void {
  settingsLoadPromise = null;
}

export function getBrowserNotificationCapability(): BrowserNotificationCapability {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return window.Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationCapability> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return window.Notification.requestPermission();
}

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (audioContext && audioContext.state !== "closed") return audioContext;

  const AudioContextConstructor = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return null;
  audioContext = new AudioContextConstructor();
  return audioContext;
}

/**
 * Call from a click/key handler so browser autoplay policy allows a later
 * background completion chime.
 */
export async function primeCompletionChime(): Promise<boolean> {
  const context = getAudioContext();
  if (!context) return false;
  if (context.state !== "running") {
    try {
      await context.resume();
    } catch {
      return false;
    }
  }
  return context.state === "running";
}

export async function playCompletionChime(): Promise<boolean> {
  const context = getAudioContext();
  if (!context || !(await primeCompletionChime())) return false;

  const playTone = (frequency: number,startsAt: number,duration: number): void => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency,startsAt);
    gain.gain.setValueAtTime(0.0001,startsAt);
    gain.gain.exponentialRampToValueAtTime(0.075,startsAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001,startsAt + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startsAt);
    oscillator.stop(startsAt + duration);
  };

  const now = context.currentTime;
  playTone(659.25,now,0.18);
  playTone(880,now + 0.11,0.24);
  return true;
}

export function shouldAlertForCurrentPage(): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") return false;
  return document.hidden || !document.hasFocus();
}

function showBrowserNotification(alert: AgentCompletionAlert): boolean {
  if (getBrowserNotificationCapability() !== "granted") return false;

  try {
    const agentLabel = alert.agentName?.trim() || "Agent";
    const notification = new window.Notification(`${agentLabel} finished`,{
      body: "Your response is ready.",
      data: {
        conversationId: alert.conversationId,
        messageId: alert.messageId,
      },
      icon: "/icon.ico",
      tag: `caipe-agent-completion-${alert.conversationId}`,
    });
    notification.onclick = () => {
      window.focus();
      window.location.assign(`/chat/${encodeURIComponent(alert.conversationId)}`);
      notification.close();
    };
    return true;
  } catch {
    // Desktop Notification construction is not supported by every browser,
    // notably several mobile implementations. The in-app response still works.
    return false;
  }
}

export async function deliverAgentCompletionAlert(
  alert: AgentCompletionAlert,
  options: { force?: boolean; preferences?: AgentCompletionPreferences } = {},
): Promise<{ chimePlayed: boolean; notificationShown: boolean }> {
  if (!options.force && !shouldAlertForCurrentPage()) {
    return { chimePlayed: false,notificationShown: false };
  }

  const preferences = options.preferences ?? await loadAgentCompletionPreferences();
  const [chimePlayed,notificationShown] = await Promise.all([
    preferences.chimeEnabled ? playCompletionChime() : Promise.resolve(false),
    Promise.resolve(preferences.browserEnabled ? showBrowserNotification(alert) : false),
  ]);
  return { chimePlayed,notificationShown };
}
