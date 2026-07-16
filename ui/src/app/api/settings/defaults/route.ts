// PATCH /api/settings/defaults - Update default settings only

import {
successResponse,
withAuth,
withErrorHandler,
} from '@/lib/api-middleware';
import { getCollection } from '@/lib/mongodb';
import type { UserSettings } from '@/types/mongodb';
import type { Document } from 'mongodb';
import { NextRequest } from 'next/server';

// PATCH /api/settings/defaults
export const PATCH = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (req, user) => {
    const body: Partial<UserSettings['defaults']> = await request.json();

    const settings = await getCollection<UserSettings>('user_settings');

    const update: Document = {
      updated_at: new Date(),
    };

    // Update only provided default keys
    Object.keys(body).forEach((key) => {
      update[`defaults.${key}`] = body[key];
    });

    await settings.updateOne(
      { user_id: user.email },
      { $set: update },
      { upsert: true }
    );

    const updated = await settings.findOne({ user_id: user.email });

    return successResponse(updated);
  });
});
