"use client";

import { AgentSelector } from "@/components/chat/AgentSelector";
import { useToast } from "@/components/ui/toast";
import { resolveUsableChatAgent,resolveUsableChatAgentId } from "@/lib/chat-agent-selection";
import { setPendingFirstMessage } from "@/lib/pending-first-message";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chat-store";
import { Plus,Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect,useState,useTransition } from "react";

export function HeroComposer() {
  const router = useRouter();
  const { toast } = useToast();
  const [, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    resolveUsableChatAgent()
      .then((agent) => {
        if (!cancelled) setSelectedAgentId(agent.id);
      })
      .catch(() => {
        // No usable default — AgentSelector will just show nothing to pick from.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const agentId = selectedAgentId ?? (await resolveUsableChatAgentId());
      const conversationId = await useChatStore.getState().createConversation(agentId);
      setPendingFirstMessage(conversationId, trimmed);
      startTransition(() => {
        router.push(`/chat/${conversationId}`);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start a chat";
      toast(message, "error");
      setSubmitting(false);
    }
  };

  return (
    <div data-testid="hero-composer" className="rounded-xl border border-border/50 bg-card/40 p-6">
      <h1 className="text-xl font-bold text-foreground">What would you like to do today?</h1>
      <div className="mt-4 rounded-lg border border-border/60 bg-background/60 p-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
          placeholder="Ask a question or describe what you want to get done…"
          rows={3}
          data-testid="hero-composer-input"
          className="w-full resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Plus className="h-4 w-4" />
            </span>
            <AgentSelector selectedAgentId={selectedAgentId} onSelectAgent={setSelectedAgentId} />
          </div>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!text.trim() || submitting}
            aria-label="Send"
            data-testid="hero-composer-send"
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity",
              (!text.trim() || submitting) && "opacity-50",
            )}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
