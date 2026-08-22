'use strict';

const RETAINED_MINORS = 3;

function compareVersionsDesc(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
  }
  return 0;
}

function minorKey(version) {
  return version.split('.').slice(0, 2).join('.');
}

function normalizeVersions(versions) {
  return [...new Set(versions)].sort(compareVersionsDesc);
}

function retainVersions(versions) {
  const byMinor = {};
  for (const version of normalizeVersions(versions)) {
    const minor = minorKey(version);
    (byMinor[minor] = byMinor[minor] || []).push(version);
  }

  const retainedMinors = Object.keys(byMinor)
    .sort((a, b) => compareVersionsDesc(`${a}.0`, `${b}.0`))
    .slice(0, RETAINED_MINORS);
  const retained = retainedMinors.map((minor) => byMinor[minor][0]);
  return normalizeVersions(retained);
}

function createVersionsConfig(versions) {
  const publishedVersions = normalizeVersions(versions);
  const latest = publishedVersions[0];
  const versionsBlock = {
    current: { label: 'Next', path: 'next', badge: true },
  };

  if (latest) {
    versionsBlock[latest] = { label: `${minorKey(latest)} (Latest)`, path: '', badge: false };
    for (const version of publishedVersions.slice(1)) {
      versionsBlock[version] = {
        label: minorKey(version),
        path: minorKey(version),
        badge: false,
      };
    }
  }

  return {
    lastVersion: latest || 'current',
    versions: versionsBlock,
  };
}

module.exports = {
  createVersionsConfig,
  normalizeVersions,
  retainVersions,
};
