import { authOptions } from '@/lib/auth-config';
import {
  reconcileDataSourceRelationships,
  reconcileKnowledgeBaseRelationships,
} from '@/lib/rbac/openfga-owned-resources-reconcile';
import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Benchmark corpus ingest (server-side).
 *
 * The Benchmark Corpus tab uploads a `.jsonl` corpus where each line is one
 * document that must keep its own `document_id` (so retrieval eval lines up with
 * the golden `expected_doc_ids`). Preserving per-line ids requires the rag-server's
 * low-level lifecycle (`heartbeat -> datasource -> job -> /v1/ingest -> complete`),
 * whose setup endpoints (`heartbeat`, `/v1/job`) are gated by `require_role(ingestonly)`.
 * A human SSO login is always `readonly`, so the browser's token can't pass — which
 * is why this runs **server-side under a `caipe-platform` client-credentials token**
 * (the same identity the Python ingest script uses). After the datasource is created
 * we write OpenFGA ownership for the signed-in user so it shows up as theirs.
 *
 * Everything here is server-only: the client secret never reaches the browser.
 */

interface BenchmarkRow {
  document_id?: string;
  id?: string;
  title?: string;
  text?: string;
  content?: string;
  page_content?: string;
  [key: string]: unknown;
}

interface IngestBody {
  datasourceId?: string;
  datasourceName?: string;
  description?: string;
  ownerTeamSlug?: string;
  rows?: BenchmarkRow[];
}

function getRagServerUrl(): string {
  return (
    process.env.RAG_SERVER_URL ||
    process.env.NEXT_PUBLIC_RAG_URL ||
    'http://localhost:9446'
  );
}

function getRealmTokenEndpoint(): string {
  const base = (process.env.KEYCLOAK_URL || 'http://keycloak:7080').replace(/\/$/, '');
  const realm = (process.env.KEYCLOAK_REALM || 'caipe').trim();
  return `${base}/realms/${encodeURIComponent(realm)}/protocol/openid-connect/token`;
}

/**
 * Mint a `client_credentials` token for the caipe realm using the platform
 * service account. Deliberately NO master-realm password fallback: a
 * `/realms/master` admin-cli token would not validate as a caipe-realm service
 * token at the rag-server.
 */
async function mintServiceToken(): Promise<string> {
  const clientId = process.env.KEYCLOAK_ADMIN_CLIENT_ID?.trim();
  const clientSecret = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing KEYCLOAK_ADMIN_CLIENT_ID / KEYCLOAK_ADMIN_CLIENT_SECRET for the ingest service token',
    );
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(getRealmTokenEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Keycloak token mint failed: ${res.status} ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error('Keycloak token response missing access_token');
  }
  return data.access_token;
}

/** Small helper for authenticated calls to the rag-server. */
async function ragFetch(
  token: string,
  path: string,
  init: { method: string; jsonBody?: unknown },
): Promise<Response> {
  return fetch(`${getRagServerUrl()}${path}`, {
    method: init.method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: init.jsonBody !== undefined ? JSON.stringify(init.jsonBody) : undefined,
  });
}

async function ragError(res: Response, label: string): Promise<Error> {
  const detail = await res.text().catch(() => '');
  return new Error(`${label} -> HTTP ${res.status} ${detail.slice(0, 300)}`);
}

/** Mirror the Python `to_ingest_payload`; preserve `document_id`. */
function toIngestPayload(row: BenchmarkRow, datasourceId: string, ingestorId: string) {
  const documentId = String(row.document_id ?? row.id ?? '');
  const title = typeof row.title === 'string' ? row.title : '';
  const bodyRaw = row.text ?? row.content ?? row.page_content ?? '';
  const body = typeof bodyRaw === 'string' ? bodyRaw : String(bodyRaw);
  return {
    page_content: title ? `${title}\n\n${body}` : body,
    type: 'Document',
    metadata: {
      document_id: documentId,
      datasource_id: datasourceId,
      ingestor_id: ingestorId,
      title,
      description: '',
      is_structured_entity: false,
      document_type: 'text',
      document_ingested_at: null,
      fresh_until: null,
      metadata: { source: 'benchmark-ui' },
    },
  };
}

