# Admin Dashboard with OIDC Group-Based RBAC

**Date**: 2026-01-30  
**Status**: Implemented  
**Type**: Feature Addition

## Summary

Added a comprehensive admin dashboard with role-based access control (RBAC) using dual authorization methods:
1. **OIDC Group Membership**: Users in `OIDC_REQUIRED_ADMIN_GROUP` are automatically admins
2. **MongoDB Profile**: Users with `metadata.role = 'admin'` in their MongoDB user document

Admin users can access platform metrics, user management, and usage statistics. Admins can also promote/demote other users via the dashboard.

## Context

The CAIPE platform needed administrative capabilities to:
- Monitor platform usage (DAU, MAU, conversation counts)
- Manage users and view activity
- Track system health and metrics
- Provide insights for capacity planning

Previously, there was no way to distinguish admin users from regular users, and no centralized dashboard for platform management.

## Decision

Implemented dual-method RBAC where admin access is granted via:

### Method 1: OIDC Group (Primary)
- Users belonging to `OIDC_REQUIRED_ADMIN_GROUP` are automatically assigned `role: 'admin'`
- Checked during authentication and stored in session
- No database required

### Method 2: MongoDB Profile (Fallback)
- Users with `metadata.role = 'admin'` in MongoDB are admins
- Checked if user is NOT admin via OIDC
- Allows admins to promote other users without OIDC group changes
- Persists across sessions

### Authorization Flow
1. Admin role determined during authentication (OIDC group first, then MongoDB)
2. Role stored in session for client-side rendering
3. Admin-only API routes check `session.role` before granting access
4. Admin tab conditionally rendered in UI based on role

## Implementation

### 1. Environment Variables

Added new environment variable in `ui/env.example`:

```bash
# Admin group for elevated privileges
# Users in this group will have admin role and access to admin dashboard
# Leave empty to disable admin group checking (all users will be 'user' role)
OIDC_REQUIRED_ADMIN_GROUP=backstage-admins
```

### 2. Authentication Changes

Updated `ui/src/lib/auth-config.ts`:

- Added `REQUIRED_ADMIN_GROUP` constant
- Added `isAdminUser()` helper function to check group membership
- Set `token.role` during JWT callback based on admin group
- Added `role` to session and JWT types
- Pass role to client via session

```typescript
// Check if user is in admin group
export function isAdminUser(groups: string[]): boolean {
  if (!REQUIRED_ADMIN_GROUP) return false;
  
  return groups.some((group) => {
    const groupLower = group.toLowerCase();
    const adminGroupLower = REQUIRED_ADMIN_GROUP.toLowerCase();
    return groupLower === adminGroupLower || groupLower.includes(`cn=${adminGroupLower}`);
  });
}
```

### 3. API Middleware

Updated `ui/src/lib/api-middleware.ts`:

- Modified `getAuthenticatedUser()` to return both user and session
- **Added MongoDB fallback check**: If user is not admin via OIDC, check `user.metadata.role` in MongoDB
- Updated `withAuth()` to pass session to handler
- Set `user.role` from `session.role` (OIDC) or MongoDB profile

```typescript
// Fallback: Check MongoDB user profile if not admin via OIDC
if (role !== 'admin') {
  try {
    const users = await getCollection<User>('users');
    const dbUser = await users.findOne({ email: session.user.email });
    
    if (dbUser?.metadata?.role === 'admin') {
      role = 'admin';
      console.log(`[Auth] User ${session.user.email} is admin via MongoDB profile`);
    }
  } catch (error) {
    // MongoDB not available - continue with OIDC role
  }
}
```

### 4. Admin API Routes

Created two new API routes:

**GET /api/admin/stats** - Platform metrics
- Total users, conversations, messages
- DAU (Daily Active Users)
- MAU (Monthly Active Users)
- Daily activity for last 30 days
- Top users by conversations and messages
- Shared conversation stats

**GET /api/admin/users** - User management
- List all users with stats
- Conversation and message counts per user
- Last activity timestamps
- Role information

**PATCH /api/admin/users/[email]/role** - Update user role
- Promote user to admin: `{ "role": "admin" }`
- Demote user to regular: `{ "role": "user" }`
- Prevents self-demotion
- Only accessible by admin users
- Updates `metadata.role` in MongoDB user document

All admin routes:
- Check `session.role === 'admin'` before granting access
- Return 403 if user is not admin
- Require MongoDB (return 503 if not configured)

### 5. Admin Dashboard UI

Created `ui/src/app/(app)/admin/page.tsx`:

