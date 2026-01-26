"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  ArrowRight,
  GitBranch,
  Server,
  Bug,
  BarChart,
  Shield,
  Cloud,
  Rocket,
  Zap,
  Database,
  Settings,
  Users,
  Clock,
  AlertTriangle,
  CheckCircle,
  GitPullRequest,
  X,
  ExternalLink,
  Edit,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UseCase } from "@/types/a2a";
import { cn } from "@/lib/utils";
import { UseCaseBuilderDialog } from "./UseCaseBuilder";

const iconMap: Record<string, React.ElementType> = {
  GitBranch,
  GitPullRequest,
  Server,
  Bug,
  BarChart,
  Shield,
  Cloud,
  Rocket,
  Zap,
  Database,
  Settings,
  Users,
  Clock,
  AlertTriangle,
  CheckCircle,
};

// Sample use cases inspired by ag-ui composer gallery
const useCases: UseCase[] = [
  {
    id: "deploy-status",
    title: "Check Deployment Status",
    description: "Get the current status of all ArgoCD applications and identify any that are out of sync or unhealthy.",
    category: "DevOps",
    tags: ["ArgoCD", "Kubernetes", "Monitoring"],
    prompt: "Show me the status of all ArgoCD applications. Identify any that are OutOfSync or Degraded.",
    expectedAgents: ["ArgoCD"],
    thumbnail: "Server",
    difficulty: "beginner",
  },
  {
    id: "pr-review",
    title: "Review Open Pull Requests",
    description: "List all open PRs across repositories with their review status and CI/CD results.",
    category: "Development",
    tags: ["GitHub", "Code Review", "CI/CD"],
    prompt: "List all open pull requests in our repositories. Show review status and any failing checks.",
    expectedAgents: ["GitHub"],
    thumbnail: "GitBranch",
    difficulty: "beginner",
  },
  {
    id: "review-specific-pr",
    title: "Review a Specific PR",
    description: "Get a detailed code review of a specific GitHub Pull Request including changes, comments, and recommendations.",
    category: "Development",
    tags: ["GitHub", "Code Review", "PR Analysis"],
    prompt: "Review the GitHub Pull Request at {{prUrl}}. Analyze the code changes, check for potential issues, review the test coverage, and provide a comprehensive code review summary with recommendations.",
    expectedAgents: ["GitHub"],
    thumbnail: "GitPullRequest",
    difficulty: "intermediate",
    inputForm: {
      title: "Review a GitHub Pull Request",
      description: "Enter the PR URL or repository details to get a comprehensive code review.",
      fields: [
        {
          name: "prUrl",
          label: "PR URL or Link",
          placeholder: "https://github.com/owner/repo/pull/123",
          type: "url",
          required: true,
          helperText: "Paste the full GitHub PR URL (e.g., https://github.com/cnoe-io/ai-platform-engineering/pull/42)",
        },
      ],
      submitLabel: "Start Review",
    },
  },
  {
    id: "incident-analysis",
    title: "Incident Investigation",
    description: "Correlate PagerDuty incidents with related Jira tickets and recent deployments.",
    category: "Operations",
    tags: ["PagerDuty", "Jira", "ArgoCD", "Multi-Agent"],
    prompt: "Show me active PagerDuty incidents and find related Jira tickets. Also check if there were any recent deployments that might be related.",
    expectedAgents: ["PagerDuty", "Jira", "ArgoCD"],
    thumbnail: "AlertTriangle",
    difficulty: "advanced",
  },
  {
    id: "cost-analysis",
    title: "AWS Cost Analysis",
    description: "Analyze AWS costs by service and identify opportunities for optimization.",
    category: "Cloud",
    tags: ["AWS", "Cost", "Optimization"],
    prompt: "Show me the AWS cost breakdown for the last month. Identify the top 5 most expensive services and any cost anomalies.",
    expectedAgents: ["AWS"],
    thumbnail: "Cloud",
    difficulty: "intermediate",
  },
  {
    id: "sprint-report",
    title: "Sprint Progress Report",
    description: "Generate a comprehensive sprint report with velocity metrics and burndown analysis.",
    category: "Project Management",
    tags: ["Jira", "Agile", "Reporting"],
    prompt: "Generate a sprint progress report for the current sprint. Show velocity, burndown, and identify any blockers.",
    expectedAgents: ["Jira"],
    thumbnail: "BarChart",
    difficulty: "intermediate",
  },
  {
    id: "oncall-handoff",
    title: "On-Call Handoff",
    description: "Generate a comprehensive handoff document for on-call rotation.",
    category: "Operations",
    tags: ["PagerDuty", "Jira", "ArgoCD", "Multi-Agent"],
    prompt: "Generate an on-call handoff document. Include open incidents, ongoing issues, recent deployments, and any systems to watch.",
    expectedAgents: ["PagerDuty", "Jira", "ArgoCD"],
    thumbnail: "Users",
    difficulty: "advanced",
  },
  {
    id: "security-scan",
    title: "Security Vulnerability Report",
    description: "Check for security vulnerabilities in GitHub repositories and Dependabot alerts.",
    category: "Security",
    tags: ["GitHub", "Security", "Dependabot"],
    prompt: "Check all repositories for security vulnerabilities. Show Dependabot alerts and code scanning results.",
    expectedAgents: ["GitHub"],
    thumbnail: "Shield",
    difficulty: "intermediate",
  },
  {
    id: "resource-health",
    title: "Cluster Resource Health",
    description: "Check Kubernetes cluster health including pod status, resource utilization, and alerts.",
    category: "Infrastructure",
    tags: ["AWS", "Kubernetes", "Monitoring"],
    prompt: "Check the health of our EKS clusters. Show any failing pods, resource constraints, or pending alerts.",
    expectedAgents: ["AWS"],
    thumbnail: "Database",
    difficulty: "intermediate",
  },
  {
    id: "release-readiness",
    title: "Release Readiness Check",
    description: "Verify all prerequisites are met before a release: PRs merged, tests passing, environments healthy.",
    category: "DevOps",
    tags: ["GitHub", "ArgoCD", "Jira", "Multi-Agent"],
    prompt: "Check if we're ready for a release. Verify all PRs are merged, tests are passing, staging environment is healthy, and no blocking issues exist.",
    expectedAgents: ["GitHub", "ArgoCD", "Jira"],
    thumbnail: "Rocket",
    difficulty: "advanced",
  },
  {
    id: "knowledge-search",
    title: "Documentation Search",
    description: "Search internal knowledge base for runbooks, architecture docs, and best practices.",
    category: "Knowledge",
    tags: ["RAG", "Documentation"],
    prompt: "Search our knowledge base for information about our deployment process and best practices.",
    expectedAgents: ["RAG"],
    thumbnail: "Zap",
    difficulty: "beginner",
  },
];

