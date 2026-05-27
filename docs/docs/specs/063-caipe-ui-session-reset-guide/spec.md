---
sidebar_position: 2
sidebar_label: Specification
title: "2026-02-03: CAIPE UI Session Reset & Cookie Management Guide"
---

# CAIPE UI Session Reset & Cookie Management Guide

**Date**: 2026-02-03
**Status**: Troubleshooting Guide
**Type**: Operations Documentation

## Summary

Comprehensive guide for resolving authentication issues in CAIPE UI, including automatic session recovery mechanisms, cookie management, and troubleshooting stuck authorization screens.

---


## Problem: Stuck on "Verifying authorization..." Screen

If you're stuck on the authorization screen and have to continuously delete cookies, this guide will help you understand and fix the issue.

---


## 🔍 Root Causes

### 1. **Oversized Session Cookies**
- **Problem**: NextAuth stores JWT tokens in cookies
- **Chrome Limit**: 4096 bytes per cookie
- **Cause**: Large OIDC profiles (groups, claims) can exceed this limit
- **Result**: Browser truncates cookie → corrupted session → stuck authentication

### 2. **Expired Tokens Without Refresh**
- **Problem**: Access token expired but refresh failed
- **Cause**: OIDC provider doesn't support `offline_access` or refresh tokens disabled
- **Result**: Infinite authorization loop

### 3. **Group Authorization Failures**
- **Problem**: User not in required group (`backstage-access` by default)
- **Cause**: OIDC provider returns wrong group format or user not authorized
- **Result**: Authorization check never completes

---


## 📝 Summary of Changes

| Component | Change | Impact |
|-----------|--------|--------|
| `auth-guard.tsx` | Added oversized cookie detection | Prevents corrupted sessions |
| `auth-guard.tsx` | Progressive timeouts (5s/15s) | User-friendly recovery |
| `auth-guard.tsx` | Force `window.location.href` redirect | Bypasses NextAuth stuck state |
| `loading-screen.tsx` | Added emergency reset button | Manual recovery option |
| `auth-config.ts` | Reduced JWT profile size | Prevents cookie overflow |
| `auth-config.ts` | Added cookie configuration | Better cookie management |

---


## ✅ Expected Behavior (After Fix)

1. **Login Flow**: 2-3 seconds total
   - Redirect to OIDC → Authenticate → Redirect back → Render app

2. **No More Manual Cookie Deletion**: Automatic recovery handles all scenarios

3. **Clear User Feedback**:
   - Shows exact step ("Checking authentication...", "Verifying authorization...")
   - Progress indication (spinner)
   - Emergency reset button after 5s
   - Auto-reset after 15s

4. **Persistent Sessions**: 24-hour session lifetime with automatic refresh

---


## 🆘 Still Having Issues?

If problems persist after these fixes:

1. **Check OIDC Provider Configuration**:
   - Verify `offline_access` scope is supported
   - Check group claim format matches `OIDC_GROUP_CLAIM`
   - Ensure user is in `OIDC_REQUIRED_GROUP`

2. **Check Browser Console**:
   ```
   Look for: [AuthGuard] messages
   Common errors:
   - "Session cookie too large" → JWT reduction not working
   - "Token refresh failed" → OIDC provider issue
   - "Not authorized" → Group membership issue
   ```

3. **Check Environment Variables**:
   ```bash
   cd ui
   cat .env.local
   # Verify all OIDC_* and NEXTAUTH_* vars are set
   ```

4. **Contact Support**:
   - Provide browser console logs
   - Include `?session_reset=*` query param from URL
   - Share cookie size from debugging section

---

**Last Updated**: 2026-02-03
**Version**: 2.0 (Automatic Recovery Edition)


## Related

- Architecture: [architecture.md](./architecture.md)
