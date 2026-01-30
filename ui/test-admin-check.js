// Quick test to verify group checking logic
const REQUIRED_ADMIN_GROUP = "eti_sre_admin";

const members = [
  "eticloud-plg-root",
  "eti-obs-ro",
  "eti-gitlfs-ro",
  "eti-innersource-vault-admin",
  "eti-jira-udp",
  "eti-sre-admin",
  "eti-labs",
  "eti-vowel-vault-developer",
  "eticloud-preprod-root",
  "eti-tme",
  "eticloud-scratch-root",
  "eti-vowel-vault-admin",
  "eticloud-keeper-vault-admin",
  "eti-websites-vault-developer",
  "eti-websites-vault-admin",
  "eti_sre_devops",
  "eti-meissa-vault-admin",
  "eti-phoenix-vault-admin",
  "eti-sre",
  "eti-sre-all",
  "eti-stt",
  "eti.iam",
  "eti-appnet-vault-admin",
  "eticloud-root",
  "eti-appnet-vault-developer",
  "eti_sre_devhub_access",
  "eti_sre_p3_access",
  "eti-sre-admins",
  "eti-sre-ad-groups-admins",
  "eti-demo-labs-vault-admin",
  "eti-pypi",
  "eti_sre_admin_jenkins",
  "eti-sre-leads",
  "eticloud-plg-prod-root",
  "eti-flame-vault-admin",
  "eti-ci-root",
  "eti-gitlfs-rw",
  "eti-identity-vault-developer",
  "eti_sre_admin",
  "eti-banzai-vault-developer",
  "eticloud-scratch-c-root",
  "eti-ace-poc",
  "eti-obs-rw",
  "eticloud-scratch-b-root",
  "eti-banzai-vault-admin",
  "eti_sre_github",
  "eti-qentra-vault-admin",
  "eti-identity-vault-admin",
  "eticloud-demos-root",
  "eti_sre_p3_test_access",
  "eti-blackduck-users",
  "eticloud-preproduction-root",
  "eti-qentra-vault-developer",
  "eti-pypi-access"
];

function isAdminUser(groups) {
  if (!REQUIRED_ADMIN_GROUP) return false;
  
  return groups.some((group) => {
    const groupLower = group.toLowerCase();
    const adminGroupLower = REQUIRED_ADMIN_GROUP.toLowerCase();
    return groupLower === adminGroupLower || groupLower.includes(`cn=${adminGroupLower}`);
  });
}

console.log("Groups:", members);
console.log("Required admin group:", REQUIRED_ADMIN_GROUP);
console.log("Is admin?", isAdminUser(members));
console.log("\nMatching groups:");
members.forEach(g => {
  if (g.toLowerCase().includes('admin')) {
    console.log(`  - ${g} ${g.toLowerCase() === REQUIRED_ADMIN_GROUP.toLowerCase() ? '✅ MATCH!' : ''}`);
  }
});
