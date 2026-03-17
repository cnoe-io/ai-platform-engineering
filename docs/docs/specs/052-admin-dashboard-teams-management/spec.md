---
sidebar_position: 2
sidebar_label: Specification
title: "2026-01-30: Admin Dashboard with Team Management"
---

# Admin Dashboard with Team Management

**Date**: 2026-01-30  
**Status**: Implemented  
**Type**: Feature Addition

## Summary

Enhanced the admin dashboard with a tabbed interface for Users, Teams, Statistics, and System Health. Added team management functionality allowing admins to create teams and share conversations with entire teams for improved collaboration.


## Features Added

### 1. Tabbed Admin Dashboard

The admin dashboard now has four organized tabs:

**Users Tab**
- User list with role management
- Promote/demote admin privileges
- View user activity and statistics
- Inline role updates

**Teams Tab**
- Create and manage collaboration teams
- View team members and owners
- Team-based conversation sharing
- Add/remove team members

**Statistics Tab**
- Daily activity charts (last 30 days)
- Top users by conversations
- Top users by messages
- DAU/MAU metrics

**System Health Tab**
- MongoDB connection status
- Authentication status (OIDC SSO)
- RAG server operational status
- Real-time health monitoring

### 2. Team Management

**Team Structure:**
```typescript
interface Team {
  _id: string;
  name: string;
  description?: string;
  owner_id: string;
  created_at: Date;
  updated_at: Date;
  members: TeamMember[];
}

interface TeamMember {
  user_id: string; // Email
  role: 'owner' | 'admin' | 'member';
  added_at: Date;
  added_by: string;
}
```

**Team Roles:**
- **Owner**: Team creator, full control
- **Admin**: Can manage members and settings
- **Member**: Can access shared conversations

### 3. Team-Based Conversation Sharing

Conversations can now be shared with:
- **Individual users** (existing)
- **Teams** (new) - All team members get access
- **Public links** (existing)

Updated conversation sharing structure:
```typescript
sharing: {
  is_public: boolean;
  shared_with: string[];        // User emails
  shared_with_teams: string[];  // Team IDs
  share_link_enabled: boolean;
  share_link_expires?: Date;
}
```


## Benefits

1. **Simplified Sharing**: Share with entire teams instead of individual users
2. **Scalable Collaboration**: Easy to add/remove team members
3. **Organized Access**: Team-based permissions align with org structure
4. **Reduced Admin Overhead**: Manage access at team level
5. **Better Visibility**: Clear dashboard for admin oversight


## Testing Strategy

### Create a Team

1. Navigate to Admin Dashboard → Teams tab
2. Click "Create Team"
3. Enter team name and description
4. Add members
5. Verify team appears in list

### Share Conversation with Team

1. Open a conversation
2. Click share button
3. Select "Share with Team"
4. Choose team from dropdown
5. Team members can now access the conversation

### Verify Team Access

1. Log in as team member
2. Navigate to shared conversations
3. Verify access to team-shared conversations
4. Confirm appropriate permissions


## Conventional Commit

```bash
feat(admin): add tabbed dashboard with team management

- Add tabbed interface for Users, Teams, Statistics, System Health
- Implement team creation and management APIs
- Add team-based conversation sharing
- Update conversation schema with shared_with_teams field
- Create Teams collection in MongoDB
- Add team member management (add/remove/roles)
- Update sidebar with admin features list
- Add team access control and permissions

Enables team-based collaboration by allowing admins to create
teams and share conversations with entire teams. Includes full
CRUD operations for teams and seamless integration with existing
conversation sharing.

Signed-off-by: Sri Aradhyula <sraradhy@cisco.com>
```


## Related

- Architecture: [architecture.md](./architecture.md)
