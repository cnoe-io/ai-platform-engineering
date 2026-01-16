"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UseCase } from "@/types/a2a";
import { cn } from "@/lib/utils";

const iconMap: Record<string, React.ElementType> = {
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

const categories = ["All", ...new Set(useCases.map((uc) => uc.category))];

interface UseCasesGalleryProps {
  onSelectUseCase: (prompt: string) => void;
}

export function UseCasesGallery({ onSelectUseCase }: UseCasesGalleryProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const filteredUseCases = useCases.filter((uc) => {
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
  const featuredUseCases = useCases.filter((uc) =>
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
                    {useCases.filter((uc) => uc.category === cat).length}
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
                  onClick={() => onSelectUseCase(useCase.prompt)}
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
                    onClick={() => onSelectUseCase(useCase.prompt)}
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
                        <Badge
                          variant="outline"
                          className={cn("text-xs font-medium", getDifficultyColor(useCase.difficulty))}
                        >
                          {useCase.difficulty}
                        </Badge>
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
    </div>
  );
}
