"use client";

import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Box,
  Plus,
  Trash2,
  Loader2,
  Globe,
  Users,
  Lock,
  RefreshCw,
  Play,
  Pause,
  Terminal,
} from "lucide-react";

interface Sandbox {
  _id: string;
  name: string;
  description?: string;
  type: "openshell";
  visibility: "private" | "team" | "global";
  status: "active" | "hibernating";
  created_at: string;
  owner?: string;
}

// Mock data for UI mockup
const MOCK_SANDBOXES: Sandbox[] = [
  {
    _id: "sandbox-0",
    name: "Shubham Personal Sandbox",
    description: "Personal development environment",
    type: "openshell",
    visibility: "private",
    status: "active",
    created_at: "2024-03-20T09:00:00Z",
    owner: "shubham@example.com",
  },
  {
    _id: "sandbox-1",
    name: "Development Environment",
    description: "Main development sandbox with full tooling",
    type: "openshell",
    visibility: "private",
    status: "active",
    created_at: "2024-03-15T10:00:00Z",
    owner: "user@example.com",
  },
  {
    _id: "sandbox-2",
    name: "Team Shared Sandbox",
    description: "Shared environment for team collaboration",
    type: "openshell",
    visibility: "team",
    status: "active",
    created_at: "2024-03-14T08:30:00Z",
    owner: "admin@example.com",
  },
  {
    _id: "sandbox-3",
    name: "Testing Environment",
    description: "Isolated testing sandbox",
    type: "openshell",
    visibility: "private",
    status: "hibernating",
    created_at: "2024-03-10T14:20:00Z",
    owner: "user@example.com",
  },
  {
    _id: "sandbox-4",
    name: "Global Demo Sandbox",
    description: "Public demo environment",
    type: "openshell",
    visibility: "global",
    status: "active",
    created_at: "2024-03-01T09:00:00Z",
    owner: "admin@example.com",
  },
];

export function SandboxesTab() {
  const [sandboxes, setSandboxes] = React.useState<Sandbox[]>(MOCK_SANDBOXES);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchSandboxes = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    // Mock fetch - in real implementation this would call an API
    setTimeout(() => {
      setSandboxes(MOCK_SANDBOXES);
      setLoading(false);
    }, 500);
  }, []);

  React.useEffect(() => {
    fetchSandboxes();
  }, [fetchSandboxes]);

  const handleDelete = async (sandboxId: string) => {
    if (!confirm("Are you sure you want to delete this sandbox?")) return;
    // Mock delete
    setSandboxes((prev) => prev.filter((s) => s._id !== sandboxId));
  };

  const handleToggleStatus = async (sandbox: Sandbox) => {
    // Mock toggle
    setSandboxes((prev) =>
      prev.map((s) =>
        s._id === sandbox._id
          ? { ...s, status: s.status === "active" ? "hibernating" : "active" }
          : s
      )
    );
  };

  const getVisibilityIcon = (visibility: string) => {
    switch (visibility) {
      case "global":
        return <Globe className="h-3 w-3" />;
      case "team":
        return <Users className="h-3 w-3" />;
      default:
        return <Lock className="h-3 w-3" />;
    }
  };

  const getVisibilityColor = (visibility: string) => {
    switch (visibility) {
      case "global":
        return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30";
      case "team":
        return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30";
      default:
        return "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/30";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30";
      case "hibernating":
        return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30";
      default:
        return "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/30";
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Sandboxes</CardTitle>
            <CardDescription>
              Manage isolated execution environments for agents.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchSandboxes} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => alert("Create sandbox dialog - TODO")}>
              <Plus className="h-4 w-4 mr-2" />
              Add Sandbox
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-destructive">{error}</p>
            <Button variant="outline" className="mt-4" onClick={fetchSandboxes}>
              Retry
            </Button>
          </div>
        ) : sandboxes.length === 0 ? (
          <div className="text-center py-12">
            <Box className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Sandboxes Yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first sandbox to get started.
            </p>
            <Button onClick={() => alert("Create sandbox dialog - TODO")}>
              <Plus className="h-4 w-4 mr-2" />
              Add Sandbox
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Header */}
            <div className="grid grid-cols-12 gap-4 pb-2 border-b text-xs font-medium text-muted-foreground px-2">
              <div className="col-span-4">Name</div>
              <div className="col-span-2">Visibility</div>
              <div className="col-span-2">Type</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            {/* Sandbox rows */}
            {sandboxes.map((sandbox) => (
              <div
                key={sandbox._id}
                className="grid grid-cols-12 gap-4 py-3 px-2 rounded-lg hover:bg-muted/50 items-center"
              >
                <div className="col-span-4">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0 bg-gradient-to-br from-purple-500 to-indigo-600">
                      <Terminal className="h-5 w-5 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">{sandbox.name}</div>
                      {sandbox.description && (
                        <div className="text-xs text-muted-foreground truncate">
                          {sandbox.description}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="col-span-2">
                  <Badge
                    variant="outline"
                    className={`gap-1 ${getVisibilityColor(sandbox.visibility)}`}
                  >
                    {getVisibilityIcon(sandbox.visibility)}
                    {sandbox.visibility}
                  </Badge>
                </div>

                <div className="col-span-2">
                  <Badge variant="outline" className="gap-1">
                    <Terminal className="h-3 w-3" />
                    {sandbox.type}
                  </Badge>
                </div>

                <div className="col-span-2">
                  <button
                    onClick={() => handleToggleStatus(sandbox)}
                    className="flex items-center gap-1.5"
                  >
                    {sandbox.status === "active" ? (
                      <>
                        <Play className="h-4 w-4 text-green-500" />
                        <Badge variant="outline" className={getStatusColor(sandbox.status)}>
                          Active
                        </Badge>
                      </>
                    ) : (
                      <>
                        <Pause className="h-4 w-4 text-yellow-500" />
                        <Badge variant="outline" className={getStatusColor(sandbox.status)}>
                          Hibernating
                        </Badge>
                      </>
                    )}
                  </button>
                </div>

                <div className="col-span-2 flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(sandbox._id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
