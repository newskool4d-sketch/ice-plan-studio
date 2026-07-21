#!/usr/bin/env node
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const {
  createProfileArchive,
  createProjectArchive,
  readProfileArchive,
  readProjectArchive,
} = require('../electron/workspace-packages.cjs');

const legacyProfile = {
  schemaVersion: '0.1',
  agencyId: 'direct',
  customBranding: { direct: { ci: 'data:image/png;base64,AA==' } },
};
const legacyProfileText = JSON.stringify(legacyProfile);
const migratedProfile = readProfileArchive(Buffer.from(legacyProfileText, 'utf8'));
assert.equal(migratedProfile.migratedFrom, '0.1');
assert.equal(migratedProfile.profile.schemaVersion, '0.2');
assert.equal(migratedProfile.profile.profile.baseAgencyId, 'direct');
assert.equal(JSON.stringify(legacyProfile), legacyProfileText, 'profile migration must not mutate legacy input');

const profileArchive = createProfileArchive(migratedProfile.profile);
const profileEntries = new AdmZip(profileArchive.buffer).getEntries().map((entry) => entry.entryName).sort();
assert.deepEqual(profileEntries, ['assets/manifest.json', 'manifest.json', 'profile.json']);
const profileRoundTrip = readProfileArchive(profileArchive.buffer);
assert.deepEqual(profileRoundTrip.profile, migratedProfile.profile);
assert.equal(profileRoundTrip.format, 'zip');

const legacyProject = {
  schemaVersion: '0.1',
  loadedFile: '기존계획.md',
  agencyId: 'metropolitan',
  resolution: 'width-only',
  currentWidth: 160,
  loadedModel: {
    schemaVersion: '0.1',
    metadata: { title: '기존 계획', pages: [{ type: 'cover' }, { type: 'body' }] },
    blocks: [
      { type: 'heading', level: 1, text: '기존 계획' },
      { type: 'table', header: ['구분', '내용'], rows: [['일정', '2026. 7.']] },
    ],
  },
};
const legacyProjectText = JSON.stringify(legacyProject);
const migratedProject = readProjectArchive(Buffer.from(legacyProjectText, 'utf8'));
assert.equal(migratedProject.migratedFrom, '0.1');
assert.equal(migratedProject.project.project.schemaVersion, '0.2');
assert.equal(migratedProject.project.document.schemaVersion, '0.2');
assert.equal(migratedProject.project.document.kind, 'plan-ir');
assert.equal(migratedProject.project.document.blocks[1].table.rowCnt, 2);
assert.equal(migratedProject.project.document.blocks[0].source.original, '기존 계획');
assert.equal(JSON.stringify(legacyProject), legacyProjectText, 'project migration must not mutate legacy input');

const projectArchive = createProjectArchive(migratedProject.project);
const projectEntries = new AdmZip(projectArchive.buffer).getEntries().map((entry) => entry.entryName).sort();
assert.deepEqual(projectEntries, [
  'assets/manifest.json',
  'document.json',
  'history/index.json',
  'manifest.json',
  'profile/profile.json',
  'project.json',
  'validation/latest.json',
]);
const projectRoundTrip = readProjectArchive(projectArchive.buffer);
assert.deepEqual(projectRoundTrip.project, migratedProject.project);
assert.equal(projectRoundTrip.format, 'zip');
assert.throws(() => readProfileArchive(Buffer.from('{"schemaVersion":"9.9"}', 'utf8')), /지원하지 않는 프로필 스키마/);

console.log(JSON.stringify({
  gate: 'workspace-package-migration',
  profile: { migratedFrom: migratedProfile.migratedFrom, entries: profileEntries, roundTrip: true },
  project: { migratedFrom: migratedProject.migratedFrom, entries: projectEntries, roundTrip: true },
  sourceUnchanged: JSON.stringify(legacyProfile) === legacyProfileText && JSON.stringify(legacyProject) === legacyProjectText,
  passed: true,
}, null, 2));
