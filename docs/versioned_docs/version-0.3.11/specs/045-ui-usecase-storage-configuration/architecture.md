---
sidebar_position: 1
id: 045-ui-usecase-storage-configuration-architecture
sidebar_label: Architecture
---

# Architecture: ADR: Use Case Storage Configuration for CAIPE UI

**Date**: 2026-01-27

## Solution / Solution Design / Implementation

### Storage Backend Interface

Implemented a plugin-based storage backend that can be switched via environment variables:

```typescript
// File: ui/src/app/api/usecases/route.ts

// Storage type selection based on environment variable
const storageType = process.env.USECASE_STORAGE_TYPE || 'file';

// Dynamic storage backend loading
const storage = storageType === 'mongodb'
  ? new MongoDBStorage(process.env.MONGODB_URI)
  : new FileStorage(process.env.USECASE_STORAGE_PATH);
```

### 1. File-based Storage (Default)

**Default option** - No configuration needed. Use cases stored in JSON file.

**Configuration:**
```bash
# In .env.local or environment variables
USECASE_STORAGE_TYPE=file
USECASE_STORAGE_PATH=./data/usecases.json  # Optional, defaults to ./data/usecases.json
```

**Implementation:**
- Default: `ui/data/usecases.json`
- The `data/` directory is automatically created if it doesn't exist
- Already added to `.gitignore` to prevent committing user data

**Pros:**
- No additional dependencies
- Easy to backup and version control
- Perfect for development and small deployments

**Cons:**
- Not suitable for production with multiple instances
- File-based, so not ideal for high concurrency

### 2. MongoDB Storage (Optional)

**For production deployments** - Requires MongoDB installation and configuration.

**Configuration:**
```bash
# In .env.local or environment variables
USECASE_STORAGE_TYPE=mongodb
MONGODB_URI=mongodb://localhost:27017/caipe
```

**Installation:**
```bash
npm install mongodb
```

**MongoDB URI Examples:**
```bash
# Local MongoDB
MONGODB_URI=mongodb://localhost:27017/caipe

# MongoDB with authentication
MONGODB_URI=mongodb://username:password@localhost:27017/caipe?authSource=admin

# MongoDB Atlas (cloud)
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/caipe?retryWrites=true&w=majority
```

**Database Structure:**
- Collection name: `usecases`
- Documents include: `id`, `title`, `description`, `category`, `tags`, `prompt`, `expectedAgents`, `difficulty`, `createdAt`

**Pros:**
- Production-ready
- Supports multiple instances
- Better for concurrent access
- Scalable

**Cons:**
- Requires MongoDB installation
- Additional dependency

### API Endpoints

Both storage backends work through the same API interface:

- **POST `/api/usecases`** - Save a new use case
- **GET `/api/usecases`** - Retrieve all saved use cases

Both endpoints automatically use the configured storage backend.


## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `USECASE_STORAGE_TYPE` | `file` | Storage backend: `file` or `mongodb` |
| `USECASE_STORAGE_PATH` | `./data/usecases.json` | Path to JSON file (file storage only) |
| `MONGODB_URI` | - | MongoDB connection string (MongoDB storage only) |


## Troubleshooting

### MongoDB Not Found Error
If you see "MongoDB package not installed", install it:
```bash
npm install mongodb
```

### File Permission Errors
Ensure the application has write permissions to the `data/` directory:
```bash
mkdir -p ui/data
chmod 755 ui/data
```

### MongoDB Connection Errors
- Verify MongoDB is running: `mongosh --eval "db.adminCommand('ping')"`
- Check connection string format
- Verify network access and firewall rules
- Check authentication credentials if using auth


## Files Modified

- `ui/src/app/api/usecases/route.ts` - Storage backend selection and API endpoints
- `ui/.env.example` - Example environment variables
- `ui/.gitignore` - Added `data/` directory to ignore user data
- `ui/package.json` - MongoDB as optional peer dependency


## Verification

Code analysis confirms this feature is **actively in use**:
- ✅ Storage backend selection implemented in `ui/src/app/api/usecases/route.ts`
- ✅ File storage works by default (no configuration needed)
- ✅ MongoDB storage works when configured
- ✅ Environment variables documented in `ui/env.example`
- ✅ `.gitignore` includes `data/` directory
- ✅ API endpoints tested manually with both backends
- ✅ Feature deployed in CAIPE UI production builds

---


## Related

- Spec: [spec.md](./spec.md)
