// PATCH /api/settings/preferences - Update preferences only

import { NextRequest } from 'next/server';
import { getCollection } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
} from '@/lib/api-middleware';
import type { UserSettings } from '@/types/mongodb';

// PATCH /api/settings/preferences
export const PATCH = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (req, user) => {
    const body = await request.json();

    const settings = await getCollection<UserSettings>('user_settings');

    const update: any = {
      updated_at: new Date(),
    };

    // Update only provided preference keys
    Object.keys(body).forEach((key) => {
      update[`preferences.${key}`] = body[key];
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
