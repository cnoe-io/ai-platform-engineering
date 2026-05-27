// Team types for team management and sharing

export interface Team {
  _id: string;
  name: string;
  description?: string;
  owner_id: string; // User email who created the team
  created_at: Date;
  updated_at: Date;
  members: TeamMember[];
  metadata?: {
    department?: string;
    tags?: string[];
  };
}

export interface TeamMember {
  user_id: string; // User email
  role: 'owner' | 'admin' | 'member';
  added_at: Date;
  added_by: string; // User email
}

export interface CreateTeamRequest {
  name: string;
  description?: string;
  members?: string[]; // Array of user emails
}

export interface UpdateTeamRequest {
  name?: string;
  description?: string;
}

export interface AddTeamMemberRequest {
  user_id: string; // User email
  role?: 'admin' | 'member';
}
