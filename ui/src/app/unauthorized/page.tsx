"use client";

import React from "react";
import { signOut } from "next-auth/react";
import { motion } from "framer-motion";
import { ShieldX, LogOut, Mail, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { REQUIRED_GROUP } from "@/lib/auth-config";
import { getConfig } from "@/lib/config";

const SUPPORT_EMAIL = getConfig('supportEmail');

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-md w-full"
      >
        <div className="bg-card border border-border rounded-2xl p-8 shadow-xl">
          {/* Icon */}
          <div className="flex justify-center mb-6">
            <div className="relative">
              <div className="absolute inset-0 bg-destructive/20 rounded-full blur-xl" />
              <div className="relative h-20 w-20 rounded-full bg-gradient-to-br from-destructive/20 to-destructive/5 border border-destructive/30 flex items-center justify-center">
                <ShieldX className="h-10 w-10 text-destructive" />
              </div>
            </div>
          </div>

          {/* Title */}
          <h1 className="text-2xl font-bold text-center mb-2">
            Access Denied
          </h1>

          {/* Description */}
          <p className="text-muted-foreground text-center mb-6">
            You don&apos;t have permission to access this application.
            Your account is not a member of the required group.
          </p>

          {/* Required Group Info */}
          <div className="bg-muted/50 rounded-lg p-4 mb-6 border border-border">
            <p className="text-xs text-muted-foreground mb-1">Required Group Membership</p>
            <code className="text-sm font-mono text-foreground bg-background px-2 py-1 rounded">
              {REQUIRED_GROUP}
            </code>
          </div>

          {/* What to do */}
          <div className="space-y-3 mb-6">
            <p className="text-sm font-medium">What you can do:</p>
            <ul className="text-sm text-muted-foreground space-y-2">
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                Contact your IT administrator to request access to the <strong>{REQUIRED_GROUP}</strong> group
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                Sign in with a different account that has the required permissions
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                If you believe this is an error, contact your system administrator
              </li>
            </ul>
          </div>

          {/* Actions */}
          <div className="space-y-3">
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <LogOut className="h-4 w-4" />
              Sign Out & Try Different Account
            </Button>

            <Button
              variant="ghost"
              className="w-full gap-2 text-muted-foreground"
              asChild
            >
              <a href={`mailto:${SUPPORT_EMAIL}?subject=CAIPE Access Request`}>
                <Mail className="h-4 w-4" />
                Contact Support
              </a>
            </Button>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground mt-6">
          {getConfig('appName')} - {getConfig('tagline')}
        </p>
      </motion.div>
    </div>
  );
}
