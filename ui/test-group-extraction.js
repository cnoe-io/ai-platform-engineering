// Test group extraction logic with Duo SSO profile
const DEFAULT_GROUP_CLAIMS = ["members", "memberOf", "groups", "group", "roles", "cognito:groups"];

const duoProfile = {
  "groups": "backstage-access",  // STRING
  "members": [  // ARRAY
    "eticloud-plg-root",
    "eti-obs-ro",
    "eti_sre_admin",
    "eti-sre",
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
console.log("  Has 'backstage-access'?", extractedGroups.includes("backstage-access"));
console.log("  Has 'eti_sre_admin'?", extractedGroups.includes("eti_sre_admin"));
console.log("\nTotal groups extracted:", extractedGroups.length);
