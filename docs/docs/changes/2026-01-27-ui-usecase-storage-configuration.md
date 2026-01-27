# ADR: Use Case Storage Configuration for CAIPE UI

**Status**: 🟢 In-use  
**Category**: Architecture & Design  
**Date**: January 27, 2026  
**Signed-off-by**: Sri Aradhyula &lt;sraradhy@cisco.com&gt;

## Overview / Summary

The CAIPE UI Use Case Builder supports two pluggable storage backends for saving user-created use cases: file-based storage (default) and MongoDB (optional). This design allows developers to use a lightweight file-based approach during development and easily switch to MongoDB for production deployments with multiple instances and concurrent access requirements.

## Problem / Problem Statement

The Use Case Builder needed a storage solution that would:
1. **Be simple for local development** - No dependencies required for developers to get started
2. **Scale for production** - Support multiple UI instances with concurrent writes
3. **Be configurable via environment variables** - Easy deployment without code changes
4. **Support data persistence** - Use cases must survive container restarts

Without a configurable storage backend, we would be forced to either:
- Require MongoDB for all deployments (complex dev setup)
- Use only file storage (doesn't scale for production)

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

## Benefits

1. **Developer Experience**: Developers can start immediately without installing MongoDB
2. **Production Ready**: Easy switch to MongoDB for production deployments
3. **Flexibility**: Choose the right storage for your deployment scenario
4. **No Code Changes**: Switch storage via environment variables only
5. **Data Portability**: Can export from file storage and import to MongoDB

## Testing / Verification

### Manual Testing - File Storage

```bash
# 1. Configure file storage (default)
echo "USECASE_STORAGE_TYPE=file" > ui/.env.local

# 2. Start UI
cd ui && npm run dev

# 3. Create a use case via UI
# Visit http://localhost:3000/usecases/builder

# 4. Verify file created
cat ui/data/usecases.json
```

### Manual Testing - MongoDB Storage

```bash
# 1. Start MongoDB
docker run -d -p 27017:27017 --name mongodb mongo:latest

# 2. Configure MongoDB storage
echo "USECASE_STORAGE_TYPE=mongodb" > ui/.env.local
echo "MONGODB_URI=mongodb://localhost:27017/caipe" >> ui/.env.local

# 3. Install MongoDB client
cd ui && npm install mongodb

# 4. Start UI
npm run dev

# 5. Create a use case via UI
# Visit http://localhost:3000/usecases/builder

# 6. Verify in MongoDB
mongosh caipe --eval "db.usecases.find().pretty()"
```

### Migration Between Backends

**From File to MongoDB:**
```bash
# 1. Install MongoDB package
npm install mongodb

# 2. Set environment variables
export USECASE_STORAGE_TYPE=mongodb
export MONGODB_URI=mongodb://localhost:27017/caipe

# 3. (Optional) Migrate existing data from file to MongoDB
# You can write a migration script or manually import the JSON file
```

**From MongoDB to File:**
```bash
# 1. Export data from MongoDB (optional)
mongodump --uri="mongodb://localhost:27017/caipe" --collection=usecases

# 2. Set environment variables
export USECASE_STORAGE_TYPE=file
# or remove USECASE_STORAGE_TYPE to use default

# 3. Restart the application
```

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

## Related Documentation

- [CAIPE UI Configuration Guide](../ui/configuration.md)
- [CAIPE UI Development Guide](../ui/development.md)
- [CAIPE UI Troubleshooting](../ui/troubleshooting.md)
- [MongoDB Documentation](https://www.mongodb.com/docs/)
- [Next.js Environment Variables](https://nextjs.org/docs/pages/building-your-application/configuring/environment-variables)

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
