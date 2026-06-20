// Copyright CNOE Contributors (https://cnoe.io)
// SPDX-License-Identifier: Apache-2.0

/**
 * Tests for the spec #099 additions to TaskList:
 *  - Per-task pre-flight ack badge that maps Acknowledgement.ack_status
 *    to a colour-coded label + icon (FR-003).
 *  - "Thread" deep-link button that opens /chat/<chat_conversation_id>
 *    when the backend exposes one (FR-006 / Story 2).
 *  - Next-run row carries both an absolute timestamp AND a relative
 *    hint (FR-010 / FR-012).
 *
 * Existing rendering behaviour (id badge, disabled state, action
 * buttons) is intentionally NOT re-tested here — those are covered
 * by the higher-level page tests and by manual QA. We focus on the
 * deltas this PR introduces.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';

import { TaskList } from '../TaskList';
import type { AutonomousTask } from '../types';

jest.mock('next/link', () => {
  // eslint-disable-next-line react/display-name
  return ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  );
});

jest.mock('lucide-react', () => {
  const stub = (name: string) => (props: any) =>
    <span data-testid={`icon-${name}`} {...props} />;
  return {
    Pencil: stub('pencil'),
    Play: stub('play'),
    Trash2: stub('trash'),
    Webhook: stub('webhook'),
    Clock: stub('clock'),
    Repeat: stub('repeat'),
    CheckCircle2: stub('check'),
    AlertTriangle: stub('warn'),
    XCircle: stub('x'),
    Loader2: stub('loader'),
    MessageSquare: stub('chat'),
  };
});

function makeTask(overrides: Partial<AutonomousTask> = {}): AutonomousTask {
  return {
    id: 't1',
    name: 'Daily PR sweep',
    agent: 'github',
    prompt: 'list open PRs older than 7 days',
    trigger: { type: 'cron', schedule: '0 9 * * *' },
    enabled: true,
    chat_conversation_id: 'a25e9fc5-8be0-528f-98d8-e2fd6f73dcc8',
    ...overrides,
  };
}

const noopHandlers = {
  selectedTaskId: null,
  onSelect: jest.fn(),
  onEdit: jest.fn(),
  onDelete: jest.fn(),
  onTrigger: jest.fn(),
  busyIds: new Set<string>(),
};

describe('TaskList — pre-flight ack badge (spec #099 FR-003)', () => {
  it('renders an "Ack OK" badge when last_ack.ack_status === "ok"', () => {
    render(
      <TaskList
        tasks={[makeTask({ last_ack: { ack_status: 'ok', ack_detail: 'ready' } })]}
        {...noopHandlers}
      />,
    );
    expect(screen.getByTestId('autonomous-ack-ok')).toHaveTextContent('Ack OK');
  });

  it('renders an "Ack failed" badge with red treatment for failed acks', () => {
    render(
      <TaskList
        tasks={[
          makeTask({
            last_ack: {
              ack_status: 'failed',
              ack_detail: "agent 'foo' is not enabled",
            },
          }),
        ]}
        {...noopHandlers}
      />,
    );
    const badge = screen.getByTestId('autonomous-ack-failed');
    expect(badge).toHaveTextContent('Ack failed');
    // Tooltip body must include the supervisor's detail line so operators
    // see the actual cause without opening the chat thread.
    expect(badge).toHaveAttribute('title', expect.stringContaining("not enabled"));
  });

  it('renders an "Ack pending" badge with spinner when last_ack is null/undefined', () => {
    render(
      <TaskList tasks={[makeTask({ last_ack: null })]} {...noopHandlers} />,
    );
    expect(screen.getByTestId('autonomous-ack-absent')).toHaveTextContent('Ack pending');
  });

  it('renders an "Ack warn" badge for warn status', () => {
    render(
      <TaskList
        tasks={[
          makeTask({
            last_ack: {
              ack_status: 'warn',
              ack_detail: 'Supervisor still loading sub-agents',
            },
          }),
        ]}
        {...noopHandlers}
      />,
    );
    expect(screen.getByTestId('autonomous-ack-warn')).toHaveTextContent('Ack warn');
  });
});

describe('TaskList — chat thread deep-link (spec #099 Story 2)', () => {
  it('renders a "Thread" link to /chat/<chat_conversation_id> when the id is set', () => {
    render(
      <TaskList
        tasks={[makeTask({ chat_conversation_id: 'a25e9fc5-8be0-528f-98d8-e2fd6f73dcc8' })]}
        {...noopHandlers}
      />,
    );
    const link = screen.getByTestId('autonomous-thread-link');
    expect(link).toHaveAttribute('href', '/chat/a25e9fc5-8be0-528f-98d8-e2fd6f73dcc8');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('omits the Thread link entirely when chat_conversation_id is missing', () => {
    render(
      <TaskList
        tasks={[makeTask({ chat_conversation_id: null })]}
        {...noopHandlers}
      />,
    );
    expect(screen.queryByTestId('autonomous-thread-link')).toBeNull();
  });

  it('renders the Thread link and the action toolbar for every authenticated user (no readOnly gate)', () => {
    // Plan section 4.3 dropped the `readOnly` prop entirely. Every user
    // only ever sees rows they own (backend-filtered), so per-task
    // actions are always rendered. The backend still 403s if the
    // server-side ownership check disagrees; client-side gating is
    // unnecessary now and was hostile UX for non-admin owners.
    render(
      <TaskList
        tasks={[makeTask({ chat_conversation_id: 'a25e9fc5-8be0-528f-98d8-e2fd6f73dcc8' })]}
        {...noopHandlers}
      />,
    );
    expect(screen.getByTestId('autonomous-thread-link')).toBeInTheDocument();
    expect(screen.getByTestId('autonomous-task-actions')).toBeInTheDocument();
  });
});

describe('TaskList — showOwner column (plan section 4.3)', () => {
  it('renders the owner email when showOwner is true', () => {
    render(
      <TaskList
        tasks={[makeTask({ owner_id: 'alice@example.com' })]}
        {...noopHandlers}
        showOwner
      />,
    );
    expect(screen.getByTestId('autonomous-task-owner')).toHaveTextContent(
      'alice@example.com',
    );
  });

  it('hides the owner email when showOwner is false (non-admin view)', () => {
    render(
      <TaskList
        tasks={[makeTask({ owner_id: 'alice@example.com' })]}
        {...noopHandlers}
      />,
    );
    expect(screen.queryByTestId('autonomous-task-owner')).toBeNull();
  });

  it('sorts the current user\'s tasks first when showOwner is true', () => {
    const tasks = [
      makeTask({ id: 'other-1', owner_id: 'carol@example.com', name: 'Carols 1' }),
      makeTask({ id: 'mine-1', owner_id: 'admin@example.com', name: 'Mine 1' }),
      makeTask({ id: 'other-2', owner_id: 'bob@example.com', name: 'Bobs 1' }),
      makeTask({ id: 'mine-2', owner_id: 'admin@example.com', name: 'Mine 2' }),
    ];

    render(
      <TaskList
        tasks={tasks}
        {...noopHandlers}
        showOwner
        currentUserEmail="admin@example.com"
      />,
    );

    const rows = screen.getAllByRole('listitem');
    // First two rows must belong to the current user.
    expect(within(rows[0]).getByTestId('autonomous-task-owner')).toHaveTextContent(
      'admin@example.com',
    );
    expect(within(rows[1]).getByTestId('autonomous-task-owner')).toHaveTextContent(
      'admin@example.com',
    );
  });

  it('uses a single create-prompt empty state regardless of showOwner', () => {
    const { rerender } = render(
      <TaskList tasks={[]} {...noopHandlers} />,
    );
    expect(
      screen.getByText(/No autonomous tasks yet\. Click "New task" to create one\./i),
    ).toBeInTheDocument();

    rerender(<TaskList tasks={[]} {...noopHandlers} showOwner />);
    expect(
      screen.getByText(/No autonomous tasks yet\. Click "New task" to create one\./i),
    ).toBeInTheDocument();
  });
});

describe('TaskList — next-run formatting (spec #099 FR-010 / FR-012)', () => {
  it('renders absolute next_run with a relative hint in parentheses', () => {
    // 4 hours in the future
    const future = new Date(Date.now() + 4 * 3600 * 1000).toISOString();
    render(
      <TaskList
        tasks={[makeTask({ next_run: future })]}
        {...noopHandlers}
      />,
    );
    // Find the "next:" row
    const row = screen.getByText(/next:/i).closest('span');
    expect(row).not.toBeNull();
    // Relative hint should be visible (in 4h, in 3h, 4h ago drift, etc.)
    const rowText = within(row as HTMLElement).getByText(/\(in \d+[smhd]\)/);
    expect(rowText).toBeInTheDocument();
  });

  it('renders an em-dash and no relative hint when next_run is null', () => {
    render(
      <TaskList
        tasks={[makeTask({ next_run: null })]}
        {...noopHandlers}
      />,
    );
    const row = screen.getByText(/next:/i).closest('span');
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent('next: —');
    expect(within(row as HTMLElement).queryByText(/\(in /)).toBeNull();
  });
});
