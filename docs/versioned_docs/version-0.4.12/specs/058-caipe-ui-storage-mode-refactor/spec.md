---
sidebar_position: 2
sidebar_label: Specification
title: "2026-01-30: Storage Mode Refactor - Exclusive Storage (No Hybrid)"
---

# Storage Mode Refactor - Exclusive Storage (No Hybrid)

## Summary

Refactored CAIPE UI from **hybrid storage** (MongoDB + localStorage simultaneously) to **exclusive storage mode** (MongoDB OR localStorage, never both).


## Motivation

**Before**: 
- App always used localStorage (via Zustand persist)
- Also synced to MongoDB if available
- Confusing dual-write behavior
- Users didn't know where their data lived
- Old conversations could be in localStorage, new ones in MongoDB

**After**:
- Clean separation: MongoDB XOR localStorage
- Storage mode determined by `MONGODB_URI` env variable
- No confusion about data location
- Clear UI indicators

---


## Benefits

### For Users
✅ **Clear data location** - No confusion about where conversations live
✅ **Predictable behavior** - One storage mode, not two
✅ **Visual indicators** - Always know what mode you're in
✅ **No surprises** - Data doesn't mysteriously appear/disappear

### For Developers
✅ **Simpler logic** - No dual-write complexity
✅ **Fewer bugs** - No sync race conditions
✅ **Easier testing** - Test one mode at a time
✅ **Better performance** - No unnecessary localStorage writes in MongoDB mode

### For Admins
✅ **MongoDB is source of truth** - No localStorage confusion
✅ **Better analytics** - All data in one place
✅ **Team features work** - Sharing, collaboration enabled

---


## Testing Strategy

### localStorage Mode
- [ ] Conversations persist in browser
- [ ] Conversations NOT sent to server
- [ ] Sidebar shows "Local Storage Mode"
- [ ] Admin features disabled
- [ ] Works without MongoDB configured

### MongoDB Mode
- [ ] Conversations saved to MongoDB
- [ ] localStorage NOT used for persistence
- [ ] Sidebar shows "MongoDB Mode"
- [ ] Admin features enabled
- [ ] Sharing/teams work

### Mode Switching
- [ ] localStorage → MongoDB: Data migrates cleanly
- [ ] MongoDB → localStorage: Graceful fallback
- [ ] No data loss
- [ ] Clear error messages

---


## Rollout Plan

### Phase 1: Internal Testing ✅ (Current)
- Test with dev team
- Verify both modes work
- Check migration paths

### Phase 2: Staged Rollout
- Enable for power users first
- Monitor for issues
- Gather feedback

### Phase 3: Full Deployment
- Update all environments
- Update documentation
- Train support team

---


## Support

### Common Issues

**Q: My conversations disappeared!**
A: Check storage mode. If you switched from MongoDB → localStorage, you need to re-enable MongoDB.

**Q: I see old conversations but not new ones**
A: You may have switched storage modes. Check `.env.local` and restart.

**Q: Can I use both at once?**
A: No. Exclusive storage mode prevents confusion.

---


## Related

- Architecture: [architecture.md](./architecture.md)
