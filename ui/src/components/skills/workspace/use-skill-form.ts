"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { useAgentSkillsStore } from "@/store/agent-skills-store";
import {
  parseSkillMd,
  resolvePersistedSkillMarkdownForEditor,
  updateAllowedToolsInFrontmatter,
} from "@/lib/skill-md-parser";
import {
  type AgentSkill,
  type CreateAgentSkillInput,
  type SkillInputVariable,
  type SkillVisibility,
  type WorkflowDifficulty,
} from "@/types/agent-skill";

/**
 * `useSkillForm` — single source of truth for the Skill authoring form.
 *
 * Owns every piece of state that the legacy `SkillsBuilderEditor` previously
 * held inline plus the submit/dirty plumbing, so the (much smaller) new
 * Workspace components and the existing Builder can both consume the same
 * hook without duplicating logic.
 *
 * Behavior is intentionally identical to the inline state in
 * `SkillsBuilderEditor` as of the extraction; see the corresponding tests in
 * `__tests__/use-skill-form.test.ts`.
 */
export interface UseSkillFormOptions {
  existingConfig?: AgentSkill;
  /**
   * Called after a successful create/update.
   *
   * `result.id` is the persisted skill id — for the create path this is the
   * newly-minted server-side id (the in-memory `existingConfig` is still
   * `undefined` at that point), for updates it echoes `existingConfig.id`.
   * `result.created` is `true` when the call hit the create branch and
   * `false` for updates, so callers can distinguish post-create flows
   * (e.g. navigate to the persisted workspace + kick off a scan) from
   * in-place save flows.
   */
  onSuccess?: (result: { id: string; created: boolean }) => void;
  /** Used by the parent shell when the form requests a discard-aware close. */
  onClose?: () => void;
}

export interface UseSkillFormResult {
  // ---- Identity -----------------------------------------------------------
  isEditMode: boolean;

  // ---- Metadata form ------------------------------------------------------
  formData: {
    name: string;
    description: string;
    category: string;
    difficulty: WorkflowDifficulty;
    thumbnail: string;
  };
  setFormData: React.Dispatch<
    React.SetStateAction<UseSkillFormResult["formData"]>
  >;
  tags: string[];
  setTags: React.Dispatch<React.SetStateAction<string[]>>;
  visibility: SkillVisibility;
  setVisibility: React.Dispatch<React.SetStateAction<SkillVisibility>>;
  selectedTeamIds: string[];
  setSelectedTeamIds: React.Dispatch<React.SetStateAction<string[]>>;

  // ---- Variables ----------------------------------------------------------
  inputVariables: SkillInputVariable[];
  setInputVariables: React.Dispatch<React.SetStateAction<SkillInputVariable[]>>;

  // ---- Tools --------------------------------------------------------------
  allowedTools: string[];
  setAllowedTools: React.Dispatch<React.SetStateAction<string[]>>;

  // ---- SKILL.md content ---------------------------------------------------
  skillContent: string;
  setSkillContent: React.Dispatch<React.SetStateAction<string>>;
  /**
   * Use when content originates from a non-typing source (template load, AI,
   * import, undo/redo) — re-parses frontmatter and resyncs `allowedTools`
   * without re-triggering the tools→frontmatter effect.
   */
  setSkillContentAndSyncTools: (next: string) => void;

  // ---- Ancillary files ----------------------------------------------------
  ancillaryFiles: Record<string, string>;
  setAncillaryFiles: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  ancillaryTotalBytes: number;
  ancillaryOverLimit: boolean;

  // ---- Validation / submission --------------------------------------------
  errors: Record<string, string>;
  setErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  isSubmitting: boolean;
  submitStatus: "idle" | "success" | "error";
  validateForm: () => boolean;
  handleSubmit: () => Promise<void>;

  // ---- Dirty / discard plumbing ------------------------------------------
  isDirty: boolean;
  saved: boolean;
  showDiscardConfirm: boolean;
  guardedClose: () => void;
  confirmDiscard: () => void;
  cancelDiscard: () => void;

