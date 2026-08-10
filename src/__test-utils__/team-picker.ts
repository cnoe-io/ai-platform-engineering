// assisted-by Cursor Claude:claude-opus-4-7
//
// Small testing helper that drives the searchable TeamPicker /
// TeamMultiPicker (see `@/components/ui/team-picker`) the way the
// old native `<select>` was driven via `fireEvent.change(select, {
// target: { value } })`. The component switch on 2026-05-27 turned
// every "Preselected Team" / "Owner Team" / "Team for #channel" /
// "Share with Teams" interaction into "click trigger → click option
// in the popover", so test suites previously written against the
// native `combobox` role need a tiny adapter to stay terse.
//
// Usage:
//
//   import { pickTeam, pickTeamByName } from "@/__test-utils__/team-picker";
//
//   // single picker: open the popover, click the option whose
//   // visible row contains `team:platform`.
//   pickTeam(screen, /Preselected Team/i, "platform");
//
//   // multi picker: same affordance but toggles instead of replaces.
//   pickTeam(screen, /Share with Teams/i, "sre");
//
//   // when you want to match on the rendered team name instead of
//   // the slug code (e.g. when `hideSlugSuffix` is set):
//   pickTeamByName(screen, /Add team/i, "Platform Engineering");

import { act,screen as defaultScreen,fireEvent,waitFor,within } from "@testing-library/react";

type ScreenLike = Pick<typeof defaultScreen, "getByLabelText" | "getByRole" | "getAllByRole" | "findByRole">;

/**
 * Open the picker whose trigger is labelled by `triggerLabel`, then
 * click the option whose rendered row contains `team:<slug>` (the
 * default `code` suffix the picker shows).
 *
 * Falls back to the global `screen` when the caller hasn't passed
 * one — matches the ergonomics of `screen.getByLabelText`.
 *
 * Async because the popover content is portaled and mounts via a
 * `useEffect` + `useLayoutEffect` pair (see
 * `@/components/ui/popover.tsx`), so the listbox isn't in the DOM
 * synchronously after the click. The previous synchronous version
 * worked for most callers but flaked on suites with extra
 * fetch/effect churn between render and the first interaction.
 */
export async function pickTeam(
  screenOrLabel: ScreenLike | string | RegExp,
  triggerLabelOrSlug?: string | RegExp,
  maybeSlug?: string,
): Promise<void> {
  let screenObj: ScreenLike = defaultScreen;
  let triggerLabel: string | RegExp;
  let slug: string;
  if (typeof screenOrLabel === "object" && "getByLabelText" in screenOrLabel) {
    screenObj = screenOrLabel;
    triggerLabel = triggerLabelOrSlug as string | RegExp;
    slug = maybeSlug as string;
  } else {
    triggerLabel = screenOrLabel as string | RegExp;
    slug = triggerLabelOrSlug as string;
  }
  // Wait for the picker to settle into an enabled state. The picker
  // is rendered as `<button disabled>` while its `options` array is
  // still empty (a common state immediately after `render(...)`
  // while the teams fetch is in flight). Clicking a disabled button
  // is a no-op and the popover never opens — that's the failure
  // mode the previous version of this helper exhibited in the
  // Webex/Slack suites. Re-query inside `waitFor` so we re-evaluate
  // both the presence and the `disabled` attribute.
  const trigger = await waitForEnabledTrigger(screenObj, triggerLabel);
  await act(async () => {
    fireEvent.click(trigger);
  });
  const listbox = await screenObj.findByRole("listbox");
  // Picker rows render `team:<slug>` as a sibling `<code>` element
  // inside the option `<button>`. Matching by that code is the
  // closest equivalent to the old `<option value="<slug>">` lookup.
  const targetCode = within(listbox).getByText(`team:${slug}`);
  const option = targetCode.closest("[role='option']");
  if (!option) {
    throw new Error(
      `pickTeam: could not find an option row whose code is "team:${slug}". ` +
      `Make sure the trigger labelled "${String(triggerLabel)}" is a TeamPicker and ` +
      `that an option for slug "${slug}" is in the rendered list.`,
    );
  }
  await act(async () => {
    fireEvent.click(option);
  });
}

async function waitForEnabledTrigger(
  screenObj: ScreenLike,
  triggerLabel: string | RegExp,
): Promise<HTMLElement> {
  let trigger: HTMLElement | null = null;
  await waitFor(() => {
    const node = screenObj.getByLabelText(triggerLabel);
    if ((node as HTMLButtonElement).disabled) {
      throw new Error(
        `Trigger labelled "${String(triggerLabel)}" is still disabled — waiting for the options list to populate.`,
      );
    }
    trigger = node;
  });
  // `trigger` is set inside the waitFor block; the only way to reach
  // this line is for the inner callback to have succeeded.
  if (!trigger) {
    throw new Error(
      `pickTeam: failed to resolve an enabled trigger for "${String(triggerLabel)}".`,
    );
  }
  return trigger;
}

/**
 * Open the picker whose trigger is labelled by `triggerLabel`, then
 * click the option whose rendered label matches `name`. Use this for
 * callers that render with `hideSlugSuffix` (KB / RAG team-access
 * panels) where the `team:<slug>` code isn't shown.
 */
export async function pickTeamByName(
  screenOrLabel: ScreenLike | string | RegExp,
  triggerLabelOrName?: string | RegExp,
  maybeName?: string | RegExp,
): Promise<void> {
  let screenObj: ScreenLike = defaultScreen;
  let triggerLabel: string | RegExp;
  let name: string | RegExp;
  if (typeof screenOrLabel === "object" && "getByLabelText" in screenOrLabel) {
    screenObj = screenOrLabel;
    triggerLabel = triggerLabelOrName as string | RegExp;
    name = maybeName as string | RegExp;
  } else {
    triggerLabel = screenOrLabel as string | RegExp;
    name = triggerLabelOrName as string | RegExp;
  }
  const trigger = await waitForEnabledTrigger(screenObj, triggerLabel);
  await act(async () => {
    fireEvent.click(trigger);
  });
  const listbox = await screenObj.findByRole("listbox");
  const option = within(listbox).getByRole("option", { name });
  await act(async () => {
    fireEvent.click(option);
  });
}

/**
 * Read the currently-selected single-team picker by its trigger
 * label. Returns the rendered team name, or an empty string when
 * nothing is selected (the trigger shows its placeholder text).
 *
 * Asymmetric with `pickTeam` because the picker is a `<button>`,
 * not a form control — `.toHaveValue(...)` does not apply.
 */
export function getSelectedTeamName(
  screenOrLabel: ScreenLike | string | RegExp,
  maybeTriggerLabel?: string | RegExp,
): string {
  const screenObj: ScreenLike =
    typeof screenOrLabel === "object" && "getByLabelText" in screenOrLabel
      ? screenOrLabel
      : defaultScreen;
  const triggerLabel =
    typeof screenOrLabel === "object" && "getByLabelText" in screenOrLabel
      ? (maybeTriggerLabel as string | RegExp)
      : (screenOrLabel as string | RegExp);
  const trigger = screenObj.getByLabelText(triggerLabel);
  return (trigger.textContent || "").trim();
}
