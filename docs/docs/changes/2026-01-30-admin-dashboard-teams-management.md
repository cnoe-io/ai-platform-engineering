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

## API Endpoints

### Team Management

**GET /api/admin/teams**
- List all teams (admin only)
- Returns team details with member counts

**POST /api/admin/teams**
- Create a new team
- Request body:
  ```json
  {
    "name": "Platform Engineering",
    "description": "Platform team conversations",
    "members": ["user1@example.com", "user2@example.com"]
  }
  ```

**PATCH /api/admin/teams/[id]**
- Update team details
- Modify members and settings

**DELETE /api/admin/teams/[id]**
- Delete a team
- Only owner or admin can delete

### Conversation Sharing with Teams

**POST /api/chat/conversations/[id]/share**
- Share with teams:
  ```json
  {
    "is_public": false,
    "shared_with": ["user@example.com"],
    "shared_with_teams": ["team-id-1", "team-id-2"]
  }
  ```

## UI Components

### Admin Dashboard Tabs

```tsx
<Tabs value={activeTab} onValueChange={setActiveTab}>
  <TabsList>
    <TabsTrigger value="users">Users</TabsTrigger>
    <TabsTrigger value="teams">Teams</TabsTrigger>
    <TabsTrigger value="stats">Statistics</TabsTrigger>
    <TabsTrigger value="health">System Health</TabsTrigger>
  </TabsList>
  
  <TabsContent value="users">
    {/* User management */}
  </TabsContent>
  
  <TabsContent value="teams">
    {/* Team management */}
  </TabsContent>
  
  {/* ... other tabs */}
</Tabs>
```

### Sidebar Admin Section

Updated sidebar to show:
- Admin Dashboard title with shield icon
- Feature list:
  - User & Role Management
  - Team Collaboration
  - Usage Analytics
  - System Monitoring

## Database Schema

### Teams Collection

```javascript
{
  _id: ObjectId,
  name: "Platform Engineering Team",
  description: "Team for platform engineering discussions",
  owner_id: "owner@example.com",
  created_at: ISODate("2026-01-30T00:00:00Z"),
  updated_at: ISODate("2026-01-30T00:00:00Z"),
  members: [
    {
      user_id: "owner@example.com",
      role: "owner",
      added_at: ISODate("2026-01-30T00:00:00Z"),
      added_by: "owner@example.com"
    },
    {
      user_id: "member@example.com",
      role: "member",
      added_at: ISODate("2026-01-30T00:00:00Z"),
      added_by: "owner@example.com"
    }
  ],
  metadata: {
    department: "Engineering",
    tags: ["platform", "infrastructure"]
  }
}
```

### Updated Conversations Collection

```javascript
{
  // ... existing fields ...
  sharing: {
    is_public: false,
    shared_with: ["user1@example.com"],      // Individual users
    shared_with_teams: ["team-id-1"],        // NEW: Team-based sharing
    share_link_enabled: false,
    share_link_expires: null
  }
}
```

## Access Control

### Team Permissions

- **Team Creation**: Admin users only
- **Team Management**: Team owner and admins
- **Member Addition**: Team owner and admins
- **Member Removal**: Team owner and admins (cannot remove owner)
- **Team Deletion**: Team owner only

### Conversation Access via Teams

When a conversation is shared with a team:
1. All team members get read access
2. Members can view conversation history
3. Members can comment (if permission granted)
4. Original owner retains full control

## Use Cases

### 1. Department Collaboration

**Scenario**: Platform Engineering team needs to share infrastructure conversations

**Solution**:
```
1. Admin creates "Platform Engineering" team
2. Adds team members
3. Users share conversations with the team
4. All team members can access and collaborate
```

### 2. Project-Based Sharing

**Scenario**: Cross-functional team working on a project

**Solution**:
```
1. Create project-specific team (e.g., "Project Phoenix")
2. Add members from different departments
3. Share relevant conversations with project team
4. Everyone stays informed
```

### 3. Knowledge Sharing

**Scenario**: Best practices and solutions need to be accessible to entire teams

**Solution**:
```
1. Create knowledge-sharing teams by domain
2. Share high-value conversations with teams
3. New team members automatically get access
4. Organizational knowledge preserved
```

## Benefits

1. **Simplified Sharing**: Share with entire teams instead of individual users
2. **Scalable Collaboration**: Easy to add/remove team members
3. **Organized Access**: Team-based permissions align with org structure
4. **Reduced Admin Overhead**: Manage access at team level
5. **Better Visibility**: Clear dashboard for admin oversight

## Migration Notes

- **Backward Compatible**: Existing conversation sharing still works
- **No Data Migration**: `shared_with_teams` defaults to empty array
- **Gradual Adoption**: Teams are optional, individual sharing still available

## Future Enhancements

1. **Team Roles**: More granular permissions (viewer, commenter, editor)
2. **Team Analytics**: Usage statistics per team
3. **Team Channels**: Dedicated conversation spaces for teams
4. **Team Templates**: Pre-configured team structures
5. **Team Notifications**: Alert team members of new shared conversations
6. **Team Search**: Find conversations by team
7. **Team Hierarchies**: Support for nested teams (e.g., parent org → sub-teams)

## Testing

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
