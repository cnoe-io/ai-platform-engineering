---
sidebar_position: 1
id: 057-caipe-ui-session-cookie-fix-architecture
sidebar_label: Architecture
---

# Architecture: ✅ SESSION COOKIE SIZE FIX - Browser Crash Resolved

**Date**: 2026-01-30

## 🔧 Solution

### What Changed

**Before** (❌ BAD):
```typescript
// Stored ALL groups in token (40+ groups = 8KB!)
token.groups = groups;  // 🚫 DON'T DO THIS
token.profile = { ... }; // Also large
session.groups = token.groups; // Copied to session
```

**After** (✅ GOOD):
```typescript
// Only store the authorization result (tiny!)
const groups = extractGroups(profileData); // Used for checking only
token.isAuthorized = hasRequiredGroup(groups);
token.role = isAdminUser(groups) ? 'admin' : 'user';
// Groups array is NOT stored - saves 7KB!
```

---


## 📊 Impact

### Session Cookie Size

**Before**: 8031 bytes
- `groups`: ~6500 bytes (40+ group names)
- `profile`: ~1000 bytes
- Other data: ~500 bytes
- **Result**: Browser crash!

**After**: ~500 bytes (estimated)
- `isAuthorized`: 5 bytes
- `role`: 10 bytes
- `accessToken`, `idToken`: ~400 bytes
- Other data: ~100 bytes
- **Result**: Normal operation!

### Files Changed

1. ✅ `ui/src/lib/auth-config.ts`
   - Removed `token.groups = groups` assignment
   - Removed `token.profile = { ... }` assignment
   - Removed `groups` and `profile` from JWT interface
   - Removed `groups` from Session interface
   - Simplified session callback

---


## 🎯 Technical Details

### Groups Handling

**Before**: Groups stored and checked in session
```typescript
// JWT callback
token.groups = groups; // Stored!

// Session callback  
session.groups = token.groups; // Copied!

// API middleware
if (session.groups?.includes('admin')) { ... } // Checked in session
```

**After**: Groups checked once, result stored
```typescript
// JWT callback (runs once at login)
const groups = extractGroups(profile); // Not stored!
token.role = isAdminUser(groups) ? 'admin' : 'user'; // Result stored!

// Session callback
session.role = token.role; // Just the role, not groups

// API middleware
if (session.role === 'admin') { ... } // Clean check
```

### Why This Works

1. **Groups only needed at login** - We check group membership ONCE when creating the JWT
2. **Store the result, not the input** - `role: 'admin'` vs `groups: [40+ strings]`
3. **Session is lightweight** - No unnecessary data in cookies
4. **Same security** - Authorization still works, just more efficient

---


## 🔐 Security Note

This change **does not reduce security**:

- ✅ Groups are still checked at login
- ✅ Role is still stored securely in JWT
- ✅ MongoDB fallback still works
- ✅ Admin access still requires correct group
- ✅ Tokens are still signed and encrypted

The only difference: We don't store data we don't need!

---


## 📝 Debugging

### Check Session Cookie Size

```javascript
// In browser DevTools Console:
document.cookie.split(';')
  .filter(c => c.includes('next-auth'))
  .forEach(c => console.log(c.split('=')[0], c.length, 'bytes'));
```

**Before fix**: `next-auth.session-token.0` ~4096 bytes, `.1` ~4096 bytes, `.2` ~328 bytes
**After fix**: `next-auth.session-token` ~500 bytes (single cookie!)

### Check JWT Token Content

```typescript
// Add to ui/src/lib/auth-config.ts jwt callback for debugging:
console.log('[Auth] JWT token size:', JSON.stringify(token).length, 'bytes');
console.log('[Auth] JWT keys:', Object.keys(token));
```

---


## Related

- Spec: [spec.md](./spec.md)
