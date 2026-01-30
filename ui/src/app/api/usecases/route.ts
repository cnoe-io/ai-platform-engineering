import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
} from "@/lib/api-middleware";

/**
 * Use Case API Routes
 *
 * Storage: MongoDB (if configured) or file-based (fallback)
 * - If MONGODB_URI is set → MongoDB mode (with user ownership)
 * - If MONGODB_URI is NOT set → File-based storage (no ownership)
 *
 * MongoDB mode features:
 * - User ownership tracking (owner_id)
 * - Delete functionality
 * - Per-user use cases
 */

interface UseCaseData {
  title: string;
  description: string;
  category: string;
  tags: string[];
  prompt: string;
  expectedAgents: string[];
  difficulty: "beginner" | "intermediate" | "advanced";
}

interface UseCase extends UseCaseData {
  id: string;
  owner_id?: string; // User email who created the use case
  createdAt: string;
  updatedAt?: string;
}

// Storage configuration - default to MongoDB if configured, otherwise file
const STORAGE_TYPE = isMongoDBConfigured ? "mongodb" : (process.env.USECASE_STORAGE_TYPE || "file");
const STORAGE_PATH = process.env.USECASE_STORAGE_PATH || path.join(process.cwd(), "data", "usecases.json");

/**
 * File-based storage functions
 */
async function ensureDataDirectory() {
  const dataDir = path.dirname(STORAGE_PATH);
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
}

