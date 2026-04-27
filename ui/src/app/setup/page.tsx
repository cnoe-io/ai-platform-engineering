"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Shield, User, Lock, Smartphone, Download, CheckCircle, Eye, EyeOff, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

type Step = "account" | "totp" | "done";

interface BackupCodesProps {
  codes: string[];
  onConfirm: () => void;
}

function BackupCodesPanel({ codes, onConfirm }: BackupCodesProps) {
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(codes.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([codes.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "caipe-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Save these backup codes in a secure location. Each code can only be used once.
        You will need one if you lose access to your authenticator app.
      </p>
      <div className="grid grid-cols-2 gap-2 p-4 bg-muted rounded-lg font-mono text-sm">
        {codes.map((code) => (
          <span key={code} className="text-center tracking-widest">{code}</span>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={handleCopy} className="flex-1">
          {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button variant="outline" size="sm" onClick={handleDownload} className="flex-1">
          <Download className="h-4 w-4 mr-2" />
          Download
        </Button>
      </div>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="rounded"
        />
        I have saved my backup codes in a secure location
      </label>
      <Button onClick={onConfirm} disabled={!confirmed} className="w-full">
        Continue to CAIPE
      </Button>
    </div>
  );
}

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("account");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Account form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // TOTP state
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [totpToken, setTotpToken] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [totpVerified, setTotpVerified] = useState(false);
  // One-time setup token that binds TOTP enrollment to this session
  const [setupToken, setSetupToken] = useState<string | null>(null);

  const handleAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create account.");
        return;
      }

      // Store the one-time setup token returned by /api/setup
      const token = data.setup_token as string;
      setSetupToken(token);

      // Generate TOTP — requires the setup token to prevent hijacking
      const totpRes = await fetch("/api/setup/totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, setup_token: token }),
      });
      const totpData = await totpRes.json();
      if (!totpRes.ok) {
        setError(totpData.error || "Failed to set up authenticator.");
        return;
      }

      setQrCode(totpData.qrCode);
      setBackupCodes(totpData.backupCodes);
      setStep("totp");
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleTotpVerify = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/setup/totp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, token: totpToken, setup_token: setupToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Invalid code. Please try again.");
        return;
      }
      setTotpVerified(true);
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const handleFinish = async () => {
    // Sign in with the newly created credentials
    const result = await signIn("credentials", {
      email,
      password,
      totp: totpToken,
      redirect: false,
    });
    if (result?.ok) {
      router.push("/");
    } else {
      router.push("/login");
    }
  };

  const steps = [
    { id: "account", label: "Create Account", icon: User },
    { id: "totp", label: "Set Up Authenticator", icon: Smartphone },
    { id: "done", label: "Complete", icon: CheckCircle },
  ];
  const currentStepIdx = steps.findIndex((s) => s.id === step);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="p-3 rounded-2xl gradient-primary-br">
              <Shield className="h-8 w-8 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold">Welcome to CAIPE</h1>
          <p className="text-sm text-muted-foreground">
            Let&apos;s set up your admin account to get started.
          </p>
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2">
          {steps.map((s, idx) => (
            <React.Fragment key={s.id}>
              <div
                className={cn(
                  "flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-colors",
                  idx === currentStepIdx
                    ? "bg-primary text-primary-foreground"
                    : idx < currentStepIdx
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground"
                )}
              >
                <s.icon className="h-3 w-3" />
                {s.label}
              </div>
              {idx < steps.length - 1 && (
                <div className={cn("h-px w-4 bg-border", idx < currentStepIdx && "bg-primary")} />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Step content */}
        <div className="border border-border rounded-xl p-6 bg-card shadow-sm">
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {step === "account" && (
            <form onSubmit={handleAccountSubmit} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Admin User"
                  required
                  autoComplete="name"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@example.com"
                  required
                  autoComplete="email"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 12 characters"
                    required
                    autoComplete="new-password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">Minimum 12 characters</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat password"
                  required
                  autoComplete="new-password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Creating account…" : "Create Admin Account"}
              </Button>
            </form>
          )}

          {step === "totp" && !totpVerified && (
            <div className="space-y-4">
              <div>
                <h2 className="font-semibold text-sm mb-1">Scan with your authenticator app</h2>
                <p className="text-xs text-muted-foreground mb-3">
                  Use Google Authenticator, Authy, 1Password, or any TOTP app.
                </p>
                {qrCode && (
                  <div className="flex justify-center">
                    <img src={qrCode} alt="TOTP QR Code" className="w-48 h-48 rounded-lg" />
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="totpToken">Enter the 6-digit code to confirm</Label>
                <Input
                  id="totpToken"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={totpToken}
                  onChange={(e) => setTotpToken(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  className="text-center text-lg tracking-widest font-mono"
                  autoComplete="one-time-code"
                />
              </div>
              <Button
                onClick={handleTotpVerify}
                className="w-full"
                disabled={loading || totpToken.length !== 6}
              >
                {loading ? "Verifying…" : "Verify Code"}
              </Button>
            </div>
          )}

          {step === "totp" && totpVerified && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                <CheckCircle className="h-5 w-5" />
                <span className="font-medium text-sm">Authenticator verified</span>
              </div>
              <h2 className="font-semibold text-sm">Save your backup codes</h2>
              <BackupCodesPanel codes={backupCodes} onConfirm={handleFinish} />
            </div>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          You can configure OIDC single sign-on after logging in via the System menu.
        </p>
      </div>
    </div>
  );
}
