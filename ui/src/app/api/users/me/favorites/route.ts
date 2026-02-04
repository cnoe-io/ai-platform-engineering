// GET /api/users/me/favorites - Get user's favorite agent configs
// PUT /api/users/me/favorites - Update user's favorite agent configs

import { NextRequest, NextResponse } from 'next/server';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
} from '@/lib/api-middleware';
import type { User } from '@/types/mongodb';

/**
 * User Favorites API
 *
 * Stores user's favorite agent configuration IDs in MongoDB.
 * Favorites are stored as an array of config IDs in the user document.
 */

// GET /api/users/me/favorites
export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    throw new ApiError('Favorites require MongoDB to be configured', 503);
  }

  return withAuth(request, async (req, user) => {
    const users = await getCollection<User>('users');

    const userProfile = await users.findOne({ email: user.email });

    if (!userProfile) {
      throw new ApiError('User not found', 404);
    }

    // Return favorites array (empty array if not set)
    const favorites = (userProfile as any).favorites || [];

    return successResponse({ favorites });
  });
});

// PUT /api/users/me/favorites
export const PUT = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    throw new ApiError('Favorites require MongoDB to be configured', 503);
  }

  return withAuth(request, async (req, user) => {
    const body = await request.json();

    // Validate favorites array
    if (!Array.isArray(body.favorites)) {
      throw new ApiError('favorites must be an array', 400);
    }

    // Validate all favorites are strings (config IDs)
    if (!body.favorites.every((id: any) => typeof id === 'string')) {
      throw new ApiError('All favorites must be string IDs', 400);
    }

    // Remove duplicates
    const uniqueFavorites = [...new Set(body.favorites)];

    const users = await getCollection<User>('users');

    // Update favorites
    await users.updateOne(
      { email: user.email },
      {
        $set: {
          favorites: uniqueFavorites as string[],
          updated_at: new Date(),
        },
      } as any
    );

    console.log(`[Favorites] Updated favorites for ${user.email}: ${uniqueFavorites.length} items`);

    return successResponse({
      favorites: uniqueFavorites,
      message: 'Favorites updated successfully',
    });
  });
});
