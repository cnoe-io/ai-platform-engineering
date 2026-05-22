---
sidebar_position: 2
sidebar_label: Specification
title: "2026-01-30: Storage Modes - CAIPE UI"
---

# Storage Modes - CAIPE UI

## Overview

CAIPE UI uses **exclusive storage modes** - MongoDB OR localStorage, never both simultaneously.


## Testing Strategy

### Test localStorage Mode

```bash
cd ui
# Don't set MONGODB_URI
npm run dev
```

### Test MongoDB Mode

```bash
cd ui
# Set in .env.local
echo "MONGODB_URI=mongodb://localhost:27017" >> .env.local
echo "MONGODB_DATABASE=caipe" >> .env.local
npm run dev
```

---


## FAQ

**Q: Can I use both MongoDB and localStorage simultaneously?**
A: No. The app uses exclusive storage mode to avoid confusion.

**Q: What happens to my localStorage conversations when I enable MongoDB?**
A: They remain in localStorage but won't be used. Use migration API to transfer them.

**Q: Can I switch between modes without losing data?**
A: 
- localStorage → MongoDB: Use migration API
- MongoDB → localStorage: Export data first

**Q: How do I know which mode I'm in?**
A: Check the sidebar indicator or server startup logs:
```
📦 Storage Mode: mongodb
   ✅ MongoDB configured - using persistent storage
```

---


## Best Practices

### Development
- Use **localStorage mode** for quick iteration
- No database setup required
- Fast startup

### Production
- Use **MongoDB mode** for persistence
- Enable team features
- Admin analytics

### Testing
- Test both modes in CI/CD
- Verify exclusive behavior
- Check migration paths


## Related

- Architecture: [architecture.md](./architecture.md)
