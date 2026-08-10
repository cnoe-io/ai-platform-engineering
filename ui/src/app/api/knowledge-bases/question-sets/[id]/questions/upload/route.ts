// POST /api/knowledge-bases/question-sets/[id]/questions/upload - append
// questions to an existing set from a .jsonl / .csv / .json file.
//
// Sits alongside the [questionId] dynamic route — Next.js matches this static
// segment first, so "upload" is never read as a question id.

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from '@/lib/api-middleware';
import { NextRequest } from 'next/server';
import { parseNumericId, requireQuestionSetWriteAccess } from '../../../_lib/shared';
import { uploadQuestions } from '../../../_lib/upstream';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const POST = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { session } = await getAuthFromBearerOrSession(request);
    await requireQuestionSetWriteAccess(session);

    const { id } = await context.params;
    const setId = parseNumericId(id, 'question set');

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      throw new ApiError(
        'Expected multipart/form-data with a "file" field',
        400,
        'INVALID_CONTENT_TYPE',
      );
    }

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      throw new ApiError('Missing or empty "file" field', 400, 'MISSING_FILE');
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ApiError(
        `Uploaded file exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit`,
        400,
        'FILE_TOO_LARGE',
      );
    }

    const added = await uploadQuestions(setId, file);
    return successResponse({ questions: added, added_count: added.length }, 201);
  },
);
