/**
 * @jest-environment jsdom
 */
/**
 * UI tests for the admin scan-override flow inside the
 * ``SkillScanStatusIndicator`` dialog.
 *
 * The component is the only UI surface from which an admin can
 * override the scanner verdict on a flagged skill, and the only
 * surface that renders the audit metadata (``scan_override``) on a
 * skill that's currently overridden. So this suite pins:
 *
 *   - admin role gate (Override / Remove buttons hidden for
 *     non-admins),
 *   - source gate (override path is agent_skills only — buttons
 *     hidden for hub / built-in catalog rows),
 *   - happy-path round-trip: open dialog → click Override → fill
 *     reason → submit → display flips to "Admin override active",
 *     audit panel renders. Note: the server keeps ``scan_status`` at
 *     ``"flagged"`` and writes the override into a separate
 *     ``scan_override`` sub-doc; the UI computes the
 *     ``"admin_overridden"`` display state via ``resolveStatus``.
 *   - clear path: click Remove override → display flips back to
 *     flagged, audit panel disappears.
 *
 * The API-side assertions live in
 * ``app/api/__tests__/admin-scan-override.test.ts``; these tests
 * stub fetch and only exercise UI state.
 *
 * assisted-by Cursor Composer-Sonnet-4.7
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ----------------------------------------------------------------------------
// Mocks (must be hoisted via jest.mock; admin role + toast are read on render)
// ----------------------------------------------------------------------------

let mockIsAdmin = false;
jest.mock("@/hooks/use-admin-role", () => ({
  useAdminRole: () => ({ isAdmin: mockIsAdmin }),
}));

const mockToast = jest.fn();
jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// Tooltip + Dialog primitives ship with a Portal that breaks RTL's
// container queries unless we render in-place. The same shim is used
// in SkillsGallery.test.tsx — keeping the convention here.
jest.mock("@/components/ui/dialog", () => {
  const Real = jest.requireActual("@/components/ui/dialog");
  return {
    ...Real,
    DialogContent: ({
      children,
      ...rest
    }: React.PropsWithChildren<Record<string, unknown>>) => (
      <div data-testid="dialog-content" {...rest}>
        {children}
      </div>
    ),
  };
});

import { SkillScanStatusIndicator } from "../SkillScanStatusIndicator";

// ----------------------------------------------------------------------------
// Setup
// ----------------------------------------------------------------------------

const realFetch = global.fetch;
let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as typeof global.fetch;
  mockIsAdmin = false;
  mockToast.mockClear();
});

afterAll(() => {
  global.fetch = realFetch;
});

const FLAGGED_CONFIG = {
  id: "skill-123",
  name: "Risky Skill",
  scan_status: "flagged" as const,
  scan_summary: "Detected shell exec",
  scan_updated_at: "2026-05-01T00:00:00Z",
  metadata: {},
};

// Post-pivot persisted shape: scan_status stays at the scanner's
// verdict ("flagged"); the override lives in a separate sub-doc.
// The UI's resolveStatus() helper synthesises the "admin_overridden"
// display state from the combination.
const OVERRIDDEN_CONFIG = {
  ...FLAGGED_CONFIG,
  scan_status: "flagged" as const,
  scan_override: {
    set_by: "alice@example.com",
    set_at: "2026-05-02T15:30:00Z",
    reason: "Reviewed shell-out, all paths use allow-list.",
    prior_scan_status: "flagged" as const,
    prior_scan_summary: "Detected shell exec",
  },
};

function openDialog() {
  // Click the shield trigger button to open the report.
  fireEvent.click(screen.getByRole("button", { name: /Click for scan details/i }));
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("SkillScanStatusIndicator — admin override (non-admin)", () => {
  it("hides Override flag button when user is not admin", () => {
    mockIsAdmin = false;
    render(<SkillScanStatusIndicator config={FLAGGED_CONFIG} />);
    openDialog();
    // Scan now button is still there (manual scan is for everyone),
    // but Override flag is admin-only and must not be present.
    expect(
      screen.queryByRole("button", { name: /Override flag/i }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: /Scan now/i })).toBeTruthy();
  });

  it("renders override audit panel even for non-admin viewers", () => {
    // Non-admins still get to see "this skill is admin-bypass" with
    // the reason — that's the whole point of the audit metadata
    // being public-readable. Only the mutation buttons are gated.
    mockIsAdmin = false;
    render(<SkillScanStatusIndicator config={OVERRIDDEN_CONFIG} />);
    openDialog();
    // The string "Admin override active" appears in 2-3 places (status
    // pill copy + panel header + aria-label) so we use getAllByText.
    // The audit metadata fields are unique inside the dialog body.
    expect(screen.getAllByText(/Admin override active/i).length).toBeGreaterThan(0);
    expect(screen.getByText("alice@example.com")).toBeTruthy();
    expect(
      screen.getByText("Reviewed shell-out, all paths use allow-list."),
    ).toBeTruthy();
    // Remove override button is admin-only.
    expect(
      screen.queryByRole("button", { name: /Remove override/i }),
    ).toBeNull();
  });
});

describe("SkillScanStatusIndicator — admin override (admin)", () => {
  beforeEach(() => {
    mockIsAdmin = true;
  });

  it("shows Override flag button on a flagged skill for admins", () => {
    render(<SkillScanStatusIndicator config={FLAGGED_CONFIG} />);
    openDialog();
    expect(
      screen.getByRole("button", { name: /Override flag/i }),
    ).toBeTruthy();
  });

  it("shows Override flag button for hub-sourced skills and targets the hub route", async () => {
    // v1.5: hub-projected catalog rows now go to the dedicated
    // ``/api/admin/skills/hub/<hubId>/<skillId>/scan-override`` route
    // (the agent_skills route only knows the single-id shape).
    // The catalog projection puts the composite identity in
    // metadata.hub_id / metadata.hub_skill_id, so the resolver
    // prefers those over re-parsing the legacy
    // ``catalog-hub-<hubId>-<skillId>`` id format.
    // Server response shape under the new design: scan_status stays
    // "flagged" (the scanner verdict), scan_override carries the
    // override metadata. The UI flips to the "admin_overridden"
    // display state via resolveStatus().
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          id: "hub-h1-skill-x",
          hub_id: "h1",
          skill_id: "skill-x",
          scan_status: "flagged",
          scan_override: {
            set_by: "admin@example.com",
            set_at: "2026-05-05T10:00:00Z",
            reason: "Hub override.",
            prior_scan_status: "flagged",
          },
          scan_updated_at: "2026-05-05T10:00:00Z",
        },
      }),
    });

    render(
      <SkillScanStatusIndicator
        config={{
          ...FLAGGED_CONFIG,
          id: "catalog-hub-h1-skill-x",
          metadata: {
            catalog_source: "hub",
            hub_id: "h1",
            hub_skill_id: "skill-x",
          },
        }}
      />,
    );
    openDialog();
    expect(
      screen.getByRole("button", { name: /Override flag/i }),
    ).toBeTruthy();

    // Drive a quick happy-path POST so we can pin the URL the
    // resolver builds. Without this assertion an accidental
    // refactor that left the button visible but pointed it at the
    // wrong endpoint would silently regress production.
    fireEvent.click(
      screen.getByRole("button", { name: /Override flag/i }),
    );
    fireEvent.change(screen.getByLabelText(/Override reason/i), {
      target: { value: "Hub override." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Confirm override/i }),
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/skills/hub/h1/skill-x/scan-override",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("falls back to parsing the catalog-hub id when metadata is missing", async () => {
    // Older catalog payloads (rendered before docToCatalogSkill
    // started projecting hub_id / hub_skill_id) still need to work
    // without a hard reload — pin the legacy regex fallback so a
    // future cleanup doesn't accidentally drop it while assuming
    // every hub row carries the new metadata fields.
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          id: "hub-h2-legacy-skill",
          hub_id: "h2",
          skill_id: "legacy-skill",
          // Same post-pivot shape: scan_status stays "flagged",
          // override sub-doc is the gate signal.
          scan_status: "flagged",
          scan_override: {
            set_by: "admin@example.com",
            set_at: "2026-05-05T10:00:00Z",
            reason: "Legacy override path.",
            prior_scan_status: "flagged",
          },
          scan_updated_at: "2026-05-05T10:00:00Z",
        },
      }),
    });

    render(
      <SkillScanStatusIndicator
        config={{
          ...FLAGGED_CONFIG,
          id: "catalog-hub-h2-legacy-skill",
          // No hub_id / hub_skill_id — exercise the fallback regex.
          metadata: { catalog_source: "hub" },
        }}
      />,
    );
    openDialog();
    expect(
      screen.getByRole("button", { name: /Override flag/i }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: /Override flag/i }),
    );
    fireEvent.change(screen.getByLabelText(/Override reason/i), {
      target: { value: "Legacy override path." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Confirm override/i }),
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/skills/hub/h2/legacy-skill/scan-override",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("hides Override flag button for built-in template skills", () => {
    render(
      <SkillScanStatusIndicator
        config={{
          ...FLAGGED_CONFIG,
          id: "catalog-builtin-foo",
          metadata: { catalog_source: "default" },
        }}
      />,
    );
    openDialog();
    expect(
      screen.queryByRole("button", { name: /Override flag/i }),
    ).toBeNull();
  });

  it("submits an override with a typed reason and updates the dialog", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          id: "skill-123",
          // Server keeps scan_status at the scanner verdict; the
          // override sub-doc carries the audit metadata.
          scan_status: "flagged",
          scan_override: {
            set_by: "admin@example.com",
            set_at: "2026-05-03T10:00:00Z",
            reason: "Looks fine.",
            prior_scan_status: "flagged",
            prior_scan_summary: "Detected shell exec",
          },
          scan_updated_at: "2026-05-03T10:00:00Z",
        },
      }),
    });

    render(<SkillScanStatusIndicator config={FLAGGED_CONFIG} />);
    openDialog();

    fireEvent.click(
      screen.getByRole("button", { name: /Override flag/i }),
    );
    // Form opens with a textarea + Confirm + Cancel.
    const reasonInput = screen.getByLabelText(/Override reason/i);
    fireEvent.change(reasonInput, { target: { value: "Looks fine." } });

    fireEvent.click(
      screen.getByRole("button", { name: /Confirm override/i }),
    );

    // Wait for the optimistic update — status copy flips, audit
    // panel renders with the new metadata. The headline string
    // appears in multiple places in the dialog (status pill +
    // panel header), so we wait for the unique reason text instead
    // of the headline.
    // Wait for the audit panel — uniquely identifiable by the
    // "Set by" definition-list label which only renders when
    // scan_override is present.
    await waitFor(() => {
      expect(screen.getByText("Set by")).toBeTruthy();
    });
    expect(
      screen.getByText((_, node) => node?.textContent === "admin@example.com"),
    ).toBeTruthy();
    // Verify the reason is rendered inside the audit panel (not
    // just the textarea — the form unmounts after a successful
    // submit, so by this point the only "Looks fine." should be in
    // the audit panel <dd>).
    expect(screen.getByText("Looks fine.")).toBeTruthy();

    // POST hit the v1 agent_skills route with a JSON body.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(
      "/api/admin/skills/agent_skills/skill-123/scan-override",
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      reason: "Looks fine.",
    });

    // Toast confirms.
    expect(mockToast).toHaveBeenCalledWith(
      "Override applied",
      "success",
    );
  });

  it("clears an existing override and shows flagged again", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          id: "skill-123",
          cleared: true,
          scan_status: "flagged",
          scan_updated_at: "2026-05-04T08:00:00Z",
        },
      }),
    });

    render(<SkillScanStatusIndicator config={OVERRIDDEN_CONFIG} />);
    openDialog();

    fireEvent.click(
      screen.getByRole("button", { name: /Remove override/i }),
    );

    await waitFor(() => {
      // Status copy reverts to "Security scan flagged" (it's no
      // longer overridden), and the audit panel is gone.
      expect(screen.getByText(/Security scan flagged/i)).toBeTruthy();
    });
    expect(screen.queryByText(/Admin override active/i)).toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(
      "/api/admin/skills/agent_skills/skill-123/scan-override",
    );
    expect(init.method).toBe("DELETE");
    expect(mockToast).toHaveBeenCalledWith("Override removed", "success");
  });

  it("disables Confirm override while reason is blank", () => {
    // Server enforces non-empty reason (400 if missing); UI mirrors
    // the constraint client-side so the user gets immediate
    // feedback rather than a 400 round-trip.
    render(<SkillScanStatusIndicator config={FLAGGED_CONFIG} />);
    openDialog();
    fireEvent.click(
      screen.getByRole("button", { name: /Override flag/i }),
    );
    const confirm = screen.getByRole("button", {
      name: /Confirm override/i,
    });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
  });

  it("Cancel restores the dialog to its pre-override state", () => {
    render(<SkillScanStatusIndicator config={FLAGGED_CONFIG} />);
    openDialog();
    fireEvent.click(
      screen.getByRole("button", { name: /Override flag/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));

    // The form is gone, the textarea is unmounted, and the trigger
    // button is back. Pinning so a future refactor doesn't replace
    // Cancel with a noop that traps the admin in the form.
    expect(screen.queryByLabelText(/Override reason/i)).toBeNull();
    expect(
      screen.getByRole("button", { name: /Override flag/i }),
    ).toBeTruthy();
  });
});
