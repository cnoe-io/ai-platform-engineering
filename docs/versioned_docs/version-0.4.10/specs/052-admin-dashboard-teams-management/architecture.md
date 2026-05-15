---
sidebar_position: 1
id: 052-admin-dashboard-teams-management-architecture
sidebar_label: Architecture
---

# Architecture: Admin Dashboard with Team Management

**Date**: 2026-01-30

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


## Related

- Spec: [spec.md](./spec.md)