interface UseCasesGalleryProps {
  onSelectUseCase: (prompt: string) => void;
  refreshTrigger?: number; // Increment this to trigger a refresh
}

export function UseCasesGallery({ onSelectUseCase, refreshTrigger }: UseCasesGalleryProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [savedUseCases, setSavedUseCases] = useState<UseCase[]>([]);
  const [isLoadingSaved, setIsLoadingSaved] = useState(false);

  // Fetch saved use cases from API
  const fetchSavedUseCases = useCallback(async () => {
    setIsLoadingSaved(true);
    try {
      const response = await fetch("/api/usecases");
      if (response.ok) {
        const data = await response.json();
        // Transform saved use cases to match UseCase interface
        const transformed = data.map((uc: any) => {
          const category = uc.category || "Custom";
          const tags = Array.isArray(uc.tags) ? uc.tags : [];
          // Ensure category is included in tags if not already present
          const finalTags = tags.includes(category) ? tags : [...tags, category];
          
          return {
            ...uc,
            thumbnail: uc.thumbnail || "Sparkles", // Default icon
            // Ensure category matches expected format
            category,
            // Ensure tags includes category
            tags: finalTags,
            // Ensure expectedAgents is an array
            expectedAgents: Array.isArray(uc.expectedAgents) ? uc.expectedAgents : [],
          };
        });
        setSavedUseCases(transformed);
      }
    } catch (error) {
      console.error("Error fetching saved use cases:", error);
    } finally {
      setIsLoadingSaved(false);
    }
  }, []);

  // Fetch on mount and when refreshTrigger changes
  useEffect(() => {
    fetchSavedUseCases();
  }, [fetchSavedUseCases, refreshTrigger]);

  // Combine hardcoded and saved use cases
  const allUseCases = [...useCases, ...savedUseCases];
  const categories = ["All", ...new Set(allUseCases.map((uc) => uc.category))];

  // Input form state
  const [activeFormUseCase, setActiveFormUseCase] = useState<UseCase | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  
  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [useCaseToEdit, setUseCaseToEdit] = useState<UseCase | null>(null);

  // Extract placeholders from prompt (e.g., {{name}}, {{appName}}, {{name of the argocd app}})
  const extractPlaceholders = (prompt: string): string[] => {
    // Match {{...}} with any characters inside (including spaces, hyphens, etc.)
    // but trim whitespace from the captured group
    const placeholderRegex = /\{\{([^}]+)\}\}/g;
    const matches = [];
    let match;
    while ((match = placeholderRegex.exec(prompt)) !== null) {
      // Trim whitespace and normalize the placeholder name
      const placeholder = match[1].trim();
      if (placeholder) {
        matches.push(placeholder);
      }
    }
    return [...new Set(matches)]; // Remove duplicates
  };

  // Generate input form from placeholders if not already defined
  const generateInputFormFromPlaceholders = (useCase: UseCase): UseCase["inputForm"] | null => {
    // If use case already has an inputForm, use it
    if (useCase.inputForm) {
      return useCase.inputForm;
    }

    // Extract placeholders from prompt
    const placeholders = extractPlaceholders(useCase.prompt);
    if (placeholders.length === 0) {
      return null;
    }

    // Generate fields from placeholders
    const fields = placeholders.map((placeholder) => {
      // Convert placeholder name to label
      // Handle camelCase, snake_case, kebab-case, and plain names with spaces
      // For placeholders like "name of the argocd app", keep the original format but capitalize
      let label = placeholder
        .replace(/_/g, " ") // Replace underscores with spaces
        .replace(/-/g, " ") // Replace hyphens with spaces
        .replace(/([A-Z])/g, " $1") // Add space before capital letters
        .replace(/\s+/g, " ") // Collapse multiple spaces
        .trim();
      
      // Capitalize first letter of each word
      label = label
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ");

      // Determine field type based on placeholder name
      let type: "text" | "url" | "number" = "text";
      if (placeholder.toLowerCase().includes("url") || placeholder.toLowerCase().includes("link")) {
        type = "url";
      } else if (placeholder.toLowerCase().includes("count") || placeholder.toLowerCase().includes("number")) {
        type = "number";
      }

      return {
        name: placeholder,
        label,
        placeholder: `Enter ${label.toLowerCase()}`,
        type,
        required: true,
      };
    });

    return {
      title: useCase.title,
      description: `Please provide the following information to proceed with "${useCase.title}"`,
      fields,
      submitLabel: "Start",
    };
  };

  // Handle use case click - show form if it has one or has placeholders, otherwise submit directly
  const handleUseCaseClick = (useCase: UseCase) => {
    // Check if use case has inputForm or placeholders in prompt
    const inputForm = generateInputFormFromPlaceholders(useCase);
    
    if (inputForm) {
      // Create a use case with the generated input form
      const useCaseWithForm = { ...useCase, inputForm };
      setActiveFormUseCase(useCaseWithForm);
      // Initialize form values
      const initialValues: Record<string, string> = {};
      inputForm.fields.forEach((field) => {
        initialValues[field.name] = "";
      });
      setFormValues(initialValues);
      setFormErrors({});
    } else {
      onSelectUseCase(useCase.prompt);
    }
  };

  // Handle form field change
  const handleFormChange = (fieldName: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [fieldName]: value }));
    // Clear error when user types
    if (formErrors[fieldName]) {
      setFormErrors((prev) => ({ ...prev, [fieldName]: "" }));
    }
  };

  // Handle form submission
  const handleFormSubmit = () => {
    if (!activeFormUseCase?.inputForm) return;

    // Validate required fields
    const errors: Record<string, string> = {};
    activeFormUseCase.inputForm.fields.forEach((field) => {
      if (field.required && !formValues[field.name]?.trim()) {
        errors[field.name] = `${field.label} is required`;
      }
    });

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    // Replace placeholders in prompt with form values
    // Need to escape special regex characters in the placeholder name
    let prompt = activeFormUseCase.prompt;
    Object.entries(formValues).forEach(([key, value]) => {
      // Escape special regex characters in the placeholder name
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Match the placeholder with any whitespace variations
      const regex = new RegExp(`\\{\\{\\s*${escapedKey}\\s*\\}\\}`, "g");
      prompt = prompt.replace(regex, value.trim());
    });

    // Close form and submit
    setActiveFormUseCase(null);
    onSelectUseCase(prompt);
  };

  // Close form
  const handleCloseForm = () => {
    setActiveFormUseCase(null);
    setFormValues({});
    setFormErrors({});
  };

  // Handle edit button click
  const handleEditClick = (e: React.MouseEvent, useCase: UseCase) => {
    e.stopPropagation(); // Prevent card click
    // Only allow editing saved use cases (not hardcoded ones)
    const isSavedUseCase = savedUseCases.some((uc) => uc.id === useCase.id);
    if (isSavedUseCase) {
      setUseCaseToEdit(useCase);
      setEditDialogOpen(true);
    }
  };

  // Handle edit dialog success
  const handleEditSuccess = () => {
    setEditDialogOpen(false);
    setUseCaseToEdit(null);
    // Trigger refresh to get updated use cases
    fetchSavedUseCases();
  };

  const filteredUseCases = allUseCases.filter((uc) => {
    const matchesSearch =
      uc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      uc.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      uc.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCategory = selectedCategory === "All" || uc.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const getDifficultyColor = (difficulty: UseCase["difficulty"]) => {
    switch (difficulty) {
      case "beginner":
        return "bg-green-500/20 text-green-400";
      case "intermediate":
        return "bg-yellow-500/20 text-yellow-400";
      case "advanced":
        return "bg-red-500/20 text-red-400";
    }
  };

  // Featured use cases (first 3 or marked as featured)
  const featuredUseCases = allUseCases.filter((uc) =>
    ["deploy-status", "incident-analysis", "release-readiness"].includes(uc.id)
  );

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      {/* Hero Header with Gradient */}
      <div className="relative overflow-hidden border-b border-border">
        {/* Gradient Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-[hsl(173,80%,40%)]/20 via-[hsl(270,75%,60%)]/10 to-transparent" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent" />

        <div className="relative px-8 py-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-[hsl(173,80%,40%)] to-[hsl(270,75%,60%)] shadow-lg shadow-primary/30">
              <Zap className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold gradient-text">Use Cases Gallery</h1>
              <p className="text-muted-foreground text-sm">
                Explore platform engineering scenarios • Click to try with CAIPE
              </p>
            </div>
          </div>

          {/* Search Bar - More prominent */}
          <div className="relative max-w-xl mt-6">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Search use cases by name, tag, or category..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-12 h-12 text-base bg-card/80 backdrop-blur-sm border-border/50 focus:border-primary"
            />
          </div>

          {/* Categories - Pill style */}
          <div className="flex gap-2 flex-wrap mt-4">
            {categories.map((cat) => (
              <Button
                key={cat}
                variant={selectedCategory === cat ? "default" : "ghost"}
                size="sm"
                onClick={() => setSelectedCategory(cat)}
                className={cn(
                  "rounded-full transition-all",
                  selectedCategory === cat
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "hover:bg-muted"
                )}
              >
                {cat}
                {cat !== "All" && (
                  <Badge variant="secondary" className="ml-1.5 text-xs px-1.5">
                    {allUseCases.filter((uc) => uc.category === cat).length}
                  </Badge>
                )}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Featured Section - Only show when no search/filter */}
      {searchQuery === "" && selectedCategory === "All" && (
        <div className="px-8 py-6 border-b border-border/50 bg-muted/30">
          <div className="flex items-center gap-2 mb-4">
            <Rocket className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-sm">Featured Use Cases</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {featuredUseCases.map((useCase) => {
              const Icon = iconMap[useCase.thumbnail || "Zap"] || Zap;
              return (
                <motion.button
                  key={useCase.id}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleUseCaseClick(useCase)}
                  className="flex items-center gap-3 p-4 rounded-xl bg-card border border-border/50 hover:border-primary hover:shadow-lg hover:shadow-primary/10 transition-all text-left group"
                >
                  <div className="p-2 rounded-lg bg-gradient-to-br from-[hsl(173,80%,40%)] to-[hsl(270,75%,60%)] shrink-0 group-hover:scale-110 transition-transform">
                    <Icon className="h-4 w-4 text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{useCase.title}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      {useCase.expectedAgents.slice(0, 2).map((agent) => (
                        <Badge key={agent} variant="secondary" className="text-[10px] px-1.5 py-0">
                          {agent}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all ml-auto shrink-0" />
                </motion.button>
              );
            })}
          </div>
        </div>
      )}

      {/* Gallery Grid */}
      <ScrollArea className="flex-1">
        <div className="p-8">
          {/* Section Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">All Use Cases</h2>
              <Badge variant="secondary" className="text-xs">
                {filteredUseCases.length} available
              </Badge>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {filteredUseCases.map((useCase, index) => {
              const Icon = iconMap[useCase.thumbnail || "Zap"] || Zap;
              const isHovered = hoveredId === useCase.id;

              return (
                <motion.div
                  key={useCase.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03, duration: 0.3 }}
                  onMouseEnter={() => setHoveredId(useCase.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  whileHover={{ y: -4 }}
                >
                  <Card
                    className={cn(
                      "group cursor-pointer transition-all duration-300 h-full overflow-hidden",
                      isHovered
                        ? "border-primary shadow-xl shadow-primary/20 ring-1 ring-primary/20"
                        : "hover:border-border/80"
                    )}
                    onClick={() => handleUseCaseClick(useCase)}
                  >
                    {/* Gradient accent bar */}
                    <div className={cn(
                      "h-1 w-full bg-gradient-to-r from-[hsl(173,80%,40%)] via-[hsl(270,75%,60%)] to-[hsl(330,80%,55%)] transition-opacity duration-300",
                      isHovered ? "opacity-100" : "opacity-30"
                    )} />

                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div
                          className={cn(
                            "p-2.5 rounded-xl transition-all duration-300",
                            isHovered
                              ? "bg-gradient-to-br from-[hsl(173,80%,40%)] to-[hsl(270,75%,60%)] shadow-lg shadow-primary/30 scale-110"
                              : "bg-primary/15"
                          )}
                        >
                          <Icon
                            className={cn(
                              "h-5 w-5 transition-colors",
                              isHovered ? "text-white" : "text-primary"
                            )}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          {/* Edit button - only for saved use cases */}
                          {savedUseCases.some((uc) => uc.id === useCase.id) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 hover:bg-primary/10 hover:text-primary"
                              onClick={(e) => handleEditClick(e, useCase)}
                              title="Edit use case"
                            >
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Badge
                            variant="outline"
                            className={cn("text-xs font-medium", getDifficultyColor(useCase.difficulty))}
                          >
                            {useCase.difficulty}
                          </Badge>
                        </div>
                      </div>
                      <CardTitle className="text-lg mt-4 group-hover:text-primary transition-colors">
                        {useCase.title}
                      </CardTitle>
                      <CardDescription className="line-clamp-2 text-sm">
                        {useCase.description}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex flex-wrap gap-1.5 mb-4">
                        {useCase.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs font-normal">
                            {tag}
                          </Badge>
                        ))}
                      </div>

                      <div className="flex items-center justify-between pt-3 border-t border-border/50">
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground mr-1">Agents:</span>
                          {useCase.expectedAgents.slice(0, 2).map((agent) => (
                            <Badge key={agent} variant="outline" className="text-xs font-medium">
                              {agent}
                            </Badge>
                          ))}
                          {useCase.expectedAgents.length > 2 && (
                            <Badge variant="outline" className="text-xs">
                              +{useCase.expectedAgents.length - 2}
                            </Badge>
                          )}
                        </div>

                        <div
                          className={cn(
                            "flex items-center gap-1 text-sm font-medium text-primary transition-all duration-300",
                            isHovered ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-2"
                          )}
                        >
                          Try it
                          <ArrowRight className="h-4 w-4" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>

          {filteredUseCases.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg">No use cases found</p>
              <p className="text-sm">Try adjusting your search or filters</p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input Form Modal */}
      <AnimatePresence>
        {activeFormUseCase?.inputForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={handleCloseForm}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="relative w-full max-w-lg mx-4 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header gradient */}
              <div className="h-1.5 w-full bg-gradient-to-r from-[hsl(173,80%,40%)] via-[hsl(270,75%,60%)] to-[hsl(330,80%,55%)]" />

              <div className="p-6">
                {/* Header */}
                <div className="flex items-start justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-gradient-to-br from-[hsl(173,80%,40%)] to-[hsl(270,75%,60%)] shadow-lg">
                      <GitPullRequest className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold">{activeFormUseCase.inputForm.title}</h2>
                      {activeFormUseCase.inputForm.description && (
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {activeFormUseCase.inputForm.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={handleCloseForm}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                {/* Form Fields */}
                <div className="space-y-4">
                  {activeFormUseCase.inputForm.fields.map((field) => (
                    <div key={field.name} className="space-y-2">
                      <label className="text-sm font-medium flex items-center gap-1">
                        {field.label}
                        {field.required && <span className="text-red-400">*</span>}
                      </label>
                      <Input
                        type={field.type}
                        placeholder={field.placeholder}
                        value={formValues[field.name] || ""}
                        onChange={(e) => handleFormChange(field.name, e.target.value)}
                        className={cn(
                          "h-12",
                          formErrors[field.name] && "border-red-500 focus:border-red-500"
                        )}
                      />
                      {field.helperText && !formErrors[field.name] && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <ExternalLink className="h-3 w-3" />
                          {field.helperText}
                        </p>
                      )}
                      {formErrors[field.name] && (
                        <p className="text-xs text-red-400">{formErrors[field.name]}</p>
                      )}
                    </div>
                  ))}
                </div>

                {/* Preview of generated prompt */}
                {Object.values(formValues).some(v => v.trim()) && (
                  <div className="mt-6 p-3 bg-muted/50 rounded-lg border border-border/50">
                    <p className="text-xs text-muted-foreground mb-1">Preview:</p>
                    <p className="text-sm">
                      {activeFormUseCase.prompt.replace(
                        /\{\{([^}]+)\}\}/g,
                        (match, key) => {
                          const trimmedKey = key.trim();
                          return formValues[trimmedKey]?.trim() || match;
                        }
                      ).substring(0, 150)}...
                    </p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-border/50">
                  <Button variant="ghost" onClick={handleCloseForm}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleFormSubmit}
                    className="bg-gradient-to-r from-[hsl(173,80%,40%)] to-[hsl(270,75%,60%)] text-white hover:opacity-90"
                  >
                    <Rocket className="h-4 w-4 mr-2" />
                    {activeFormUseCase.inputForm.submitLabel || "Submit"}
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Use Case Dialog */}
      <UseCaseBuilderDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onSuccess={handleEditSuccess}
        existingUseCase={useCaseToEdit ? {
          id: useCaseToEdit.id,
          title: useCaseToEdit.title,
          description: useCaseToEdit.description,
          category: useCaseToEdit.category,
          tags: useCaseToEdit.tags,
          prompt: useCaseToEdit.prompt,
          expectedAgents: useCaseToEdit.expectedAgents,
          difficulty: useCaseToEdit.difficulty,
        } : undefined}
      />
    </div>
  );
}
