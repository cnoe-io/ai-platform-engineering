# Use Case Storage Configuration

The Use Case Builder supports two storage backends for saving user-created use cases:

## Storage Options

### 1. File-based Storage (Default)

**Default option** - No configuration needed. Use cases are stored in a JSON file.

**Configuration:**
```bash
# In .env.local or environment variables
USECASE_STORAGE_TYPE=file
USECASE_STORAGE_PATH=./data/usecases.json  # Optional, defaults to ./data/usecases.json
```

**Pros:**
- No additional dependencies
- Easy to backup and version control
- Perfect for development and small deployments

**Cons:**
- Not suitable for production with multiple instances
- File-based, so not ideal for high concurrency

**File Location:**
- Default: `ui/data/usecases.json`
- The `data/` directory is automatically created if it doesn't exist
- Already added to `.gitignore` to prevent committing user data

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

**Pros:**
- Production-ready
- Supports multiple instances
- Better for concurrent access
- Scalable

**Cons:**
- Requires MongoDB installation
- Additional dependency

**Database Structure:**
- Collection name: `usecases`
- Documents include: `id`, `title`, `description`, `category`, `tags`, `prompt`, `expectedAgents`, `difficulty`, `createdAt`

## Switching Storage Types

1. **From File to MongoDB:**
   ```bash
   # 1. Install MongoDB package
   npm install mongodb
   
   # 2. Set environment variables
   export USECASE_STORAGE_TYPE=mongodb
   export MONGODB_URI=mongodb://localhost:27017/caipe
   
   # 3. (Optional) Migrate existing data from file to MongoDB
   # You can write a migration script or manually import the JSON file
   ```

2. **From MongoDB to File:**
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

## API Endpoints

- **POST `/api/usecases`** - Save a new use case
- **GET `/api/usecases`** - Retrieve all saved use cases

Both endpoints automatically use the configured storage backend.

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
