import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

/**
 * POST /api/usecases
 * 
 * Save a use case to the backend.
 * 
 * Storage options (configured via environment variables):
 * 1. File-based storage (default) - Stores in JSON file
 * 2. MongoDB - Set USECASE_STORAGE_TYPE=mongodb and MONGODB_URI
 * 
 * Environment Variables:
 * - USECASE_STORAGE_TYPE: "file" (default) or "mongodb"
 * - MONGODB_URI: MongoDB connection string (required if using MongoDB)
 * - USECASE_STORAGE_PATH: Path to JSON file (default: ./data/usecases.json)
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
  createdAt: string;
  updatedAt?: string;
}

// Storage configuration
const STORAGE_TYPE = process.env.USECASE_STORAGE_TYPE || "file";
const STORAGE_PATH = process.env.USECASE_STORAGE_PATH || path.join(process.cwd(), "data", "usecases.json");
const MONGODB_URI = process.env.MONGODB_URI;

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
 * MongoDB storage functions
 */
async function getMongoClient() {
  if (STORAGE_TYPE !== "mongodb") {
    throw new Error("MongoDB storage not configured");
  }

  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI environment variable is required for MongoDB storage");
  }

  try {
    // Dynamic import to avoid bundling MongoDB in client-side code
    // Only imports if MongoDB storage is actually used
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    return client;
  } catch (error: any) {
    if (error.code === "MODULE_NOT_FOUND" || error.message?.includes("mongodb")) {
      throw new Error(
        "MongoDB package not installed. Install it with: npm install mongodb"
      );
    }
    throw error;
  }
}

async function saveUseCaseToMongoDB(useCase: UseCase): Promise<void> {
  const client = await getMongoClient();
  try {
    const db = client.db();
    const collection = db.collection("usecases");
    await collection.insertOne(useCase);
  } finally {
    await client.close();
  }
}

async function updateUseCaseInMongoDB(id: string, useCase: Partial<UseCase>): Promise<void> {
  const client = await getMongoClient();
  try {
    const db = client.db();
    const collection = db.collection("usecases");
    await collection.updateOne(
      { id },
      { $set: { ...useCase, updatedAt: new Date().toISOString() } }
    );
  } finally {
    await client.close();
  }
}

async function getUseCasesFromMongoDB(): Promise<UseCase[]> {
  const client = await getMongoClient();
  try {
    const db = client.db();
    const collection = db.collection("usecases");
    const useCases = await collection.find({}).sort({ createdAt: -1 }).toArray();
    return useCases as UseCase[];
  } finally {
    await client.close();
  }
}

/**
 * Unified storage functions
 */
async function saveUseCase(useCase: UseCase): Promise<void> {
  if (STORAGE_TYPE === "mongodb") {
    await saveUseCaseToMongoDB(useCase);
  } else {
    // File-based storage (default)
    const useCases = await readUseCasesFromFile();
    useCases.push(useCase);
    await writeUseCasesToFile(useCases);
  }
}

async function getAllUseCases(): Promise<UseCase[]> {
  if (STORAGE_TYPE === "mongodb") {
    return await getUseCasesFromMongoDB();
  } else {
    // File-based storage (default)
    return await readUseCasesFromFile();
  }
}

async function updateUseCase(id: string, useCaseData: Partial<UseCaseData>): Promise<void> {
  if (STORAGE_TYPE === "mongodb") {
    await updateUseCaseInMongoDB(id, useCaseData);
  } else {
    // File-based storage (default)
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

export async function POST(request: NextRequest) {
  try {
    const body: UseCaseData = await request.json();

    // Validate required fields
    if (!body.title || !body.description || !body.prompt || !body.category) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (!body.expectedAgents || body.expectedAgents.length === 0) {
      return NextResponse.json(
        { error: "At least one agent must be specified" },
        { status: 400 }
      );
    }

    // Generate ID (in production, let database generate this)
    const id = `usecase-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create use case object
    const useCase: UseCase = {
      id,
      ...body,
      createdAt: new Date().toISOString(),
    };

    // Save to configured storage (file-based by default, MongoDB if configured)
    await saveUseCase(useCase);

    return NextResponse.json(
      {
        success: true,
        id,
        message: "Use case saved successfully",
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error saving use case:", error);
    return NextResponse.json(
      { error: "Failed to save use case" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/usecases
 * 
 * Retrieve all saved use cases from configured storage.
 */
export async function GET() {
  try {
    const useCases = await getAllUseCases();
    return NextResponse.json(useCases);
  } catch (error) {
    console.error("Error fetching use cases:", error);
    return NextResponse.json(
      { 
        error: "Failed to fetch use cases",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/usecases?id=<useCaseId>
 * 
 * Update an existing use case.
 */
export async function PUT(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Use case ID is required" },
        { status: 400 }
      );
    }

    const body: Partial<UseCaseData> = await request.json();

    // Validate that at least one field is provided
    if (Object.keys(body).length === 0) {
      return NextResponse.json(
        { error: "At least one field must be provided for update" },
        { status: 400 }
      );
    }

    // Validate required fields if provided
    if (body.expectedAgents !== undefined && (!body.expectedAgents || body.expectedAgents.length === 0)) {
      return NextResponse.json(
        { error: "At least one agent must be specified" },
        { status: 400 }
      );
    }

    // Check if use case exists
    const allUseCases = await getAllUseCases();
    const existingUseCase = allUseCases.find((uc) => uc.id === id);
    
    if (!existingUseCase) {
      return NextResponse.json(
        { error: "Use case not found" },
        { status: 404 }
      );
    }

    // Update use case
    await updateUseCase(id, body);

    return NextResponse.json(
      {
        success: true,
        id,
        message: "Use case updated successfully",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error updating use case:", error);
    return NextResponse.json(
      { 
        error: "Failed to update use case",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
