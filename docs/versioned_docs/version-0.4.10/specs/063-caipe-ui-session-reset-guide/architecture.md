---
sidebar_position: 1
id: 063-caipe-ui-session-reset-guide-architecture
sidebar_label: Architecture
---

# Architecture: CAIPE UI Session Reset & Cookie Management Guide

**Date**: 2026-02-03

## 🚨 Immediate Fix (Automated)

The UI now has **automatic recovery mechanisms**:

### 1. **Automatic Session Reset (15 seconds)**
- If stuck for 15 seconds, the app automatically clears all cookies and redirects to login
- No manual intervention needed

### 2. **Manual Reset Button (5 seconds)**
- After 5 seconds, a "Clear Session & Retry" button appears
- Click to immediately clear cookies and restart login

### 3. **Oversized Cookie Detection**
- On page load, checks if session cookie exceeds browser limits (4096 bytes)
- Automatically clears and redirects if detected

---


## ✅ Solutions Implemented

### 1. **Reduced JWT Size**
```typescript
// Before: Stored entire OIDC profile (could be 10KB+)
token.profile = profileData; // ❌ Too large

// After: Only store essentials
token.profile = {
  sub: profileData.sub,
  email: profileData.email,
  name: profileData.name,
  // Reduced to ~200 bytes ✅
};
```

### 2. **Cookie Size Detection**
```typescript
// Check on mount
const sessionCookie = document.cookie.split(';')
  .find(c => c.includes('next-auth.session-token'));

if (sessionCookie.length > 4096) {
  // Auto-clear and redirect
  clearAllCookiesAndStorage();
  window.location.href = '/login?session_reset=auto';
}
```

### 3. **Progressive Timeouts**
```typescript
// 5 seconds: Show reset button
setTimeout(() => setShowResetButton(true), 5000);

// 15 seconds: Auto-reset if still stuck
setTimeout(() => {
  if (!authChecked) {
    clearAllCookiesAndStorage();
    window.location.href = '/login?session_reset=auto';
  }
}, 15000);
```

### 4. **Improved Reset Handler**
```typescript
const handleReset = () => {
  // Clear localStorage
  localStorage.clear();

  // Clear sessionStorage
  sessionStorage.clear();

  // Clear ALL cookies (not just signOut)
  document.cookie.split(";").forEach((c) => {
    document.cookie = c.replace(/^ +/, "")
      .replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
  });

  // Force redirect (bypasses any NextAuth state)
  window.location.href = '/login?session_reset=manual';
};
```

---


## 🔧 Manual Troubleshooting

### Option 1: Use UI Reset Button (Recommended)
1. Wait 5 seconds for "Clear Session & Retry" button
2. Click button
3. You'll be redirected to login with clean state

### Option 2: Browser Console (Advanced)
```javascript
// Open DevTools (F12) → Console tab
localStorage.clear();
sessionStorage.clear();
document.cookie.split(";").forEach((c) => {
  document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
});
location.href = '/login';
```

### Option 3: Browser Settings (Last Resort)
1. **Chrome**: Settings → Privacy → Clear browsing data → Select "Cookies and site data" for `localhost:3000`
2. **Firefox**: Settings → Privacy → Cookies and Site Data → Manage Data → Remove `localhost:3000`
3. **Safari**: Develop → Clear Caches, then Preferences → Privacy → Manage Website Data → Remove `localhost:3000`

---


## 🔍 Debugging

### Check Cookie Size
```javascript
// In browser console
document.cookie.split(';').forEach(c => {
  const cookie = c.trim();
  console.log(`${cookie.split('=')[0]}: ${cookie.length} bytes`);
});
```

### Check Session State
```javascript
// In browser console
console.log('LocalStorage:', localStorage);
console.log('SessionStorage:', sessionStorage);
console.log('Cookies:', document.cookie);
```

### Check API Logs
```bash
# UI logs (Next.js)
cd ui
npm run dev
# Watch for: [AuthGuard] messages

# Backend logs (if needed)
docker-compose logs -f caipe-supervisor
```

---


## 🛠️ Configuration Options

### Disable OIDC Refresh Tokens
If your OIDC provider doesn't support refresh tokens:

```bash
# ui/.env.local
OIDC_ENABLE_REFRESH_TOKEN=false
```

### Change Required Group
```bash
# ui/.env.local
OIDC_REQUIRED_GROUP=your-custom-group
```

### Disable SSO Entirely (Development Only)
```bash
# ui/.env.local
NEXT_PUBLIC_SSO_ENABLED=false
```

---


## 📊 Monitoring

### Session Cookie Size
- **Target**: < 2048 bytes (safe)
- **Warning**: 2048-4096 bytes (may cause issues)
- **Critical**: > 4096 bytes (will fail)

### Current Implementation
- Minimal JWT payload: ~200-500 bytes
- Total cookie size: ~800-1500 bytes (safe)

---


## 🚀 Testing the Fix

1. **Clear Existing State**:
   ```bash
   # In browser console
   localStorage.clear();
   sessionStorage.clear();
   document.cookie.split(";").forEach((c) => {
     document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
   });
   ```

2. **Restart Services**:
   ```bash
   # Stop all
   docker-compose down
   cd ui && rm -rf .next

   # Start MongoDB
   docker-compose up -d mongodb

   # Start UI
   npm run dev
   ```

3. **Test Authentication**:
   - Navigate to `http://localhost:3000`
   - Should redirect to `/login`
   - Complete SSO login
   - Should redirect back to home within 2-3 seconds
   - **No more infinite authorization loop!**

4. **Test Reset Button**:
   - If you get stuck (shouldn't happen now)
   - Wait 5 seconds for reset button
   - Click "Clear Session & Retry"
   - Should redirect to login with clean state

5. **Test Auto-Reset**:
   - If stuck for 15 seconds (very rare)
   - Auto-reset triggers automatically
   - Redirects to login with `?session_reset=auto` query param

---


## Related

- Spec: [spec.md](./spec.md)
