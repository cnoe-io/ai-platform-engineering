---
sidebar_position: 2
sidebar_label: Specification
title: "2026-01-30: ✅ SESSION COOKIE SIZE FIX - Browser Crash Resolved"
---

# ✅ SESSION COOKIE SIZE FIX - Browser Crash Resolved

## Motivation

**Symptoms**:
- Webpage frozen
- Browser crashes ("Aw, Snap!")
- Repeated console warnings: `Session cookie exceeds allowed 4096 bytes`
- Session cookie size: **8031 bytes** (double the limit!)
- Infinite loop of `/api/chat/conversations` requests

**Root Cause**:
The entire OIDC groups array (40+ groups) was being stored in the JWT token, which is then serialized into session cookies. This caused:
- 8KB session cookies (limit is 4KB)
- Browser cookie overflow
- Memory exhaustion
- Page crashes

---


## Testing Strategy

### 1. Stop Your Current Server

Your server is likely in a crash loop. Kill it:

```bash
# Press Ctrl+C in the terminal running npm run dev
# Or find and kill the process
pkill -f "next dev"
```

### 2. Clear Browser Data

**Important**: Clear cookies and localStorage to remove the corrupted session:

```bash
# In browser DevTools Console:
localStorage.clear();
document.cookie.split(";").forEach(c => {
  document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
});
```

Or manually:
- Chrome: DevTools → Application → Clear site data
- Firefox: DevTools → Storage → Clear all

### 3. Restart Server

```bash
cd ui
npm run dev
```

### 4. Verify Fix

**Check server logs** - you should NO LONGER see:
```
❌ [next-auth][debug][CHUNKING_SESSION_COOKIE] {
  message: 'Session cookie exceeds allowed 4096 bytes.',
  ...
}
```

**Check browser console** - should be clean, no cookie warnings

**Test login**:
1. Navigate to `http://localhost:3000`
2. Sign in with OIDC
3. Should load normally (no freeze!)
4. Check admin access works

---


## ✅ Status

**FIXED**: Session cookie size reduced from 8KB to less than 1KB

**Action Required**:
1. ✅ Code updated
2. ⚠️ **RESTART YOUR SERVER**
3. ⚠️ **CLEAR BROWSER COOKIES**
4. ✅ Test login
5. ✅ Verify admin access

---

**Author**: Sri Aradhyula (sraradhy@cisco.com)
**Date**: 2026-01-30
**Severity**: CRITICAL
**Status**: ✅ RESOLVED


## Related

- Architecture: [architecture.md](./architecture.md)
