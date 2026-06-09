---
sidebar_position: 1
id: 022-streaming-text-fix-architecture
sidebar_label: Architecture
---

# Architecture: Streaming Text Chunking Fix

**Date**: 2025-10-31

## Solution

Removed the "smart spacing" logic and just concatenate chunks directly:

```javascript
// NEW CODE - CORRECT
} else {
  // Append to existing text - direct concatenation
  // The server sends properly chunked text, just concatenate without adding spaces
  console.log('APPENDING to existing text (direct concat)');
  accumulatedText += cleanText;
}
```

**After:**
```
Looking up AWS Resources...I'll help you find the cost associated with the 'comn' EKS cluster.
Let me search for costs that include this cluster name in the usage details and related expenses.
Let me try a different approach. I'll look for tag-based filtering that might include the cluster name:
Great! I found evidence of the 'comn' cluster through the Kubernetes cluster tag.
Now let me get costs associated with this cluster using the tag filter:
Perfect! Now let me get a detailed breakdown of the EKS-specific costs for the 'comn' cluster:
```


## Technical Details

### Location
**File:** `workspaces/agent-forge/plugins/agent-forge/src/components/AgentForgePage.tsx`
**Lines:** ~1907-1912

### The Fix
```diff
- } else {
-   // Append to existing text with smart spacing
-   console.log('APPENDING to existing text');
-
-   // Add spacing logic to prevent words from running together
-   if (accumulatedText && cleanText) {
-     const lastChar = accumulatedText.slice(-1);
-     const firstChar = cleanText.slice(0, 1);
-
-     // Add space if both are alphanumeric and no space exists
-     if (/[a-zA-Z0-9]/.test(lastChar) && /[a-zA-Z0-9]/.test(firstChar)) {
-       // Don't add space if the new text already starts with punctuation or whitespace
-       if (!/[\s.,!?;:]/.test(firstChar)) {
-         accumulatedText += ` ${cleanText}`;
-       } else {
-         accumulatedText += cleanText;
-       }
-     } else {
-       accumulatedText += cleanText;
-     }
-   } else {
-     accumulatedText += cleanText;
-   }
- }

+ } else {
+   // Append to existing text - direct concatenation
+   // The server sends properly chunked text, just concatenate without adding spaces
+   console.log('APPENDING to existing text (direct concat)');
+   accumulatedText += cleanText;
+ }
```

### Why This Works

1. **Server Responsibility**: The server (agent) is responsible for sending properly formatted text chunks
2. **Chunk Boundaries**: Text chunks may split at any character position, not just word boundaries
3. **Preserve Integrity**: Client should preserve the exact text as received, not modify spacing
4. **Simple is Better**: Direct concatenation is simpler and more reliable than trying to guess spacing


## Impact

- ✅ Words no longer split mid-character
- ✅ Natural reading flow restored
- ✅ Proper spacing preserved
- ✅ Simpler, more maintainable code
- ✅ No impact on non-streaming responses


## Notes

The "smart spacing" logic was originally added to handle cases where chunks might not have proper spacing. However, in practice:
- The SSE stream from the server already includes proper spacing
- Text chunks can split at any UTF-8 character boundary
- Adding spaces based on character type creates more problems than it solves
- Direct concatenation is the correct approach for SSE text streaming



## Related

- Spec: [spec.md](./spec.md)
