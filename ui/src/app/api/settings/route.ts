// GET /api/settings - Get all user settings
// PUT /api/settings - Update all settings

import {
successResponse,
withAuth,
withErrorHandler,
} from '@/lib/api-middleware';
import { getCollection } from '@/lib/mongodb';
import type { UpdateSettingsRequest,UserSettings } from '@/types/mongodb';
import { DEFAULT_USER_SETTINGS } from '@/types/mongodb';
import type { Document } from 'mongodb';
import { NextRequest } from 'next/server';

// GET /api/settings
export const GET = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (req, user) => {
    const settings = await getCollection<UserSettings>('user_settings');

    let userSettings = await settings.findOne({ user_id: user.email });

    // Create default settings if they don't exist
    if (!userSettings) {
      const newSettings: Omit<UserSettings, '_id'> = {
        user_id: user.email,
        ...DEFAULT_USER_SETTINGS,
        updated_at: new Date(),
      };

      const result = await settings.insertOne(newSettings);
      userSettings = { _id: result.insertedId, ...newSettings };
    }

    return successResponse(userSettings);
  });
});

// PUT /api/settings
export const PUT = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (req, user) => {
    const body: UpdateSettingsRequest = await request.json();

    const settings = await getCollection<UserSettings>('user_settings');

    const update: Document = {
      updated_at: new Date(),
    };

    if (body.preferences) {
      Object.keys(body.preferences).forEach((key) => {
        update[`preferences.${key}`] = body.preferences![key as keyof typeof body.preferences];
      });
    }

    if (body.notifications) {
      Object.keys(body.notifications).forEach((key) => {
        update[`notifications.${key}`] = body.notifications![key as keyof typeof body.notifications];
      });
    }

    if (body.defaults) {
      Object.keys(body.defaults).forEach((key) => {
        update[`defaults.${key}`] = body.defaults![key as keyof typeof body.defaults];
      });
    }

    await settings.updateOne(
      { user_id: user.email },
      { $set: update },
      { upsert: true }
    );

    const updated = await settings.findOne({ user_id: user.email });

    return successResponse(updated);
  });
});
