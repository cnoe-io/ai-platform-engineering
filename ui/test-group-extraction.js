// Test group extraction logic with Duo SSO profile
const DEFAULT_GROUP_CLAIMS = ["members", "memberOf", "groups", "group", "roles", "cognito:groups"];

const duoProfile = {
  "groups": "caipe-users",  // STRING
  "members": [  // ARRAY
    "caipe-admins",
    "platform-observers",
    "platform-operators",
    "platform-sre",
    // ... more groups
  ]
};

function extractGroups(profile) {
  const allGroups = new Set();

  // Check ALL common group claim names and combine them
  for (const claim of DEFAULT_GROUP_CLAIMS) {
    const value = profile[claim];
    if (Array.isArray(value)) {
      value.forEach(g => allGroups.add(g));
    } else if (typeof value === "string") {
      value.split(/[,\s]+/).filter(Boolean).forEach(g => allGroups.add(g));
    }
  }

  return Array.from(allGroups);
}

const extractedGroups = extractGroups(duoProfile);

console.log("Extracted groups:", extractedGroups);
console.log("\nChecking required groups:");
console.log("  Has 'caipe-users'?", extractedGroups.includes("caipe-users"));
console.log("  Has 'caipe-admins'?", extractedGroups.includes("caipe-admins"));
console.log("\nTotal groups extracted:", extractedGroups.length);