**Overview Cards:**
- Total Users (with DAU/MAU breakdown)
- Total Conversations (today's count)
- Total Messages (today's count)  
- Shared Conversations (percentage)

**Daily Activity Chart:**
- Last 7 days of activity
- Visual progress bars for users and conversations

**Top Users:**
- By conversations created
- By messages sent

**User Management Table:**
- Email, name, role
- Last activity date
- Usage stats (conversations & messages)
- **Role management buttons**:
  - "Make Admin" for regular users
  - "Remove Admin" for admin users
  - Confirmation before role change
  - Inline role updates via API

### 6. UI Integration

Updated `ui/src/components/layout/AppHeader.tsx`:
- Added Shield icon for Admin tab
- Admin tab only visible if `session?.role === 'admin'`
- Red badge styling to distinguish admin area

Updated `ui/src/components/layout/Sidebar.tsx`:
- Added support for `activeTab="admin"`
- Shows admin quick links in sidebar when on admin page

## Access Control Flow

```
User logs in via OIDC
  ↓
Extract groups from OIDC profile
  ↓
Check if user in OIDC_REQUIRED_ADMIN_GROUP
  ↓ NO
Check MongoDB user.metadata.role
  ↓
Set session.role = 'admin' or 'user'
  ↓
Admin tab visible only if role === 'admin'
  ↓
Admin API routes check session.role (with MongoDB fallback)
  ↓
Return 403 if not admin
```

### Admin Role Priority (Checked in Order)
1. **OIDC Group** (highest priority) - `OIDC_REQUIRED_ADMIN_GROUP`
2. **MongoDB Profile** (fallback) - `user.metadata.role === 'admin'`
3. **Default** - `'user'` role

This dual-check ensures:
- OIDC-managed admins work immediately
- Manually promoted admins (via MongoDB) also have access
- Graceful fallback if MongoDB is unavailable

## Example Configuration

**.env**
```bash
# Required for all users to access platform
OIDC_REQUIRED_GROUP=backstage-access

# Required for admin dashboard access
OIDC_REQUIRED_ADMIN_GROUP=backstage-admins

# Group claim name (auto-detects if not set)
OIDC_GROUP_CLAIM=memberOf
```

**Example LDAP-style Groups:**
```
CN=backstage-access,OU=Groups,DC=example,DC=com  → user role
CN=backstage-admins,OU=Groups,DC=example,DC=com  → admin role
```

The code handles both simple group names (`backstage-admins`) and full Distinguished Names (DNs).

## Security Considerations

1. **Dual Authorization Methods**: 
   - **OIDC Group** (recommended): Centrally managed, no database updates needed
   - **MongoDB Profile** (fallback): Allows admin-promoted users, persists in database
2. **Session-Based Checks**: Role is validated on every API request via session with MongoDB fallback
3. **No Client-Side Bypass**: UI hiding is cosmetic; all enforcement is server-side
4. **MongoDB Required**: Admin features require MongoDB for user/conversation data and role fallback
5. **Self-Demotion Protection**: API prevents admins from demoting themselves
6. **Confirmation Required**: UI prompts for confirmation before role changes
7. **Audit Logging**: Role changes are logged with admin email and target user

## Testing

### Method 1: OIDC Group Admin (Recommended)

1. Set `OIDC_REQUIRED_ADMIN_GROUP=backstage-admins` in `.env`
2. Ensure your OIDC user belongs to the admin group
3. Log in via SSO
4. Admin tab should appear in header
5. Navigate to `/admin` to view dashboard
6. API calls to `/api/admin/*` should succeed

### Method 2: MongoDB Profile Admin (Manual Promotion)

1. Start with a regular user (not in OIDC admin group)
2. Manually update MongoDB:
   ```javascript
   db.users.updateOne(
     { email: "user@example.com" },
     { $set: { "metadata.role": "admin" } }
   )
   ```
3. Log out and log back in (to refresh session)
4. Admin tab should now appear
5. Can now promote other users via the dashboard

### Method 3: Admin-Promoted User

1. Log in as an existing admin
2. Navigate to `/admin`
3. Find the user to promote in the user list
4. Click "Make Admin" button
5. Confirm the action
6. User will have admin access on next login

### Testing Non-Admin Access

1. Log in with user NOT in admin group and NOT in MongoDB admin role
2. Admin tab should be hidden
3. Direct navigation to `/admin` should work (UI loads)
4. API calls to `/api/admin/*` should return 403

## Metrics Captured

- **DAU**: Users with `last_login >= today`
- **MAU**: Users with `last_login >= this month`
- **Daily Activity**: 30-day rolling window of active users, conversations, messages
- **User Stats**: Per-user conversation/message counts
- **Shared Conversations**: Count and percentage of shared conversations

## Future Enhancements

1. ✅ **User Role Management**: Allow admins to promote/demote users (IMPLEMENTED)
2. **Usage Quotas**: Set per-user or org-wide limits
3. **Audit Logs**: Track admin actions
4. **Advanced Analytics**: Cost tracking, model usage, error rates
5. **Export Reports**: CSV/PDF exports of metrics
6. **Real-time Metrics**: WebSocket-based live dashboard updates

## Migration Notes

- **Breaking Change**: None - this is a new feature
- **Backward Compatible**: Yes - existing users remain as 'user' role
- **Database Changes**: None - roles are session-based, not stored
- **Environment Variables**: New optional variable `OIDC_REQUIRED_ADMIN_GROUP`

## References

- Admin Dashboard: `ui/src/app/(app)/admin/page.tsx`
- Admin API Routes: `ui/src/app/api/admin/`
- Auth Config: `ui/src/lib/auth-config.ts`
- API Middleware: `ui/src/lib/api-middleware.ts`
- Header Component: `ui/src/components/layout/AppHeader.tsx`

## Conventional Commit

```bash
feat(admin): add admin dashboard with dual RBAC (OIDC + MongoDB)

- Add OIDC_REQUIRED_ADMIN_GROUP environment variable
- Implement isAdminUser() helper for OIDC group checking
- Add MongoDB profile fallback for admin role in api-middleware
- Add session.role to NextAuth session and JWT with MongoDB check
- Create /api/admin/stats, /api/admin/users, and role management endpoints
- Build admin dashboard UI with metrics and user management
- Add role management buttons (promote/demote users)
- Show Admin tab only for admin users (OIDC or MongoDB)
- Add 403 checks on all admin routes with MongoDB fallback

Admin access is granted via OIDC group membership OR MongoDB
user.metadata.role === 'admin'. Platform metrics include DAU,
MAU, daily activity, top users, and shared conversation stats.
Admins can promote/demote other users via the dashboard.

Signed-off-by: Sri Aradhyula <sraradhy@cisco.com>
```