  /** Force re-seed all state from a (possibly different) `existingConfig`. */
  resetForConfig: (next?: AgentSkill) => void;

  // ---- Internal sync ref (exposed only for the tools↔frontmatter effect) -
  toolSyncRef: React.MutableRefObject<boolean>;
}

const DEFAULT_FORM = {
  name: "",
  description: "",
  category: "Custom",
  difficulty: "beginner" as WorkflowDifficulty,
  thumbnail: "Zap",
};

function initialAllowedTools(existing?: AgentSkill): string[] {
  const md = resolvePersistedSkillMarkdownForEditor(existing);
  const parsed = parseSkillMd(md);
  if (parsed.allowedTools.length > 0) return parsed.allowedTools;
  return existing?.metadata?.allowed_tools || [];
}

export function useSkillForm({
  existingConfig,
  onSuccess,
  onClose,
}: UseSkillFormOptions = {}): UseSkillFormResult {
  const isEditMode = !!existingConfig;
  const { createSkill, updateSkill } = useAgentSkillsStore();
  const { toast } = useToast();

  // ---- Form data --------------------------------------------------------
  const [formData, setFormData] = useState<UseSkillFormResult["formData"]>({
    name: existingConfig?.name || DEFAULT_FORM.name,
    description: existingConfig?.description || DEFAULT_FORM.description,
    category: existingConfig?.category || DEFAULT_FORM.category,
    difficulty:
      (existingConfig?.difficulty as WorkflowDifficulty) || DEFAULT_FORM.difficulty,
    thumbnail: existingConfig?.thumbnail || DEFAULT_FORM.thumbnail,
  });
  const [tags, setTags] = useState<string[]>(
    existingConfig?.metadata?.tags || [],
  );
  const [visibility, setVisibility] = useState<SkillVisibility>(
    existingConfig?.visibility || "private",
  );
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>(
    existingConfig?.shared_with_teams || [],
  );
  const [inputVariables, setInputVariables] = useState<SkillInputVariable[]>(
    existingConfig?.metadata?.input_variables || [],
  );
  const [skillContent, setSkillContent] = useState<string>(() =>
    resolvePersistedSkillMarkdownForEditor(existingConfig),
  );
  const [ancillaryFiles, setAncillaryFiles] = useState<
    Record<string, string>
  >(existingConfig?.ancillary_files || {});
  const [allowedTools, setAllowedTools] = useState<string[]>(() =>
    initialAllowedTools(existingConfig),
  );

  const ancillaryTotalBytes = useMemo(
    () =>
      Object.values(ancillaryFiles).reduce(
        (sum, v) => sum + new Blob([v]).size,
        0,
      ),
    [ancillaryFiles],
  );
  const ancillaryOverLimit = ancillaryTotalBytes > 5 * 1024 * 1024;

  // Tools sync ref — flipped on by `setSkillContentAndSyncTools` to suppress
  // the next tools→frontmatter effect run (otherwise we'd write the same
  // tools we just parsed back into frontmatter, churning the editor).
  const toolSyncRef = useRef(false);

  const setSkillContentAndSyncTools = useCallback((next: string) => {
    setSkillContent(next);
    const parsed = parseSkillMd(next);
    toolSyncRef.current = true;
    setAllowedTools(parsed.allowedTools);
  }, []);

  // ---- Dirty tracking ---------------------------------------------------
  const initialSnapshotRef = useRef({
    name: existingConfig?.name || DEFAULT_FORM.name,
    description: existingConfig?.description || DEFAULT_FORM.description,
    category: existingConfig?.category || DEFAULT_FORM.category,
    difficulty:
      (existingConfig?.difficulty as WorkflowDifficulty) ||
      DEFAULT_FORM.difficulty,
    thumbnail: existingConfig?.thumbnail || DEFAULT_FORM.thumbnail,
    tags: existingConfig?.metadata?.tags || [],
    skillContent: resolvePersistedSkillMarkdownForEditor(existingConfig),
    visibility: existingConfig?.visibility || "private",
    selectedTeamIds: existingConfig?.shared_with_teams || [],
    allowedTools: initialAllowedTools(existingConfig),
    inputVariables: existingConfig?.metadata?.input_variables || [],
  });
  const [saved, setSaved] = useState(false);

  const isDirty = useMemo(() => {
    if (saved) return false;
    const s = initialSnapshotRef.current;
    return (
      formData.name !== s.name ||
      formData.description !== s.description ||
      formData.category !== s.category ||
      formData.difficulty !== s.difficulty ||
      formData.thumbnail !== s.thumbnail ||
      skillContent !== s.skillContent ||
      visibility !== s.visibility ||
      JSON.stringify(tags) !== JSON.stringify(s.tags) ||
      JSON.stringify(selectedTeamIds) !== JSON.stringify(s.selectedTeamIds) ||
      JSON.stringify(allowedTools) !== JSON.stringify(s.allowedTools) ||
      JSON.stringify(inputVariables) !== JSON.stringify(s.inputVariables)
    );
  }, [
    formData,
    skillContent,
    visibility,
    tags,
    selectedTeamIds,
    allowedTools,
    inputVariables,
    saved,
  ]);

  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const guardedClose = useCallback(() => {
    if (isDirty) {
      setShowDiscardConfirm(true);
      return;
    }
    onClose?.();
  }, [isDirty, onClose]);

  const confirmDiscard = useCallback(() => {
    setShowDiscardConfirm(false);
    onClose?.();
  }, [onClose]);

  const cancelDiscard = useCallback(() => {
    setShowDiscardConfirm(false);
  }, []);

  // ---- Validation -------------------------------------------------------
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateForm = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.name.trim()) newErrors.name = "Skill name is required";
    if (!formData.category) newErrors.category = "Category is required";
    if (!skillContent.trim())
      newErrors.skillContent = "Skill content is required";
    if (visibility === "team" && selectedTeamIds.length === 0) {
      newErrors.teams = "Select at least one team to share with";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData.name, formData.category, skillContent, visibility, selectedTeamIds]);

  // ---- Submit -----------------------------------------------------------
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "success" | "error">(
    "idle",
  );

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!validateForm()) return;

    setIsSubmitting(true);
    setSubmitStatus("idle");

    try {
      const parsed = parseSkillMd(skillContent);
      const configData: CreateAgentSkillInput = {
        name: formData.name.trim(),
        description:
          formData.description.trim() || parsed.description || undefined,
        category: formData.category,
        tasks: [
          {
            display_text: formData.name.trim(),
            llm_prompt: parsed.body || skillContent,
            subagent: "user_input",
          },
        ],
        is_quick_start: true,
        difficulty: formData.difficulty,
        thumbnail: formData.thumbnail,
        skill_content: skillContent,
        metadata: {
          tags: tags.length > 0 ? tags : undefined,
          allowed_tools: allowedTools.length > 0 ? allowedTools : undefined,
          input_variables:
            inputVariables.length > 0 ? inputVariables : undefined,
        },
        visibility,
        shared_with_teams: visibility === "team" ? selectedTeamIds : undefined,
        ancillary_files:
          Object.keys(ancillaryFiles).length > 0 ? ancillaryFiles : undefined,
      };

      let savedId: string;
      let created = false;
      if (isEditMode && existingConfig) {
        await updateSkill(existingConfig.id, configData);
        savedId = existingConfig.id;
      } else {
        savedId = await createSkill(configData);
        created = true;
      }

      setSubmitStatus("success");
      setSaved(true);
      toast(isEditMode ? "Skill updated!" : "Skill created!", "success");

      if (onSuccess) {
        // Defer slightly so the toast is visible before unmount/nav.
        setTimeout(() => onSuccess({ id: savedId, created }), 1200);
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to save skill";
      console.error("Error saving skill:", error);
      setSubmitStatus("error");
      toast(`Error: ${message}`, "error", 5000);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    validateForm,
    skillContent,
    formData,
    tags,
    allowedTools,
    inputVariables,
    visibility,
    selectedTeamIds,
    ancillaryFiles,
    isEditMode,
    existingConfig,
    updateSkill,
    createSkill,
    toast,
    onSuccess,
  ]);

  // ---- Reset when `existingConfig` reference changes -------------------
  // The legacy Builder ran an "open + existingConfig changed → re-seed
  // every state slice + rebuild snapshot" effect. We co-locate it with the
  // hook so the new Workspace gets the same behaviour for free.
  const resetForConfig = useCallback((next?: AgentSkill) => {
    const md = resolvePersistedSkillMarkdownForEditor(next);
    const allowed = initialAllowedTools(next);
    const tagsNext = next?.metadata?.tags || [];
    const teamsNext = next?.shared_with_teams || [];
    const visNext: SkillVisibility = next?.visibility || "private";
    const varsNext = next?.metadata?.input_variables || [];
    const ancNext = next?.ancillary_files || {};

    setFormData({
      name: next?.name || DEFAULT_FORM.name,
      description: next?.description || DEFAULT_FORM.description,
      category: next?.category || DEFAULT_FORM.category,
      difficulty:
        (next?.difficulty as WorkflowDifficulty) || DEFAULT_FORM.difficulty,
      thumbnail: next?.thumbnail || DEFAULT_FORM.thumbnail,
    });
    setTags(tagsNext);
    setInputVariables(varsNext);
    setSkillContent(md);
    setVisibility(visNext);
    setSelectedTeamIds(teamsNext);
    setAllowedTools(allowed);
    setAncillaryFiles(ancNext);
    setErrors({});
    setSubmitStatus("idle");
    setIsSubmitting(false);
    setShowDiscardConfirm(false);
    setSaved(false);
    initialSnapshotRef.current = {
      name: next?.name || DEFAULT_FORM.name,
      description: next?.description || DEFAULT_FORM.description,
      category: next?.category || DEFAULT_FORM.category,
      difficulty:
        (next?.difficulty as WorkflowDifficulty) || DEFAULT_FORM.difficulty,
      thumbnail: next?.thumbnail || DEFAULT_FORM.thumbnail,
      tags: tagsNext,
      skillContent: md,
      visibility: visNext,
      selectedTeamIds: teamsNext,
      allowedTools: allowed,
      inputVariables: varsNext,
    };
  }, []);

  // Re-seed when caller switches to a different skill (by id) or toggles
  // between create-mode (undefined) and edit-mode. We deliberately compare
  // by `id` rather than by object reference so callers that re-create the
  // `existingConfig` POJO on every render (a common pattern) don't trigger
  // a render loop.
  const lastConfigIdRef = useRef<string | undefined>(existingConfig?.id);
  useEffect(() => {
    const nextId = existingConfig?.id;
    if (lastConfigIdRef.current !== nextId) {
      lastConfigIdRef.current = nextId;
      resetForConfig(existingConfig);
    }
  }, [existingConfig, resetForConfig]);

  // Helper for the Builder's tools↔frontmatter sync effect — see Builder use site.
  // Exporting `updateAllowedToolsInFrontmatter` consumers can wire it directly.
  void updateAllowedToolsInFrontmatter;

  return {
    isEditMode,
    formData,
    setFormData,
    tags,
    setTags,
    visibility,
    setVisibility,
    selectedTeamIds,
    setSelectedTeamIds,
    inputVariables,
    setInputVariables,
    allowedTools,
    setAllowedTools,
    skillContent,
    setSkillContent,
    setSkillContentAndSyncTools,
    ancillaryFiles,
    setAncillaryFiles,
    ancillaryTotalBytes,
    ancillaryOverLimit,
    errors,
    setErrors,
    isSubmitting,
    submitStatus,
    validateForm,
    handleSubmit,
    isDirty,
    saved,
    showDiscardConfirm,
    guardedClose,
    confirmDiscard,
    cancelDiscard,
    resetForConfig,
    toolSyncRef,
  };
}
