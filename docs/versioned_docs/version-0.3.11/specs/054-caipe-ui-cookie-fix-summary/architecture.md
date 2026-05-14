---
sidebar_position: 1
id: 054-caipe-ui-cookie-fix-summary-architecture
sidebar_label: Architecture
---

# Architecture: Cookie Management Fix - Summary

**Date**: 2026-01-30

## Solution Implemented

### 1. Automatic Cookie Size Detection (`auth-guard.tsx`)
- Checks session cookie size on mount
- Auto-clears if > 4096 bytes
- Redirects to login automatically

```typescript
// Check for oversized cookies
const sessionCookie = cookies.split(';')
  .find(c => c.trim().startsWith('next-auth.session-token='));

if (sessionCookie && sessionCookie.length > 4096) {
  clearAllCookiesAndStorage();
  window.location.href = '/login?session_reset=auto';
}
```

### 2. Progressive Timeouts (`auth-guard.tsx`)
- **5 seconds**: Show "Clear Session & Retry" button
- **15 seconds**: Automatic session reset and redirect

```typescript
// Show reset button after 5s
setTimeout(() => setLoadingTimeout(true), 5000);

// Auto-reset after 15s
setTimeout(() => {
  if (!authChecked && !autoResetInitiated) {
    clearAllCookiesAndStorage();
    window.location.href = '/login?session_reset=auto';
  }
}, 15000);
```

### 3. Emergency Reset Button (`loading-screen.tsx`)
- Prominent button with clear messaging
- Clears localStorage, sessionStorage, and all cookies
- Forces redirect (bypasses NextAuth state)

```typescript
<button onClick={handleReset}>
  Clear Session & Retry
</button>
```

### 4. Reduced JWT Size (`auth-config.ts`)
- Only store essential profile data in JWT
- Reduced from ~10KB to ~200-500 bytes
- Prevents cookie overflow

```typescript
// Before: Store entire profile
token.profile = profileData; // ❌ 10KB+

// After: Store only essentials
token.profile = {
  sub: profileData.sub,
  email: profileData.email,
  name: profileData.name,
}; // ✅ ~200 bytes
```

### 5. Cookie Configuration (`auth-config.ts`)
- Added explicit cookie settings
- 24-hour maxAge
- Secure in production

```typescript
cookies: {
  sessionToken: {
    name: `next-auth.session-token`,
    options: {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60,
    },
  },
}
```


## Files Modified

1. **`ui/src/components/auth-guard.tsx`**
   - Added oversized cookie detection on mount
   - Progressive timeouts (5s button, 15s auto-reset)
   - Force `window.location.href` redirect (bypasses stuck state)
   - Clear all cookies helper function

2. **`ui/src/components/loading-screen.tsx`**
   - Added `onCancel` and `showCancel` props
   - Emergency reset button with clear messaging
   - Improved UX with explanatory text

3. **`ui/src/lib/auth-config.ts`**
   - Reduced JWT profile payload size
   - Added cookie configuration
   - Only store essential profile data

4. **`ui/SESSION_RESET_GUIDE.md`** (New)
   - Comprehensive troubleshooting guide
   - Manual reset instructions
   - Debugging tools
   - Configuration options


## Monitoring

### Cookie Size
- **Target**: < 2048 bytes (safe)
- **Warning**: 2048-4096 bytes
- **Critical**: > 4096 bytes (auto-reset)

### Current Implementation
- Minimal JWT: ~200-500 bytes
- Total cookie: ~800-1500 bytes ✅


## User Instructions

**If you get stuck again** (very unlikely):

1. **Wait 5 seconds** for the "Clear Session & Retry" button
2. **Click the button** - it will clear everything and restart
3. **If still stuck** - auto-reset happens at 15 seconds

**No more manual cookie deletion needed!**

---

**Commit Message**:
```
fix(ui): resolve infinite authorization loop with automatic session recovery

- Add oversized cookie detection (>4096 bytes) with auto-clear
- Implement progressive timeouts: 5s reset button, 15s auto-reset
- Reduce JWT payload size by storing only essential profile data
- Force window.location.href redirect to bypass stuck NextAuth state
- Add emergency "Clear Session & Retry" button to loading screen
- Configure explicit cookie settings for better management

Fixes: User stuck on "Verifying authorization..." requiring manual cookie deletion
Impact: Automatic recovery, no more manual intervention needed

Signed-off-by: Sri Aradhyula <sraradhy@cisco.com>
```


## Related

- Spec: [spec.md](./spec.md)
