// GET /api/users/me - Get current user profile
// PUT /api/users/me - Update current user profile

import { NextRequest } from 'next/server';
import { getCollection } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
} from '@/lib/api-middleware';
import type { User, UpdateUserRequest } from '@/types/mongodb';

// GET /api/users/me
export const GET = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (req, user) => {
    const users = await getCollection<User>('users');

    let userProfile = await users.findOne({ email: user.email });
    const now = new Date();

    // Create user profile if it doesn't exist
    if (!userProfile) {
      const newUser = {
        email: user.email,
        name: user.name,
        created_at: now,
        updated_at: now,
        last_login: now,
        metadata: {
          sso_provider: 'duo', // TODO: Get from session
          sso_id: user.email,
          role: user.role as 'user' | 'admin',
        },
      };

      const result = await users.insertOne(newUser as any);
      userProfile = { _id: result.insertedId, ...newUser } as any;
    } else {
      // Sync fields that can change upstream (e.g. IdP display name after a
      // name change — married, nickname, etc). Email is the stable identifier
      // and is never updated. We also refresh last_login on every call.
      //
      // Behavior: if the session carries a non-empty display name that differs
      // from what we have stored, update our `name` field. Manual overrides
      // via PUT /api/users/me will be re-synced on the next call once the
      // session's name updates from the IdP, which matches the "OIDC is the
      // source of truth for display name" product decision.
      const update: Record<string, unknown> = { last_login: now };
      if (
        user.name &&
        typeof user.name === 'string' &&
        user.name !== userProfile.name
      ) {
        update.name = user.name;
        update.updated_at = now;
      }

      await users.updateOne({ email: user.email }, { $set: update });

      // Reflect the update in the response without a second round trip.
      if ('name' in update) {
        userProfile = {
          ...userProfile,
          name: user.name as string,
          updated_at: now,
          last_login: now,
        };
      } else {
        userProfile = { ...userProfile, last_login: now };
      }
    }

    return successResponse(userProfile);
  });
});

// PUT /api/users/me
export const PUT = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (req, user) => {
    const body: UpdateUserRequest = await request.json();

    const users = await getCollection<User>('users');

    const update: any = {
      updated_at: new Date(),
    };

    if (body.name) update.name = body.name;
    if (body.avatar_url !== undefined) update.avatar_url = body.avatar_url;

    await users.updateOne(
      { email: user.email },
      { $set: update }
    );

    const updated = await users.findOne({ email: user.email });

    return successResponse(updated);
  });
});
