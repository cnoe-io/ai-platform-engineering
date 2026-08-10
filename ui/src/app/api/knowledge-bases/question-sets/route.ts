// GET  /api/knowledge-bases/question-sets - list question sets
// POST /api/knowledge-bases/question-sets - create a set, optionally seeded
//      from an uploaded .jsonl / .csv / .json file
//
// Authorizing proxy over the DeepEval service's Question Set Manager: we own
// the session + OpenFGA check, it owns storage and file parsing.

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from '@/lib/api-middleware';
import { NextRequest } from 'next/server';
import { createQuestionSet, listQuestionSets } from './_lib/upstream';
import { requireQuestionSetWriteAccess } from './_lib/shared';

// Matches the upstream's own MAX_UPLOAD_SIZE_BYTES so a file that would be
// accepted downstream is never rejected here first.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  if (!session) {
    throw new ApiError('Unauthorized', 401);
  }

  const url = new URL(request.url);
  const page = Number(url.searchParams.get('page')) || undefined;
  const limit = Number(url.searchParams.get('limit')) || undefined;
  const query = url.searchParams.get('query')?.trim() || undefined;

  return successResponse(await listQuestionSets({ page, limit, query }));
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireQuestionSetWriteAccess(session);

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    throw new ApiError(
      'Expected multipart/form-data with "name" and an optional "file" field',
      400,
      'INVALID_CONTENT_TYPE',
    );
  }

  const form = await request.formData();
  const rawFile = form.get('file');
  const file = rawFile instanceof File && rawFile.size > 0 ? rawFile : undefined;

  if (file && file.size > MAX_UPLOAD_BYTES) {
    throw new ApiError(
      `Uploaded file exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit`,
      400,
      'FILE_TOO_LARGE',
    );
  }

  const name = String(form.get('name') || '').trim() || file?.name.replace(/\.[^.]+$/, '');
  if (!name) {
    throw new ApiError('A question set name is required', 400, 'VALIDATION_ERROR');
  }
  const description = String(form.get('description') || '').trim() || undefined;

  return successResponse(await createQuestionSet({ name, description, file }), 201);
});
