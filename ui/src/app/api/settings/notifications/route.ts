// PATCH /api/settings/notifications - Update notification settings only

import {
successResponse,
withAuth,
withErrorHandler,
} from '@/lib/api-middleware';
import { getCollection } from '@/lib/mongodb';
import type { UserSettings } from '@/types/mongodb';
import { NextRequest } from 'next/server';

// PATCH /api/settings/notifications
export const PATCH = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (req, user) => {
    const body = await request.json();

    const settings = await getCollection<UserSettings>('user_settings');

    const update: any = {
      updated_at: new Date(),
    };

    // Update only provided notification keys
    Object.keys(body).forEach((key) => {
      update[`notifications.${key}`] = body[key];
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
