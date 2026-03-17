---
description: Create or amend the project constitution
handoffs:
  - label: Create Feature Spec
    agent: speckit.specify
    prompt: Create a spec for...
  - label: Review Architecture
    agent: speckit.plan
    prompt: Review architecture alignment with constitution
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Outline

The constitution is the governing document for the project. It defines core principles, development workflow, and governance rules that all agents and engineers must follow. It lives at `.specify/CONSTITUTION.md` and is symlinked from `.specify/memory/constitution.md`.

### Step 1: Determine Mode

Check whether `.specify/CONSTITUTION.md` exists:

- **If it does NOT exist** → **Create mode** (go to Step 2)
- **If it exists** → **Amend mode** (go to Step 3)

If the user input is empty:

- In create mode: ask the user to describe the project's purpose, core values, and any non-negotiable constraints
- In amend mode: ask the user what they want to change and why

### Step 2: Create New Constitution

1. **Load the template** from `templates/constitution-template.md` to understand the required structure and sections.

2. **Gather project context**:
   - Read `README.md` (if it exists) for project purpose and scope
   - Read `.specify/ARCHITECTURE.md` (if it exists) for technical context
   - Use the user's input for principles and values

3. **Fill the template** by replacing all `[PLACEHOLDER]` tokens with concrete content derived from the project context and user input:
   - Replace `[PROJECT_NAME]` with the actual project name
   - Replace each `[PRINCIPLE_N_NAME]` and `[PRINCIPLE_N_DESCRIPTION]` with real principles
   - Add or remove principle sections as needed (the template shows 5 examples but the actual count depends on the project)
   - Replace `[SECTION_2_NAME]`, `[SECTION_3_NAME]` and their content with appropriate sections for the project
   - Fill `[GOVERNANCE_RULES]` with concrete governance rules
   - Set `[CONSTITUTION_VERSION]` to `0.0.1`, `[RATIFICATION_DATE]` and `[LAST_AMENDED_DATE]` to today's date

4. **Quality checks** before writing:
   - Every principle must be actionable (agents can verify compliance)
   - No placeholder text remains (`[PLACEHOLDER]` markers)
   - At least 3 core principles are defined
   - Governance section defines how amendments work
   - Version and dates are set

5. **Write the constitution** to `.specify/CONSTITUTION.md`.

6. **Ensure the symlink** exists at `.specify/memory/constitution.md` pointing to `../CONSTITUTION.md`:

   ```sh
   mkdir -p .specify/memory
   ln -sf ../CONSTITUTION.md .specify/memory/constitution.md
   ```

   Verify the symlink resolves correctly.

7. Go to Step 4.

### Step 3: Amend Existing Constitution

1. **Load the current constitution** from `.specify/CONSTITUTION.md`.

2. **Parse the user's amendment request** from the input. Identify:
   - Which section(s) the change affects
   - Whether this adds, modifies, or removes content
   - The rationale for the change

3. **Validate the amendment** against governance rules defined in the constitution itself:
   - If the constitution requires a specification for amendments, note this requirement to the user
   - If the amendment contradicts an existing principle, highlight the conflict and ask the user to confirm

4. **Apply the amendment**:
   - Modify only the affected sections
   - Preserve all unaffected content exactly as-is
   - Increment the version number (patch for clarifications, minor for new principles, major for fundamental changes)
   - Update `[LAST_AMENDED_DATE]` to today's date

5. **Present a summary** of changes to the user:

   ```text
   ## Constitution Amendment Summary

   **Version**: X.Y.Z → X.Y.Z+1
   **Sections changed**: [list]
   **Changes**:
   - [description of each change]
   **Rationale**: [from user input]
   ```

6. **Write the updated constitution** to `.specify/CONSTITUTION.md`.

7. Go to Step 4.

### Step 4: Report Completion

Report the result with:

- Mode used (create or amend)
- Constitution file path (`.specify/CONSTITUTION.md`)
- Symlink status (`.specify/memory/constitution.md` → valid/invalid)
- Version number
- Summary of principles defined
- Next steps: suggest `/speckit.specify` to create the first feature spec if this is a new constitution

## Key Rules

- The constitution is the highest-authority document in the project — it governs all other docs
- Never remove the Governance section; it defines how the constitution itself can change
- Keep principles concise and actionable; agents must be able to verify compliance
- Use numbered Roman numerals (I, II, III...) for principle headings to match convention
- The `.specify/memory/constitution.md` symlink must always point to `../CONSTITUTION.md`
