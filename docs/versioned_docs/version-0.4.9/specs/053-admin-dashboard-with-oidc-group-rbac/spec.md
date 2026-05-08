---
sidebar_position: 2
sidebar_label: Specification
title: "2026-01-30: Admin Dashboard with OIDC Group-Based RBAC"
---

# Admin Dashboard with OIDC Group-Based RBAC

**Date**: 2026-01-30  
**Status**: Implemented  
**Type**: Feature Addition

## Summary

Added a comprehensive admin dashboard with role-based access control (RBAC) using dual authorization methods:
1. **OIDC Group Membership**: Users in `OIDC_REQUIRED_ADMIN_GROUP` are automatically admins
2. **MongoDB Profile**: Users with `metadata.role = 'admin'` in their MongoDB user document

Admin users can access platform metrics, user management, and usage statistics. Admins can also promote/demote other users via the dashboard.


## Motivation

The CAIPE platform needed administrative capabilities to:
- Monitor platform usage (DAU, MAU, conversation counts)
- Manage users and view activity
- Track system health and metrics
- Provide insights for capacity planning

Previously, there was no way to distinguish admin users from regular users, and no centralized dashboard for platform management.


## Testing Strategy

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


## Related

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


- Architecture: [architecture.md](./architecture.md)
