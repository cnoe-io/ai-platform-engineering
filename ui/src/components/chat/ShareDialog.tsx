"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, UserPlus, Copy, Check, Mail, Trash2, Users, Globe, ChevronDown } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useChatStore } from "@/store/chat-store";
import type { UserPublicInfo } from "@/types/mongodb";
import type { Team } from "@/types/teams";

type SharePermission = 'view' | 'comment';

interface ShareDialogProps {
  conversationId: string;
  conversationTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareDialog({
  conversationId,
  conversationTitle,
  open,
  onOpenChange,
}: ShareDialogProps) {
  const updateConversationSharing = useChatStore((state) => state.updateConversationSharing);
  const [searchInput, setSearchInput] = useState("");
  const [userResults, setUserResults] = useState<UserPublicInfo[]>([]);
  const [teamResults, setTeamResults] = useState<Team[]>([]);
  const [searching, setSearching] = useState(false);
  const [sharedWith, setSharedWith] = useState<string[]>([]);
  const [sharedWithTeams, setSharedWithTeams] = useState<string[]>([]);
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [noResults, setNoResults] = useState(false);
  const [isLegacyConversation, setIsLegacyConversation] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [togglingPublic, setTogglingPublic] = useState(false);
  const [userPermissions, setUserPermissions] = useState<Record<string, SharePermission>>({});
  const [teamPermissions, setTeamPermissions] = useState<Record<string, SharePermission>>({});
  const [defaultPermission, setDefaultPermission] = useState<SharePermission>('comment');
  const [publicPermission, setPublicPermission] = useState<SharePermission>('comment');

  const shareUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/chat/${conversationId}`;

  // Load current sharing info
  useEffect(() => {
    if (open) {
      loadSharingInfo();
    }
  }, [open, conversationId]);

  const loadSharingInfo = async () => {
    try {
      const response = await fetch(`/api/chat/conversations/${conversationId}/share`);
      if (response.ok) {
        const data = await response.json();
        const sharing = data.data?.sharing;
        setSharedWith(sharing?.shared_with || []);
        const teamIds = sharing?.shared_with_teams || [];
        setSharedWithTeams(teamIds);
        setIsPublic(sharing?.is_public || false);
        setIsLegacyConversation(false);

        // Build per-user permission map from access_list
        const accessList = data.data?.access_list || [];
        const userPerms: Record<string, SharePermission> = {};
        for (const entry of accessList) {
          if (entry.granted_to && entry.permission) {
            userPerms[entry.granted_to] = entry.permission;
          }
        }
        setUserPermissions(userPerms);

        // Build per-team permission map from sharing.team_permissions
        setTeamPermissions(sharing?.team_permissions || {});

        // Load public share permission
        setPublicPermission(sharing?.public_permission || 'comment');

        // Update store with sharing info so Sidebar shows icon immediately
        if (sharing) {
          updateConversationSharing(conversationId, {
            is_public: sharing.is_public,
            shared_with: sharing.shared_with,
            shared_with_teams: sharing.shared_with_teams,
            share_link_enabled: sharing.share_link_enabled,
          });
        }

        // Load team names for display
        if (teamIds.length > 0) {
          try {
            const teamsResponse = await fetch('/api/admin/teams');
            if (teamsResponse.ok) {
              const teamsData = await teamsResponse.json();
              const allTeams = teamsData.data?.teams || [];
              const namesMap: Record<string, string> = {};
              allTeams.forEach((team: Team) => {
                if (teamIds.includes(team._id)) {
                  namesMap[team._id] = team.name;
                }
              });
              setTeamNames(namesMap);
            }
          } catch (err) {
            console.error("Failed to load team names:", err);
          }
        }
      } else if (response.status === 404) {
        // Conversation not found — may still be syncing to MongoDB.
        // Only treat as legacy if storageMode is localStorage (no MongoDB at all).
        const { getStorageMode } = await import('@/lib/storage-config');
        const mode = getStorageMode();
        if (mode === 'mongodb') {
          // MongoDB is enabled but the conversation hasn't been persisted yet.
          // Show a transient "not ready" state instead of the legacy message.
          console.warn('[ShareDialog] Conversation not yet in MongoDB — may still be syncing:', conversationId);
          setIsLegacyConversation(false);
        } else {
          setIsLegacyConversation(true);
        }
      }
    } catch (err) {
      console.error("Failed to load sharing info:", err);
      // Don't assume legacy on network errors — only on explicit 404 + localStorage mode
      setIsLegacyConversation(false);
    }
  };

  // Search users and teams as they type
  useEffect(() => {
    const searchPeopleAndTeams = async () => {
      if (searchInput.length < 2) {
        setUserResults([]);
        setTeamResults([]);
        setNoResults(false);
        return;
      }

      setSearching(true);
      setNoResults(false);
      try {
        // Search users
        const users = await apiClient.searchUsers(searchInput);
        const filteredUsers = users.filter(u => !sharedWith.includes(u.email));
        setUserResults(filteredUsers);

        // Search teams (may require admin access - handle gracefully)
        try {
          const teamsResponse = await fetch('/api/admin/teams');
          if (teamsResponse.ok) {
            const teamsData = await teamsResponse.json();
            const allTeams = teamsData.data?.teams || [];
            // Filter teams by name/description matching search input
            const searchLower = searchInput.toLowerCase();
            const matchingTeams = allTeams.filter((team: Team) => {
              const nameMatch = team.name.toLowerCase().includes(searchLower);
              const descMatch = team.description?.toLowerCase().includes(searchLower);
              const notAlreadyShared = !sharedWithTeams.includes(team._id);
              return (nameMatch || descMatch) && notAlreadyShared;
            });
            setTeamResults(matchingTeams);
            
            // Show no results message if both are empty
            if (filteredUsers.length === 0 && matchingTeams.length === 0 && searchInput.length >= 2) {
              setNoResults(true);
            }
          } else if (teamsResponse.status === 403) {
            // Admin access required - teams search not available
            setTeamResults([]);
            // Still check user results
            if (filteredUsers.length === 0 && searchInput.length >= 2) {
              setNoResults(true);
            }
          } else {
            // Other error - still check user results
            setTeamResults([]);
            if (filteredUsers.length === 0 && searchInput.length >= 2) {
              setNoResults(true);
            }
          }
        } catch (teamErr) {
          console.error("Team search failed:", teamErr);
          setTeamResults([]);
          // If team search fails, still check user results
          if (filteredUsers.length === 0 && searchInput.length >= 2) {
            setNoResults(true);
          }
        }
      } catch (err) {
        console.error("Search failed:", err);
        setUserResults([]);
        setTeamResults([]);
        setNoResults(true);
      } finally {
        setSearching(false);
      }
    };

    const timer = setTimeout(searchPeopleAndTeams, 300);
    return () => clearTimeout(timer);
  }, [searchInput, sharedWith, sharedWithTeams]);

  const handleShareUser = async (email: string) => {
    setLoading(true);
    try {
      const updatedConversation = await apiClient.shareConversation(conversationId, {
        user_emails: [email],
        permission: defaultPermission,
      });

      setSharedWith([...sharedWith, email]);
      setUserPermissions({ ...userPermissions, [email]: defaultPermission });
      
      // Update store with new sharing info so Sidebar shows icon immediately
      if (updatedConversation?.sharing) {
        updateConversationSharing(conversationId, {
          is_public: updatedConversation.sharing.is_public,
          shared_with: updatedConversation.sharing.shared_with,
          shared_with_teams: updatedConversation.sharing.shared_with_teams,
          share_link_enabled: updatedConversation.sharing.share_link_enabled,
        });
      }
      
      setSearchInput("");
      setUserResults([]);
      setTeamResults([]);
      setNoResults(false);
    } catch (err: any) {
      console.error("Failed to share:", err);
      const errorMessage = err?.message || "Failed to share conversation";
      
      if (errorMessage.includes("not found") || errorMessage.includes("404")) {
        alert("This conversation doesn't exist in the database. Please create a new conversation to use sharing features.");
        onOpenChange(false);
      } else {
        alert(`Failed to share: ${errorMessage}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleShareTeam = async (teamId: string) => {
    setLoading(true);
    try {
      // Update conversation to include team in shared_with_teams
      const response = await fetch(`/api/chat/conversations/${conversationId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          team_ids: [teamId],
          permission: defaultPermission,
        }),
      });

      if (!response.ok) {
        // Try to get error message from API response
        let errorMessage = 'Failed to share with team';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch {
          // If response is not JSON, use status text
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      // Parse response to get updated conversation
      const responseData = await response.json();
      const updatedConversation = responseData.data;
      
      // Update store with new sharing info so Sidebar shows icon immediately
      if (updatedConversation?.sharing) {
        updateConversationSharing(conversationId, {
          is_public: updatedConversation.sharing.is_public,
          shared_with: updatedConversation.sharing.shared_with,
          shared_with_teams: updatedConversation.sharing.shared_with_teams,
          share_link_enabled: updatedConversation.sharing.share_link_enabled,
        });
      }

      // Reload sharing info to get updated state (updates dialog UI)
      await loadSharingInfo();
      
      setSearchInput("");
      setUserResults([]);
      setTeamResults([]);
      setNoResults(false);
    } catch (err: any) {
      console.error("Failed to share with team:", err);
      alert(`Failed to share with team: ${err?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  // Handle sharing by email directly (for users not yet in system)
  const handleShareByEmail = async () => {
    // Simple email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(searchInput)) {
      alert("Please enter a valid email address");
      return;
    }

    await handleShareUser(searchInput);
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handlePermissionChange = async (
    target: { email?: string; team_id?: string },
    newPermission: SharePermission
  ) => {
    try {
      const response = await fetch(`/api/chat/conversations/${conversationId}/share`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...target, permission: newPermission }),
      });
      if (!response.ok) return;
      if (target.email) {
        setUserPermissions((prev) => ({ ...prev, [target.email!]: newPermission }));
      }
      if (target.team_id) {
        setTeamPermissions((prev) => ({ ...prev, [target.team_id!]: newPermission }));
      }
    } catch (err) {
      console.error('Failed to update permission:', err);
    }
  };

  const handlePublicPermissionChange = async (newPermission: SharePermission) => {
    try {
      const response = await fetch(`/api/chat/conversations/${conversationId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_public: true, public_permission: newPermission }),
      });
      if (response.ok) {
        setPublicPermission(newPermission);
      }
    } catch (err) {
      console.error('Failed to update public permission:', err);
    }
  };

  const handleTogglePublic = async () => {
    setTogglingPublic(true);
    const newPublicState = !isPublic;
    try {
      const response = await fetch(`/api/chat/conversations/${conversationId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_public: newPublicState }),
      });

      if (!response.ok) {
        let errorMessage = 'Failed to update sharing';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch {
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const responseData = await response.json();
      const updatedConversation = responseData.data;

      setIsPublic(newPublicState);

      if (updatedConversation?.sharing) {
        updateConversationSharing(conversationId, {
          is_public: updatedConversation.sharing.is_public,
          shared_with: updatedConversation.sharing.shared_with,
          shared_with_teams: updatedConversation.sharing.shared_with_teams,
          share_link_enabled: updatedConversation.sharing.share_link_enabled,
        });
      }
    } catch (err: any) {
      console.error("Failed to toggle public sharing:", err);
      alert(`Failed to update sharing: ${err?.message || 'Unknown error'}`);
    } finally {
      setTogglingPublic(false);
    }
  };

  if (!open || typeof document === 'undefined') return null;

  // Render modal as a portal at document body level
  return createPortal(
    <div 
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        // Close dialog when clicking backdrop
        if (e.target === e.currentTarget) {
          onOpenChange(false);
        }
      }}
    >
      <div 
        className="bg-background rounded-lg shadow-xl w-full max-w-md p-6 mx-auto my-auto"
        onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside dialog
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Share Conversation</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {conversationTitle}
            </p>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Legacy conversation message */}
        {isLegacyConversation ? (
          <div className="py-8">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-16 h-16 rounded-full bg-yellow-500/10 flex items-center justify-center">
                <Mail className="h-8 w-8 text-yellow-500" />
              </div>
              <div>
                <h3 className="font-semibold mb-2">Legacy Conversation</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  This conversation was created before MongoDB integration and cannot be shared.
                </p>
                <p className="text-sm text-muted-foreground">
                  Please create a new conversation to use sharing features.
                </p>
              </div>
              <button
                onClick={() => {
                  onOpenChange(false);
                  // Navigate to new chat
                  window.location.href = '/chat';
                }}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
              >
                Create New Conversation
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Copy link section */}
        <div className="mb-6">
          <label className="text-sm font-medium mb-2 block">Share Link</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={shareUrl}
              readOnly
              className="flex-1 px-3 py-2 text-sm border rounded-md bg-muted"
            />
            <button
              onClick={handleCopyLink}
              className="px-3 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 flex items-center gap-2"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Copy
                </>
              )}
            </button>
          </div>
        </div>

        {/* Share with everyone toggle */}
        <div className="mb-6">
          <div className="flex items-center justify-between p-3 border rounded-md">
            <div className="flex items-center gap-3">
              <div className={`h-8 w-8 rounded-full flex items-center justify-center ${
                isPublic
                  ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                  : 'bg-muted text-muted-foreground'
              }`}>
                <Globe className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-medium">Share with everyone</div>
                <div className="text-xs text-muted-foreground">
                  {isPublic
                    ? `Anyone in the organization can ${publicPermission === 'comment' ? 'view and edit' : 'view'} this conversation`
                    : 'Only people and teams you add can access'}
                </div>
              </div>
            </div>
            <button
              onClick={handleTogglePublic}
              disabled={togglingPublic}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                isPublic ? 'bg-green-500' : 'bg-muted-foreground/30'
              } ${togglingPublic ? 'opacity-50 cursor-not-allowed' : ''}`}
              role="switch"
              aria-checked={isPublic}
              aria-label="Share with everyone"
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  isPublic ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Add people and teams section */}
        <div className="mb-6">
          <label className="text-sm font-medium mb-2 block">
            People, Teams
          </label>
          <div className="relative flex gap-2">
            <input
              type="text"
              placeholder="Search by email or team name..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="flex-1 px-3 py-2 text-sm border rounded-md"
            />
            <select
              value={defaultPermission}
              onChange={(e) => setDefaultPermission(e.target.value as SharePermission)}
              className="text-xs border rounded-md px-2 py-2 bg-background text-muted-foreground hover:text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/50"
              title="Permission for new shares"
            >
              <option value="view">Can view</option>
              <option value="comment">Can edit</option>
            </select>
            
            {/* Search results dropdown */}
            {((userResults.length > 0 || teamResults.length > 0 || noResults) && searchInput.length >= 2) && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-64 overflow-y-auto z-10">
                {/* User Results */}
                {userResults.length > 0 && (
                  <div className="px-2 py-1 border-b">
                    <div className="text-xs font-medium text-muted-foreground px-2 py-1">People</div>
                    {userResults.map((user) => (
                      <button
                        key={user.email}
                        onClick={() => handleShareUser(user.email)}
                        disabled={loading}
                        className="w-full px-3 py-2 text-left hover:bg-muted flex items-center gap-2 text-sm rounded-md"
                      >
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium">
                          {user.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium">{user.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {user.email}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Team Results */}
                {teamResults.length > 0 && (
                  <div className="px-2 py-1">
                    <div className="text-xs font-medium text-muted-foreground px-2 py-1">Teams</div>
                    {teamResults.map((team) => (
                      <button
                        key={team._id}
                        onClick={() => handleShareTeam(team._id)}
                        disabled={loading}
                        className="w-full px-3 py-2 text-left hover:bg-muted flex items-center gap-2 text-sm rounded-md"
                      >
                        <div className="h-8 w-8 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-400">
                          <Users className="h-4 w-4" />
                        </div>
                        <div className="flex-1">
                          <div className="font-medium">{team.name}</div>
                          {team.description && (
                            <div className="text-xs text-muted-foreground">
                              {team.description}
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                
                {/* No results - offer to share by email */}
                {noResults && !searching && userResults.length === 0 && teamResults.length === 0 && (
                  <div className="px-3 py-4">
                    <p className="text-sm text-muted-foreground mb-2">
                      No people or teams found
                    </p>
                    {/* Only show email share if it looks like an email */}
                    {/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(searchInput) && (
                      <>
                        <button
                          onClick={handleShareByEmail}
                          disabled={loading}
                          className="w-full px-3 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm font-medium"
                        >
                          Share with {searchInput}
                        </button>
                        <p className="text-xs text-muted-foreground mt-2">
                          They'll get access when they log in
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {searching && (
              <div className="absolute right-3 top-2.5">
                <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            )}
          </div>
        </div>

        {/* People and Teams with access */}
        {(sharedWith.length > 0 || sharedWithTeams.length > 0 || isPublic) && (
          <div>
            <label className="text-sm font-medium mb-2 block">
              Access ({isPublic ? 'Everyone' : `${sharedWith.length + sharedWithTeams.length} ${sharedWith.length + sharedWithTeams.length === 1 ? 'person/team' : 'people/teams'}`})
            </label>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {/* Everyone indicator */}
              {isPublic && (
                <div className="flex items-center justify-between py-2 px-3 bg-green-500/5 border border-green-500/20 rounded-md">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-green-500/10 flex items-center justify-center text-green-600 dark:text-green-400">
                      <Globe className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">Everyone</div>
                      <div className="text-xs text-muted-foreground">All organization members</div>
                    </div>
                  </div>
                  <select
                    value={publicPermission}
                    onChange={(e) => handlePublicPermissionChange(e.target.value as SharePermission)}
                    className="text-xs bg-transparent border border-green-500/30 rounded px-1.5 py-1 text-muted-foreground hover:text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/50"
                  >
                    <option value="view">Can view</option>
                    <option value="comment">Can edit</option>
                  </select>
                </div>
              )}
              {/* People */}
              {sharedWith.map((email) => (
                <div
                  key={email}
                  className="flex items-center justify-between py-2 px-3 bg-muted rounded-md"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium text-sm shrink-0">
                      {email.charAt(0).toUpperCase()}
                    </div>
                    <div className="text-sm truncate">{email}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <select
                      value={userPermissions[email] || 'view'}
                      onChange={(e) => handlePermissionChange({ email }, e.target.value as SharePermission)}
                      className="text-xs bg-transparent border border-border rounded px-1.5 py-1 text-muted-foreground hover:text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/50"
                    >
                      <option value="view">Can view</option>
                      <option value="comment">Can edit</option>
                    </select>
                    <button
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        // TODO: Implement remove access
                        setSharedWith(sharedWith.filter(e => e !== email));
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
              {/* Teams */}
              {sharedWithTeams.map((teamId) => (
                <div
                  key={teamId}
                  className="flex items-center justify-between py-2 px-3 bg-muted rounded-md"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className="h-8 w-8 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
                      <Users className="h-4 w-4" />
                    </div>
                    <div className="text-sm truncate">
                      {teamNames[teamId] || `Team: ${teamId}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <select
                      value={teamPermissions[teamId] || 'view'}
                      onChange={(e) => handlePermissionChange({ team_id: teamId }, e.target.value as SharePermission)}
                      className="text-xs bg-transparent border border-border rounded px-1.5 py-1 text-muted-foreground hover:text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/50"
                    >
                      <option value="view">Can view</option>
                      <option value="comment">Can edit</option>
                    </select>
                    <button
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        // TODO: Implement remove team access
                        setSharedWithTeams(sharedWithTeams.filter(t => t !== teamId));
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
          </>
        )}

        {/* Footer actions - only show for non-legacy conversations */}
        {!isLegacyConversation && (
          <div className="mt-6 flex justify-end gap-2">
            <button
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 text-sm border rounded-md hover:bg-muted"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
