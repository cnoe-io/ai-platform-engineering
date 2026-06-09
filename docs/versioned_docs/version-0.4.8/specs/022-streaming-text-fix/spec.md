---
sidebar_position: 2
sidebar_label: Specification
title: "2025-10-31: Streaming Text Chunking Fix"
---

# Streaming Text Chunking Fix

**Status**: 🟢 In-use
**Category**: Features & Enhancements
**Date**: October 31, 2025

## Motivation

When the agent streams responses, words were being split with extra spaces:

**Before:**
```
Looking up AWS Resources...I'll help you fin d the cost associated with the 'comn' EKS cluster.
Let me search for costs that include this cluster name in the usage details an d relate d expenses.
Let me try a different approach. I'll look for tag -based filtering that might include the cluster name:
Great ! I found evidence of the 'comn ' cluster through the Kubernetes cluster tag .
Now let me get costs associate d with this cluster using the tag filter :
Perfect! Now let me get a detaile d breakdown of the E K S- specific costs for the ' com n ' cluster :
```

**Issues:**
- "fin d" should be "find"
- "an d relate d" should be "and related"
- "tag -based" should be "tag-based"
- "associate d" should be "associated"
- "detaile d" should be "detailed"
- "E K S" should be "EKS"
- "com n" should be "comn"


## Root Cause

The streaming text accumulation logic in `AgentForgePage.tsx` was adding spaces between chunks unnecessarily. The "smart spacing" logic was trying to be helpful but was actually breaking words:

```javascript
// OLD CODE - INCORRECT
if (/[a-zA-Z0-9]/.test(lastChar) && /[a-zA-Z0-9]/.test(firstChar)) {
  if (!/[\s.,!?;:]/.test(firstChar)) {
    accumulatedText += ` ${cleanText}`;  // ❌ Adding space between chunks
  } else {
    accumulatedText += cleanText;
  }
} else {
  accumulatedText += cleanText;
}
```

When the server sends chunks like:
1. "fin"
2. "d the cost"

The old logic would detect:
- Last char of "fin" = "n" (alphanumeric)
- First char of "d the cost" = "d" (alphanumeric)
- Result: Add space → "fin d the cost" ❌


## Testing Strategy

To verify the fix:

1. Ask the agent a question that requires multiple streaming chunks
2. Watch for words that were previously split (like "find", "and", "related", "EKS")
3. Verify text appears correctly without extra spaces mid-word
4. Check that proper spacing between sentences is preserved


## Related Files

- `AgentForgePage.tsx` - Main streaming logic (FIXED)
- No other files needed changes


## Related

- Architecture: [architecture.md](./architecture.md)