export async function POST(request: NextRequest) {
  // 1. Require a signed-in user (the service token is only used on their behalf).
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const subject =
    typeof session.sub === 'string' && session.sub.trim() ? session.sub.trim() : null;

  let body: IngestBody;
  try {
    body = (await request.json()) as IngestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const datasourceId = (body.datasourceId || '').trim();
  const datasourceName = (body.datasourceName || '').trim();
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const ownerTeamSlug = body.ownerTeamSlug?.trim() || null;
  const description = body.description?.trim() || 'Benchmark corpus ingested via UI';

  if (!datasourceId || !datasourceName) {
    return NextResponse.json({ error: 'datasourceId and datasourceName are required' }, { status: 400 });
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: 'No documents to ingest' }, { status: 400 });
  }

  let jobId: string | null = null;
  let serviceToken: string;
  try {
    serviceToken = await mintServiceToken();
  } catch (err: any) {
    console.error('[benchmark-ingest] token mint failed:', err);
    return NextResponse.json({ error: `Service token error: ${err?.message || err}` }, { status: 502 });
  }

  try {
    // 2. Register the ingestor (heartbeat).
    const hbRes = await ragFetch(serviceToken, '/v1/ingestor/heartbeat', {
      method: 'POST',
      jsonBody: {
        ingestor_type: 'benchmark-ui',
        ingestor_name: 'benchmark-ui-ingestor',
        description: 'Benchmark dataset UI ingestor',
      },
    });
    if (!hbRes.ok) throw await ragError(hbRes, 'heartbeat');
    const heartbeat = (await hbRes.json()) as {
      ingestor_id: string;
      max_documents_per_ingest?: number;
    };
    const ingestorId = heartbeat.ingestor_id;
    const batchSize = Math.min(100, heartbeat.max_documents_per_ingest || 100);

    // 3. Create/replace the datasource.
    const dsRes = await ragFetch(serviceToken, '/v1/datasource', {
      method: 'POST',
      jsonBody: {
        datasource_id: datasourceId,
        name: datasourceName,
        ingestor_id: ingestorId,
        description,
        source_type: 'benchmark-ui',
        last_updated: Math.floor(Date.now() / 1000),
        // Config-level ownership mirrors the OpenFGA tuples written below, matching
        // what the /api/rag proxy injects on a normal datasource create.
        ...(ownerTeamSlug ? { owner_team_slug: ownerTeamSlug } : {}),
        ...(subject ? { creator_subject: subject } : {}),
        ...(subject && !ownerTeamSlug ? { owner_subject: subject } : {}),
      },
    });
    if (!dsRes.ok) throw await ragError(dsRes, 'datasource');

    // 4. Open a job (query params).
    const jobParams = new URLSearchParams({
      datasource_id: datasourceId,
      job_status: 'in_progress',
      message: 'Benchmark corpus ingestion',
      total: String(rows.length),
    });
    const jobRes = await ragFetch(serviceToken, `/v1/job?${jobParams.toString()}`, { method: 'POST' });
    if (!jobRes.ok) throw await ragError(jobRes, 'job');
    jobId = ((await jobRes.json()) as { job_id: string }).job_id;

    // 5. Push documents in batches.
    const documents = rows.map((row) => toIngestPayload(row, datasourceId, ingestorId));
    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);
      const ingRes = await ragFetch(serviceToken, '/v1/ingest', {
        method: 'POST',
        jsonBody: {
          documents: batch,
          ingestor_id: ingestorId,
          datasource_id: datasourceId,
          job_id: jobId,
        },
      });
      if (!ingRes.ok) throw await ragError(ingRes, `ingest batch ${i / batchSize + 1}`);
    }

    // 6. Complete the job.
    const doneParams = new URLSearchParams({
      job_status: 'completed',
      message: 'Benchmark corpus ingestion complete',
    });
    const doneRes = await ragFetch(
      serviceToken,
      `/v1/job/${encodeURIComponent(jobId)}?${doneParams.toString()}`,
      { method: 'PATCH' },
    );
    if (!doneRes.ok) throw await ragError(doneRes, 'complete job');

    // 7. Write ownership for the signed-in user so the datasource is visible/owned
    //    in the filtered list (the service account created it). Best-effort: the
    //    documents are already ingested, so a reconcile hiccup shouldn't fail the call.
    if (subject) {
      try {
        await reconcileKnowledgeBaseRelationships({
          knowledgeBaseId: datasourceId,
          ownerSubject: subject,
          ownerTeamSlug,
          creatorSubject: subject,
        });
        await reconcileDataSourceRelationships({
          dataSourceId: datasourceId,
          creatorSubject: subject,
          parentKnowledgeBaseId: datasourceId,
        });
      } catch (reconcileErr) {
        console.warn('[benchmark-ingest] ownership reconcile failed (docs still ingested):', reconcileErr);
      }
    }

    return NextResponse.json({ datasource_id: datasourceId, job_id: jobId, count: documents.length });
  } catch (err: any) {
    console.error('[benchmark-ingest] ingest failed:', err);
    // Best-effort: mark the job failed so it doesn't linger as in-progress.
    if (jobId) {
      const failParams = new URLSearchParams({ job_status: 'failed', message: 'Benchmark ingestion failed' });
      await ragFetch(serviceToken, `/v1/job/${encodeURIComponent(jobId)}?${failParams.toString()}`, {
        method: 'PATCH',
      }).catch(() => {});
    }
    return NextResponse.json({ error: err?.message || 'Ingestion failed' }, { status: 502 });
  }
}
