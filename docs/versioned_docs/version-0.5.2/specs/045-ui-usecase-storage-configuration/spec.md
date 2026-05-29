---
sidebar_position: 2
sidebar_label: Specification
title: "2026-01-27: ADR: Use Case Storage Configuration for CAIPE UI"
---

# ADR: Use Case Storage Configuration for CAIPE UI

**Status**: 🟢 In-use
**Category**: Architecture & Design
**Date**: January 27, 2026
**Signed-off-by**: Sri Aradhyula &lt;sraradhy@cisco.com&gt;

## Overview

The CAIPE UI Use Case Builder supports two pluggable storage backends for saving user-created use cases: file-based storage (default) and MongoDB (optional). This design allows developers to use a lightweight file-based approach during development and easily switch to MongoDB for production deployments with multiple instances and concurrent access requirements.


## Motivation

The Use Case Builder needed a storage solution that would:
1. **Be simple for local development** - No dependencies required for developers to get started
2. **Scale for production** - Support multiple UI instances with concurrent writes
3. **Be configurable via environment variables** - Easy deployment without code changes
4. **Support data persistence** - Use cases must survive container restarts

Without a configurable storage backend, we would be forced to either:
- Require MongoDB for all deployments (complex dev setup)
- Use only file storage (doesn't scale for production)


## Benefits

1. **Developer Experience**: Developers can start immediately without installing MongoDB
2. **Production Ready**: Easy switch to MongoDB for production deployments
3. **Flexibility**: Choose the right storage for your deployment scenario
4. **No Code Changes**: Switch storage via environment variables only
5. **Data Portability**: Can export from file storage and import to MongoDB


## Testing Strategy

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


## Related

- [CAIPE UI Configuration Guide](../../ui/configuration)
- [CAIPE UI Development Guide](../../ui/development)
- [CAIPE UI Troubleshooting](../../ui/troubleshooting)
- [MongoDB Documentation](https://www.mongodb.com/docs/)
- [Next.js Environment Variables](https://nextjs.org/docs/pages/building-your-application/configuring/environment-variables)


- Architecture: [architecture.md](./architecture.md)
