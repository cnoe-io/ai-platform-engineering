"use client";

import React from "react";
import { FileText, GitBranch, Cloud, Zap, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { labelFor } from "@/hooks/use-agent-tools";
import type { TaskStep, TaskConfigCategory } from "@/types/task-config";

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: TaskConfigCategory | string;
  icon: React.ReactNode;
  steps: TaskStep[];
}

const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "blank",
    name: "Blank Workflow",
    description: "Start from scratch with an empty canvas",
    category: "Custom",
    icon: <FileText className="h-5 w-5" />,
    steps: [],
  },
  {
    id: "simple-2-step",
    name: "Simple 2-Step",
    description: "Collect input and execute a single action",
    category: "Custom",
    icon: <Zap className="h-5 w-5" />,
    steps: [
      {
        display_text: "Collect user input",
        llm_prompt:
          "Collect the following information from the user and write to /request.txt:\n" +
          "- name (required): Resource name\n\n" +
          "Format as key=value on each line. Write to /request.txt.",
        subagent: "user_input",
      },
      {
        display_text: "Execute the action",
        llm_prompt: "Read /request.txt.\nExecute the requested action using the provided parameters.",
        subagent: "github",
      },
    ],
  },
  {
    id: "github-gitops",
    name: "GitHub GitOps Flow",
    description:
      "Collect input, check repo, create branch, commit, open PR, create Jira ticket, send notification",
    category: "GitHub Operations",
    icon: <GitBranch className="h-5 w-5" />,
    steps: [
      {
        display_text: "Collect repository details",
        llm_prompt:
          "Collect the following information from the user and write to /request.txt:\n" +
          "- repo_name (required): Repository name\n" +
          "- org_name (required): Organization (default: ${DEFAULT_GITHUB_ORG})\n" +
          "- description (optional): Repository description\n\n" +
          "Format as key=value on each line. Write to /request.txt.",
        subagent: "user_input",
      },
      {
        display_text: "Check if repository already exists",
        llm_prompt:
          "Read /request.txt.\n" +
          "Check if the repository already exists in the specified organization.\n" +
          "Write the check result to /check_result.txt.",
        subagent: "github",
      },
      {
        display_text: "Create a branch",
        llm_prompt:
          "Read /request.txt.\n" +
          "Create a new branch from main in ${WORKFLOWS_REPO}.\n" +
          "Write the branch name to /branch_result.txt.",
        subagent: "github",
      },
      {
        display_text: "Commit configuration files",
        llm_prompt:
          "Read /request.txt and /branch_result.txt.\n" +
          "Create and commit the required configuration files to the branch.\n" +
          "Write the commit SHA to /commit_result.txt.",
        subagent: "github",
      },
      {
        display_text: "Create a pull request",
        llm_prompt:
          "Read /branch_result.txt.\n" +
          'Create a PR with a descriptive title and body.\n' +
          "Write the PR URL to /pr_result.txt.",
        subagent: "github",
      },
      {
        display_text: "Wait for checks and merge",
        llm_prompt:
          "Read /pr_result.txt.\n" +
          "Wait for all status checks to pass (poll every 30s, up to 10 min).\n" +
          "Once checks pass, merge the PR using squash merge.",
        subagent: "github",
      },
      {
        display_text: "Create Jira ticket",
        llm_prompt:
          "Read /request.txt.\n" +
          "Create a Jira ticket in project OPENSD summarizing the action.\n" +
          "Write the ticket key to /jira_result.txt.",
        subagent: "jira",
      },
      {
        display_text: "Send Webex notification",
        llm_prompt:
          "Send a Webex notification to room ${WEBEX_ROOM_ID} summarizing the completed work.\n" +
          "Include the PR URL and Jira ticket key.",
        subagent: "webex",
      },
    ],
  },
  {
    id: "aws-infra",
    name: "AWS Infrastructure Flow",
    description:
      "Collect input, fetch Terraform template, process variables, branch, PR, Jira, and notify",
    category: "AWS Operations",
    icon: <Cloud className="h-5 w-5" />,
    steps: [
      {
        display_text: "Collect infrastructure parameters",
        llm_prompt:
          "Collect the following information from the user and write to /request.txt:\n" +
          "- instance_name (required): Instance name\n" +
          "- instance_type (required): Instance type (default: t3.medium)\n" +
          "- region (required): AWS region (default: us-east-1, field_values: ${DEFAULT_AWS_REGIONS})\n\n" +
          "Format as key=value on each line. Write to /request.txt.",
        subagent: "user_input",
      },
      {
        display_text: "Fetch Terraform template",
        llm_prompt:
          "Use get_file_contents to read the Terraform template from ${TERRAFORM_INFRA_REPO}.\n" +
          "Write the content to /template.tf.",
        subagent: "github",
      },
      {
        display_text: "Process template variables",
        llm_prompt:
          "Read /template.tf and /request.txt.\n" +
          "Replace all placeholders in the template with user-provided values.\n" +
          "Write processed content to /processed.tf.",
        subagent: "github",
      },
      {
        display_text: "Format Terraform file",
        llm_prompt:
          "Read /processed.tf.\n" +
          "Apply terraform_fmt to format the content.\n" +
          "Write the formatted content to /formatted.tf.",
        subagent: "github",
      },
      {
        display_text: "Create branch and commit",
        llm_prompt:
          "Read /formatted.tf and /request.txt.\n" +
          "Create a branch in ${TERRAFORM_INFRA_REPO} and commit the formatted Terraform file.\n" +
          "Write the branch name to /branch_result.txt.",
        subagent: "github",
      },
      {
        display_text: "Create pull request",
        llm_prompt:
          "Read /branch_result.txt.\n" +
          "Create a PR with title and description.\n" +
          "Write the PR URL to /pr_result.txt.",
        subagent: "github",
      },
      {
        display_text: "Create Jira ticket",
        llm_prompt:
          "Read /request.txt.\n" +
          "Create a Jira ticket in project OPENSD with summary and description.\n" +
          "Write the ticket key to /jira_result.txt.",
        subagent: "jira",
      },
      {
        display_text: "Send Webex notification",
        llm_prompt:
          "Send a Webex notification to room ${WEBEX_ROOM_ID} with a summary.\n" +
          "Include the PR URL and Jira ticket key.",
        subagent: "webex",
      },
    ],
  },
];

interface WorkflowTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (template: WorkflowTemplate) => void;
}

export function WorkflowTemplateDialog({
  open,
  onClose,
  onSelect,
}: WorkflowTemplateDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-2xl mx-4 rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-bold text-foreground">New Workflow</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Choose a template or start from scratch
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 grid grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto">
          {WORKFLOW_TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                onSelect(t);
                onClose();
              }}
              className={cn(
                "text-left rounded-xl border border-border p-4 transition-all",
                "hover:border-primary/50 hover:bg-primary/5 hover:shadow-md",
                "focus:outline-none focus:ring-2 focus:ring-primary/30"
              )}
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  {t.icon}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {t.name}
                  </h3>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {t.steps.length === 0
                      ? "Empty"
                      : `${t.steps.length} step${t.steps.length !== 1 ? "s" : ""}`}
                  </span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t.description}
              </p>
              {t.steps.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {[...new Set(t.steps.map((s) => s.subagent))].map((a) => (
                    <span
                      key={a}
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                    >
                      {labelFor(a)}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
