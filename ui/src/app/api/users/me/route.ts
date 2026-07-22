// GET /api/users/me - Get current user profile
// PUT /api/users/me - Update current user profile

import {
successResponse,
withAuth,
withErrorHandler,
} from '@/lib/api-middleware';
import { getCollection } from '@/lib/mongodb';
import type { UpdateUserRequest,User } from '@/types/mongodb';
import { NextRequest } from 'next/server';

// GET /api/users/me
export const GET = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (req, user) => {
    const users = await getCollection<User>('users');

    let userProfile = await users.findOne({ email: user.email });

    // Create user profile if it doesn't exist
    if (!userProfile) {
      const now = new Date();
      const newUser: Omit<User, '_id'> = {
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

      const result = await users.insertOne(newUser);
      userProfile = { _id: result.insertedId, ...newUser };
    } else {
      // Update last login
      await users.updateOne(
        { email: user.email },
        { $set: { last_login: new Date() } }
      );
    }

    return successResponse(userProfile);
  });
});

// PUT /api/users/me
export const PUT = withErrorHandler(async (request: NextRequest) => {
  return withAuth(request, async (req, user) => {
    const body: UpdateUserRequest = await request.json();

    const users = await getCollection<User>('users');

    const update: Partial<Pick<User, 'avatar_url' | 'name' | 'updated_at'>> & {
      updated_at: Date;
    } = {
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
