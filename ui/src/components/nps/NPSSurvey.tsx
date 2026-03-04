"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getConfig } from "@/lib/config";

interface ActiveCampaign {
  id: string;
  name: string;
  ends_at: string;
}

function getCampaignStorageKey(campaignId: string) {
  return `caipe_nps_campaign_${campaignId}`;
}

export function NPSSurvey() {
  const { data: session, status } = useSession();
  const [visible, setVisible] = useState(false);
  const [campaign, setCampaign] = useState<ActiveCampaign | null>(null);
  const [selectedScore, setSelectedScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (status !== "authenticated" || !getConfig("npsEnabled") || getConfig("storageMode") !== "mongodb") return;

    let cancelled = false;

    async function checkActiveCampaign() {
      try {
        const res = await fetch("/api/nps/active");
        if (!res.ok) return;
        const data = await res.json();

        if (cancelled) return;

        if (data.success && data.data?.active && data.data.campaign) {
          const activeCampaign: ActiveCampaign = data.data.campaign;

          const dismissed = localStorage.getItem(getCampaignStorageKey(activeCampaign.id));
          if (dismissed) return;

          setCampaign(activeCampaign);
          const timer = setTimeout(() => {
            if (!cancelled) setVisible(true);
          }, 30000);
          return () => clearTimeout(timer);
        }
      } catch (err) {
        console.error("[NPS] Failed to check active campaign:", err);
      }
    }

    checkActiveCampaign();
    return () => { cancelled = true; };
  }, [status]);

  const dismiss = useCallback(() => {
    setVisible(false);
    if (campaign) {
      localStorage.setItem(getCampaignStorageKey(campaign.id), "dismissed");
    }
  }, [campaign]);

  const handleSubmit = useCallback(async () => {
    if (selectedScore === null || !campaign) return;
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/nps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          score: selectedScore,
          comment: comment.trim() || undefined,
          campaign_id: campaign.id,
        }),
      });
      if (res.ok) {
        setSubmitted(true);
        localStorage.setItem(getCampaignStorageKey(campaign.id), "submitted");
        setTimeout(() => setVisible(false), 2000);
      }
    } catch (err) {
      console.error("[NPS] Failed to submit:", err);
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedScore, comment, campaign]);

  if (!visible) return null;

  const getScoreColor = (score: number) => {
    if (score <= 6) return "bg-red-500 hover:bg-red-600 text-white";
    if (score <= 8) return "bg-amber-500 hover:bg-amber-600 text-white";
    return "bg-green-500 hover:bg-green-600 text-white";
  };

  const getScoreLabel = (score: number) => {
    if (score <= 6) return "Detractor";
    if (score <= 8) return "Passive";
    return "Promoter";
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 80 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 80 }}
        className="fixed bottom-6 right-6 z-50 w-[420px] rounded-xl border bg-card shadow-2xl"
      >
        <div className="p-5">
          {submitted ? (
            <div className="text-center py-4">
              <p className="text-lg font-semibold mb-1">Thank you!</p>
              <p className="text-sm text-muted-foreground">Your feedback helps us improve.</p>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between mb-4">
                <div>
                  {campaign?.name && (
                    <p className="text-xs font-medium text-primary mb-1.5">{campaign.name}</p>
                  )}
                  <p className="font-semibold text-sm">
                    How well does {getConfig("appName")} help you get your work done?
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">0 = Not helpful at all, 10 = Indispensable</p>
                </div>
                <button
                  onClick={dismiss}
                  className="text-muted-foreground hover:text-foreground -mt-1 -mr-1 p-1"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Score buttons */}
              <div className="flex gap-1 mb-3">
                {Array.from({ length: 11 }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedScore(i)}
                    className={cn(
                      "flex-1 h-9 rounded-md text-xs font-medium transition-all",
                      selectedScore === i
                        ? getScoreColor(i)
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    )}
                  >
                    {i}
                  </button>
                ))}
              </div>

              {selectedScore !== null && (
                <p className="text-xs text-center text-muted-foreground mb-3">
                  Score: {selectedScore} ({getScoreLabel(selectedScore)})
                </p>
              )}

              {/* Optional comment */}
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="What could we do better? (optional)"
                className="w-full h-16 px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 mb-3"
                maxLength={1000}
              />

              <p className="text-[10px] text-muted-foreground/50 mb-3 text-center">
                Responses are tied to your account to help us follow up.
              </p>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={dismiss}
                >
                  Maybe Later
                </Button>
                <Button
                  size="sm"
                  className="flex-1 gap-2"
                  onClick={handleSubmit}
                  disabled={selectedScore === null || isSubmitting}
                >
                  {isSubmitting && <Loader2 className="h-3 w-3 animate-spin" />}
                  Submit
                </Button>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