async function readUseCasesFromFile(): Promise<UseCase[]> {
  try {
    await ensureDataDirectory();
    const data = await fs.readFile(STORAGE_PATH, "utf-8");
    return JSON.parse(data);
  } catch (error: any) {
    // File doesn't exist or is empty, return empty array
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeUseCasesToFile(useCases: UseCase[]): Promise<void> {
  await ensureDataDirectory();
  await fs.writeFile(STORAGE_PATH, JSON.stringify(useCases, null, 2), "utf-8");
}

/**
 * MongoDB storage functions (using shared connection)
 */
async function saveUseCaseToMongoDB(useCase: UseCase): Promise<void> {
  const collection = await getCollection<UseCase>("usecases");
  await collection.insertOne(useCase);
}

async function updateUseCaseInMongoDB(id: string, useCase: Partial<UseCase>, ownerEmail?: string): Promise<void> {
  const collection = await getCollection<UseCase>("usecases");
  const filter: any = { id };
  if (ownerEmail) {
    filter.owner_id = ownerEmail; // Ensure user can only update their own
  }
  await collection.updateOne(
    filter,
    { $set: { ...useCase, updatedAt: new Date().toISOString() } }
  );
}

async function deleteUseCaseFromMongoDB(id: string, ownerEmail: string): Promise<void> {
  const collection = await getCollection<UseCase>("usecases");
  const result = await collection.deleteOne({ id, owner_id: ownerEmail });
  if (result.deletedCount === 0) {
    throw new ApiError("Use case not found or you don't have permission to delete it", 404);
  }
}

async function getUseCasesFromMongoDB(ownerEmail?: string): Promise<UseCase[]> {
  const collection = await getCollection<UseCase>("usecases");
  const filter = ownerEmail ? { owner_id: ownerEmail } : {};
  const useCases = await collection.find(filter).sort({ createdAt: -1 }).toArray();
  return useCases;
}

/**
 * Unified storage functions
 */
async function saveUseCase(useCase: UseCase): Promise<void> {
  if (STORAGE_TYPE === "mongodb") {
    await saveUseCaseToMongoDB(useCase);
  } else {
    // File-based storage (fallback)
    const useCases = await readUseCasesFromFile();
    useCases.push(useCase);
    await writeUseCasesToFile(useCases);
  }
}

async function getAllUseCases(ownerEmail?: string): Promise<UseCase[]> {
  if (STORAGE_TYPE === "mongodb") {
    return await getUseCasesFromMongoDB(ownerEmail);
  } else {
    // File-based storage (fallback)
    return await readUseCasesFromFile();
  }
}

async function updateUseCase(id: string, useCaseData: Partial<UseCaseData>, ownerEmail?: string): Promise<void> {
  if (STORAGE_TYPE === "mongodb") {
    await updateUseCaseInMongoDB(id, useCaseData, ownerEmail);
  } else {
    // File-based storage (fallback)
    const useCases = await readUseCasesFromFile();
    const index = useCases.findIndex((uc) => uc.id === id);
    if (index === -1) {
      throw new Error("Use case not found");
    }
    useCases[index] = {
      ...useCases[index],
      ...useCaseData,
      updatedAt: new Date().toISOString(),
    };
    await writeUseCasesToFile(useCases);
  }
}

async function deleteUseCase(id: string, ownerEmail: string): Promise<void> {
  if (STORAGE_TYPE === "mongodb") {
    await deleteUseCaseFromMongoDB(id, ownerEmail);
  } else {
    // File-based storage (fallback) - no ownership check
    const useCases = await readUseCasesFromFile();
    const filtered = useCases.filter((uc) => uc.id !== id);
    if (filtered.length === useCases.length) {
      throw new ApiError("Use case not found", 404);
    }
    await writeUseCasesToFile(filtered);
  }
}

// POST /api/usecases - Create a new use case
export const POST = withErrorHandler(async (request: NextRequest) => {
  const body: UseCaseData = await request.json();

  // Validate required fields
  if (!body.title || !body.description || !body.prompt || !body.category) {
    throw new ApiError("Missing required fields", 400);
  }

  // Agents are now optional - default to empty array if not provided
  if (!body.expectedAgents) {
    body.expectedAgents = [];
  }

  // Generate ID
  const id = `usecase-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // In MongoDB mode, require auth and set owner_id
  if (STORAGE_TYPE === "mongodb") {
    return await withAuth(request, async (req, user) => {
      const useCase: UseCase = {
        id,
        ...body,
        owner_id: user.email,
        createdAt: new Date().toISOString(),
      };

      await saveUseCase(useCase);
      console.log(`[UseCase] Created use case "${body.title}" by ${user.email}`);

      return successResponse({
        id,
        message: "Use case saved successfully",
      }, 201);
    });
  } else {
    // File mode: No auth required
    const useCase: UseCase = {
      id,
      ...body,
      createdAt: new Date().toISOString(),
    };

    await saveUseCase(useCase);
    console.log(`[UseCase] Created use case "${body.title}" (file mode)`);

    return successResponse({
      id,
      message: "Use case saved successfully",
    }, 201);
  }
});

// GET /api/usecases - Retrieve all use cases (user's own in MongoDB mode)
export const GET = withErrorHandler(async (request: NextRequest) => {
  // In MongoDB mode, require auth and return user's own use cases
  // In file mode, return all (no ownership, no auth required)
  if (STORAGE_TYPE === "mongodb") {
    return await withAuth(request, async (req, user) => {
      const useCases = await getAllUseCases(user.email);
      return NextResponse.json(useCases);
    });
  } else {
    // File mode: No auth required, return all use cases
    const useCases = await getAllUseCases();
    return NextResponse.json(useCases);
  }
});

// PUT /api/usecases?id=<useCaseId> - Update an existing use case
export const PUT = withErrorHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    throw new ApiError("Use case ID is required", 400);
  }

  const body: Partial<UseCaseData> = await request.json();

  // Validate that at least one field is provided
  if (Object.keys(body).length === 0) {
    throw new ApiError("At least one field must be provided for update", 400);
  }

  // Agents are now optional - no validation needed for empty array

  // In MongoDB mode, require auth and check ownership
  if (STORAGE_TYPE === "mongodb") {
    return await withAuth(request, async (req, user) => {
      const allUseCases = await getAllUseCases(user.email);
      const existingUseCase = allUseCases.find((uc) => uc.id === id);

      if (!existingUseCase) {
        throw new ApiError("Use case not found", 404);
      }

      await updateUseCase(id, body, user.email);
      console.log(`[UseCase] Updated use case "${id}" by ${user.email}`);

      return successResponse({
        id,
        message: "Use case updated successfully",
      });
    });
  } else {
    // File mode: No auth required
    const allUseCases = await getAllUseCases();
    const existingUseCase = allUseCases.find((uc) => uc.id === id);

    if (!existingUseCase) {
      throw new ApiError("Use case not found", 404);
    }

    await updateUseCase(id, body);
    console.log(`[UseCase] Updated use case "${id}" (file mode)`);

    return successResponse({
      id,
      message: "Use case updated successfully",
    });
  }
});

// DELETE /api/usecases?id=<useCaseId> - Delete a use case
export const DELETE = withErrorHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    throw new ApiError("Use case ID is required", 400);
  }

  // In MongoDB mode, require auth and check ownership
  if (STORAGE_TYPE === "mongodb") {
    return await withAuth(request, async (req, user) => {
      await deleteUseCase(id, user.email);
      console.log(`[UseCase] Deleted use case "${id}" by ${user.email}`);

      return successResponse({
        id,
        message: "Use case deleted successfully",
      });
    });
  } else {
    // File mode: No auth required (ownership not tracked)
    await deleteUseCase(id, "");
    console.log(`[UseCase] Deleted use case "${id}" (file mode)`);

    return successResponse({
      id,
      message: "Use case deleted successfully",
    });
  }
});
