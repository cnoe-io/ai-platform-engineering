import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UnifiedAuditTab } from '../UnifiedAuditTab';

// assisted-by Codex Codex-sonnet-4-6

describe('UnifiedAuditTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        records: [],
        total: 0,
        page: 1,
        limit: 30,
      }),
    });
  });

  it('shows admin required message when not admin (fetch still runs before gate)', async () => {
    render(<UnifiedAuditTab isAdmin={false} />);
    expect(
      screen.getByText(/Admin access required to view audit events/i)
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  it('loads audit events when admin', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        records: [
          {
            id: '1',
            ts: new Date().toISOString(),
            type: 'auth',
            outcome: 'allow',
            action: 'admin_ui#view',
            tenant_id: 'default',
            subject_hash: 'h',
            correlation_id: 'c',
            source: 'bff',
          },
        ],
        total: 1,
        page: 1,
        limit: 30,
      }),
    });

    render(<UnifiedAuditTab isAdmin />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    expect(await screen.findByText(/RBAC Audit Log/i)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /^All event types$/i })).toBeInTheDocument();
    expect(screen.queryByText(/Default view hides routine admin page-view checks/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^All types$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/admin_ui#view/i)).toBeInTheDocument();
    expect(screen.getByText(/webui_backend/i)).toBeInTheDocument();
    expect(screen.queryByText(/^bff$/i)).not.toBeInTheDocument();
  });

  it('renders OpenFGA ReBAC audit events as their own type', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        records: [
          {
            id: '1',
            ts: new Date().toISOString(),
            type: 'openfga_rebac',
            outcome: 'allow',
            action: 'agent#use',
            tenant_id: 'default',
            subject_hash: 'h',
            correlation_id: 'c',
            source: 'bff',
            pdp: 'openfga',
            resource_ref: 'user:alice can_use agent:default',
          },
        ],
        total: 1,
        page: 1,
        limit: 30,
      }),
    });

    render(<UnifiedAuditTab isAdmin />);

    expect(await screen.findByText(/agent#use/i)).toBeInTheDocument();
    expect(screen.getAllByText(/OpenFGA ReBAC/i).length).toBeGreaterThan(0);
  });

  it('blends bridge OpenFGA decisions into the audit table without rendering trace links', async () => {
    (global.fetch as jest.Mock).mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          records: [
            {
              id: '1',
              ts: new Date().toISOString(),
              type: 'openfga_rebac',
              outcome: 'allow',
              action: 'mcp#can_call',
              tenant_id: 'default',
              subject_hash: 'h',
              correlation_id: 'c',
              source: 'openfga_authz_bridge',
              component: 'agent_gateway',
              pdp: 'openfga',
              resource_ref: 'user:alice can_call mcp_gateway:list',
              trace_id: '0123456789abcdef0123456789abcdef',
            },
          ],
          total: 1,
          page: 1,
          limit: 30,
        }),
      });
    });

    render(<UnifiedAuditTab isAdmin />);

    expect(await screen.findByText(/mcp#can_call/i)).toBeInTheDocument();
    expect(screen.getByText(/openfga_authz_bridge/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/mcp#can_call/i));
    expect(screen.queryByText(/^Trace:/i)).not.toBeInTheDocument();
  });

  it('shows event type and outcome definition help', async () => {
    render(<UnifiedAuditTab isAdmin />);

    await screen.findByText(/RBAC Audit Log/i);

    const typeHelp = screen.getByRole('button', { name: /event type definitions/i });
    fireEvent.click(typeHelp);
    expect(await screen.findByText(/Grant and revoke attempts written by CAS/i)).toBeInTheDocument();
    expect(screen.getByText(/Allow\/deny results when the Centralized Authorization Service/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /outcome filter definitions/i }));
    expect(await screen.findByText(/A policy change \(grant\/revoke\) completed/i)).toBeInTheDocument();
  });

  it('renders cas_grant policy-change events with caller and grantee context', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        records: [
          {
            ts: new Date().toISOString(),
            type: 'cas_grant',
            outcome: 'success',
            action: 'use',
            tenant_id: 'acme',
            subject_hash: 'hash-caller',
            correlation_id: 'grant-corr',
            source: 'cas',
            caller_ref: 'user:alice',
            grantee_ref: 'team:eng',
            operation: 'grant',
            resource_ref: 'agent:platform-engineer',
            component: 'cas',
            pdp: 'openfga',
          },
          {
            ts: new Date().toISOString(),
            type: 'cas_grant',
            outcome: 'error',
            action: 'use',
            tenant_id: 'acme',
            subject_hash: 'hash-caller',
            correlation_id: 'grant-deny-corr',
            source: 'cas',
            caller_ref: 'user:bob',
            grantee_ref: 'team:eng',
            operation: 'revoke',
            reason_code: 'NO_CAPABILITY',
            resource_ref: 'agent:platform-engineer',
          },
        ],
        total: 2,
        page: 1,
        limit: 30,
      }),
    });

    render(<UnifiedAuditTab isAdmin />);

    expect(await screen.findByText(/user:alice/i)).toBeInTheDocument();
    expect(screen.getByText(/user:bob/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Policy change/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('option', { name: /Policy changes/i })).toBeInTheDocument();

    fireEvent.click(screen.getByText(/user:alice/i));
    expect(await screen.findByText(/Grantee:/i)).toBeInTheDocument();
    expect(screen.getByText(/team:eng/i)).toBeInTheDocument();
    expect(screen.getByText(/Operation:/i)).toBeInTheDocument();
    expect(screen.getByText(/^grant$/i)).toBeInTheDocument();
  });

  it('renders CAS decisions as readable authorization stories', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        records: [
          {
            ts: new Date('2026-06-11T22:05:36.000Z').toISOString(),
            type: 'cas_decision',
            outcome: 'allow',
            action: 'manage',
            tenant_id: 'default',
            subject_hash: 'sha256:9accc8a00ffe8ae4451e81d95686e1f4',
            user_email: 'sraradhy@cisco.com',
            correlation_id: 'af9c0e92-3060-46de-bb16-db3e26c4f973',
            source: 'cas',
            component: 'cas',
            pdp: 'openfga',
            reason_code: 'OK',
            resource_ref: 'organization:caipe',
            resource_type: 'organization',
            resource_id: 'caipe',
            decision_via: 'tuple',
          },
        ],
        total: 1,
        page: 1,
        limit: 30,
      }),
    });

    render(<UnifiedAuditTab isAdmin />);

    expect(await screen.findByText(/Allowed to manage organization caipe/i)).toBeInTheDocument();
    expect(screen.getByText(/Actor sraradhy@cisco.com/i)).toBeInTheDocument();
    expect(screen.getByText(/OpenFGA tuple/i)).toBeInTheDocument();
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent?.trim());
    expect(headers.indexOf('Actor')).toBeLessThan(headers.indexOf('Request'));

    fireEvent.click(screen.getByText(/Allowed to manage organization caipe/i));
    expect(await screen.findByText(/What happened:/i)).toBeInTheDocument();
    expect(screen.getByText(/CAS allowed this request because OpenFGA returned OK/i)).toBeInTheDocument();
  });

  it('downloads all filtered audit events as JSON', async () => {
    const exportedUrls: string[] = [];
    const createObjectURL = jest.fn(() => {
      exportedUrls.push(`blob:mock-${exportedUrls.length}`);
      return exportedUrls[exportedUrls.length - 1];
    });
    const revokeObjectURL = jest.fn();
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });

    const pageOneRecord = {
      id: 'cas-1',
      ts: new Date('2026-06-11T20:00:00.000Z').toISOString(),
      type: 'cas_decision',
      outcome: 'allow',
      action: 'use',
      tenant_id: 'default',
      subject_hash: 'sha256:owner',
      correlation_id: 'wfrun-20260611200000-abc',
      source: 'cas',
      resource_ref: 'agent:hello-world',
      resource_type: 'agent',
      resource_id: 'hello-world',
      workflow_run_id: 'wfrun-20260611200000-abc',
      decision_via: 'tuple',
    };
    const pageTwoRecord = {
      ...pageOneRecord,
      id: 'cas-2',
      correlation_id: 'wfrun-20260611200000-def',
      workflow_run_id: 'wfrun-20260611200000-def',
    };

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          records: [],
          total: 0,
          page: 1,
          limit: 30,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          records: [],
          total: 0,
          page: 1,
          limit: 30,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          records: [pageOneRecord],
          total: 2,
          page: 1,
          limit: 200,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          records: [pageTwoRecord],
          total: 2,
          page: 2,
          limit: 200,
        }),
      });

    render(<UnifiedAuditTab isAdmin />);

    await screen.findByText(/RBAC Audit Log/i);
    fireEvent.change(screen.getAllByRole('combobox')[0], {
      target: { value: 'cas_decision' },
    });
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    fireEvent.click(screen.getByRole('button', { name: /download audit log/i }));

    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalledTimes(1);
    });

    expect(global.fetch).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('type=cas_decision'),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('limit=200'),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('page=2'),
    );
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-0');

    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const payloadText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    const payload = JSON.parse(payloadText);
    expect(payload).toMatchObject({
      filters: { type: 'cas_decision' },
      total: 2,
      record_count: 2,
    });
    expect(payload.records).toEqual([pageOneRecord, pageTwoRecord]);

    click.mockRestore();
  });
});
