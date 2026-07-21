const crypto = require('node:crypto');
const AdmZip = require('adm-zip');

const PROFILE_SCHEMA_VERSION = '0.2';
const PROJECT_SCHEMA_VERSION = '0.2';
const MAX_JSON_BYTES = 50 * 1024 * 1024;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 형식이 올바르지 않습니다.`);
  return value;
}

function schemaVersion(value) {
  return String(value?.schemaVersion || '0.1');
}

function migrateProfile(input) {
  const raw = object(input, '프로필');
  const from = schemaVersion(raw);
  if (from === PROFILE_SCHEMA_VERSION) {
    if (raw.kind !== 'iceprofile') throw new Error('v0.2 프로필의 kind는 iceprofile이어야 합니다.');
    object(raw.profile, '프로필 본문');
    return { value: clone(raw), migratedFrom: null };
  }
  if (from !== '0.1') throw new Error(`지원하지 않는 프로필 스키마입니다: ${from}`);

  const agencyId = raw.agencyId || raw.profile?.agencyId || 'metropolitan';
  const customBranding = clone(raw.customBranding || raw.profile?.customBranding || {});
  const known = new Set(['schemaVersion', 'agencyId', 'customBranding', 'profile', 'id', 'label', 'displayName', 'department', 'coverProfile']);
  const legacy = Object.fromEntries(Object.entries(raw).filter(([key]) => !known.has(key)));
  return {
    migratedFrom: '0.1',
    value: {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      kind: 'iceprofile',
      profile: {
        id: raw.id || `profile-${agencyId}`,
        label: raw.label || `${agencyId} 프로필`,
        baseAgencyId: agencyId,
        organization: {
          displayName: raw.displayName || raw.profile?.displayName || null,
          department: raw.department || raw.profile?.department || null,
        },
        branding: { customByAgency: customBranding },
        layout: { coverProfile: raw.coverProfile || raw.profile?.coverProfile || null },
        extensions: Object.keys(legacy).length ? { legacy } : {},
      },
    },
  };
}

function blockOriginal(block) {
  if (block.type === 'table') {
    const rows = block.table?.cells?.map((row) => row.map((cell) => cell.text))
      || [block.header || [], ...(block.rows || [])];
    return rows.map((row) => row.join('|')).join('\n');
  }
  return String(block.text ?? block.image?.filename ?? '');
}

function migrateTable(block) {
  if (block.table?.cells) return clone(block.table);
  const rows = [block.header || [], ...(block.rows || [])];
  return {
    rowCnt: rows.length,
    colCnt: Math.max(0, ...rows.map((row) => row.length)),
    cells: rows.map((row, rowIndex) => row.map((cell) => ({
      text: String(cell ?? ''),
      rowSpan: 1,
      colSpan: 1,
      isHeader: rowIndex === 0,
    }))),
    repeatHeader: block.layout?.repeatHeader !== false,
    treatAsChar: block.layout?.treatAsChar === true,
  };
}

function migratePlanIR(input) {
  if (input == null) return null;
  const raw = object(input, '문서 모델');
  if (schemaVersion(raw) === '0.2' && raw.kind === 'plan-ir') return clone(raw);
  if (schemaVersion(raw) !== '0.1') throw new Error(`지원하지 않는 문서 모델 스키마입니다: ${schemaVersion(raw)}`);
  const sourceFormat = raw.source?.format || 'iceplan-v0.1';
  const sourceFilePath = raw.source?.filePath || null;
  const blocks = (raw.blocks || []).map((block, index) => {
    const next = {
      ...clone(block),
      id: block.id || `legacy-block-${String(index + 1).padStart(4, '0')}`,
      role: block.role || ({ heading: 'heading', paragraph: 'body', listItem: 'list', table: 'table', image: 'image' }[block.type] || 'body'),
      source: clone(block.source) || {
        format: sourceFormat,
        filePath: sourceFilePath,
        blockIndex: index,
        original: blockOriginal(block),
      },
    };
    if (block.type === 'table') {
      next.table = migrateTable(block);
      next.header = next.table.cells[0]?.map((cell) => cell.text) || [];
      next.rows = next.table.cells.slice(1).map((row) => row.map((cell) => cell.text));
      next.layout = { repeatHeader: next.table.repeatHeader, treatAsChar: next.table.treatAsChar };
    }
    return next;
  });
  const metadata = clone(raw.metadata || {});
  const pageTypes = clone(raw.pageTypes || metadata.pages?.map((page) => page.type).filter(Boolean) || []);
  return {
    ...clone(raw),
    schemaVersion: '0.2',
    kind: 'plan-ir',
    metadata,
    source: clone(raw.source) || { format: sourceFormat, filePath: sourceFilePath },
    approval: clone(raw.approval) || { status: 'unapproved' },
    pageTypes,
    diagnostics: clone(raw.diagnostics || []),
    blocks,
  };
}

function migrateProject(input) {
  const raw = object(input, '프로젝트');
  if (raw.project?.schemaVersion === PROJECT_SCHEMA_VERSION && raw.project.kind === 'iceplan') {
    const profileResult = migrateProfile(raw.profile || { schemaVersion: '0.1', agencyId: raw.project.settings?.agencyId });
    return {
      migratedFrom: null,
      value: {
        project: clone(raw.project),
        document: migratePlanIR(raw.document),
        profile: profileResult.value,
        validation: clone(raw.validation || {}),
        history: clone(raw.history || { snapshots: [] }),
      },
    };
  }

  const from = schemaVersion(raw);
  if (from !== '0.1') throw new Error(`지원하지 않는 프로젝트 스키마입니다: ${from}`);
  const document = migratePlanIR(raw.model || raw.loadedModel || raw.document || null);
  const profileResult = migrateProfile({
    schemaVersion: '0.1',
    agencyId: raw.agencyId || 'metropolitan',
    customBranding: raw.customBranding || {},
  });
  const workflow = clone(raw.workflow || {
    activeStep: raw.activeStep ?? (document ? 1 : 0),
    analysisConfirmed: Boolean(raw.analysisConfirmed),
    infoDraft: raw.infoDraft || { title: document?.metadata?.title || '', date: document?.metadata?.cover?.date || '' },
    infoConfirmed: Boolean(raw.infoConfirmed),
    pageDrafts: raw.pageDrafts || [],
    rulesConfirmed: Boolean(raw.rulesConfirmed),
    ignoredRuleIds: raw.ignoredRuleIds || [],
  });
  return {
    migratedFrom: '0.1',
    value: {
      project: {
        schemaVersion: PROJECT_SCHEMA_VERSION,
        kind: 'iceplan',
        metadata: { loadedFile: raw.loadedFile || raw.file || '', title: document?.metadata?.title || '' },
        workflow,
        view: clone(raw.view || { page: raw.page || 1, zoom: raw.zoom || 75, previewMode: raw.previewMode || 'react' }),
        settings: clone(raw.settings || { agencyId: raw.agencyId || 'metropolitan', resolution: raw.resolution || null, currentWidth: raw.currentWidth || null }),
      },
      document,
      profile: profileResult.value,
      validation: clone(raw.validation || { approval: document?.approval || { status: 'unapproved' }, ignoredRuleIds: workflow.ignoredRuleIds || [] }),
      history: clone(raw.history || { snapshots: [] }),
    },
  };
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function addJson(zip, name, value, manifest) {
  const data = jsonBuffer(value);
  zip.addFile(name, data);
  manifest.push({ path: name, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') });
}

function finalizeArchive(zip, kind, entries) {
  addJson(zip, 'manifest.json', { schemaVersion: '0.2', kind, entries }, []);
  return zip.toBuffer();
}

function createProfileArchive(input) {
  const migrated = migrateProfile(input);
  const zip = new AdmZip();
  const entries = [];
  addJson(zip, 'profile.json', migrated.value, entries);
  addJson(zip, 'assets/manifest.json', { schemaVersion: '0.2', assets: [] }, entries);
  return { buffer: finalizeArchive(zip, 'iceprofile', entries), profile: migrated.value, migratedFrom: migrated.migratedFrom };
}

function createProjectArchive(input) {
  const migrated = migrateProject(input);
  const zip = new AdmZip();
  const entries = [];
  addJson(zip, 'project.json', migrated.value.project, entries);
  addJson(zip, 'document.json', migrated.value.document, entries);
  addJson(zip, 'profile/profile.json', migrated.value.profile, entries);
  addJson(zip, 'assets/manifest.json', { schemaVersion: '0.2', assets: [] }, entries);
  addJson(zip, 'history/index.json', migrated.value.history, entries);
  addJson(zip, 'validation/latest.json', migrated.value.validation, entries);
  return { buffer: finalizeArchive(zip, 'iceplan', entries), project: migrated.value, migratedFrom: migrated.migratedFrom };
}

function readJsonEntry(zip, name) {
  const entry = zip.getEntry(name);
  if (!entry) throw new Error(`패키지 필수 항목이 없습니다: ${name}`);
  const data = entry.getData();
  if (data.length > MAX_JSON_BYTES) throw new Error(`패키지 항목이 너무 큽니다: ${name}`);
  return JSON.parse(data.toString('utf8'));
}

function openArchive(buffer) {
  const zip = new AdmZip(buffer);
  for (const entry of zip.getEntries()) {
    const name = entry.entryName.replace(/\\/g, '/');
    if (name.startsWith('/') || name.split('/').includes('..')) throw new Error(`안전하지 않은 패키지 경로입니다: ${entry.entryName}`);
  }
  return zip;
}

function looksLikeJson(buffer) {
  return buffer.toString('utf8', 0, Math.min(buffer.length, 128)).trimStart().startsWith('{');
}

function readProfileArchive(buffer) {
  if (looksLikeJson(buffer)) {
    const migrated = migrateProfile(JSON.parse(buffer.toString('utf8')));
    return { profile: migrated.value, migratedFrom: migrated.migratedFrom, format: 'legacy-json' };
  }
  const zip = openArchive(buffer);
  const migrated = migrateProfile(readJsonEntry(zip, 'profile.json'));
  return { profile: migrated.value, migratedFrom: migrated.migratedFrom, format: 'zip' };
}

function readProjectArchive(buffer) {
  if (looksLikeJson(buffer)) {
    const migrated = migrateProject(JSON.parse(buffer.toString('utf8')));
    return { project: migrated.value, migratedFrom: migrated.migratedFrom, format: 'legacy-json' };
  }
  const zip = openArchive(buffer);
  const migrated = migrateProject({
    project: readJsonEntry(zip, 'project.json'),
    document: readJsonEntry(zip, 'document.json'),
    profile: readJsonEntry(zip, 'profile/profile.json'),
    validation: readJsonEntry(zip, 'validation/latest.json'),
    history: readJsonEntry(zip, 'history/index.json'),
  });
  return { project: migrated.value, migratedFrom: migrated.migratedFrom, format: 'zip' };
}

module.exports = {
  PROFILE_SCHEMA_VERSION,
  PROJECT_SCHEMA_VERSION,
  createProfileArchive,
  createProjectArchive,
  migratePlanIR,
  migrateProfile,
  migrateProject,
  readProfileArchive,
  readProjectArchive,
};
