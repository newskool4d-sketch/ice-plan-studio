// 인천광역시교육청 기관 레지스트리 (IMPROVEMENT_PLAN 7단계)
//
// 구조: 평면 dict(agencyProfiles[id]) — 기존 소비처의 직접 조회를 그대로 유지.
//       유형 그룹(agencyGroups)은 UI 선택기용으로 파생.
//
// 기관명은 사용자 제공 목록(2026-07-21, 각 기관 공식 홈페이지)이 정본이다.
// 특이사항(3자 검토 반영):
//   - "인천광역시동아시아국제교육원"만 '교육청'이 들어가지 않는 명칭
//   - 영종·검단 교육지원청은 2027. 3. 1. 개청 예정(activeFrom) — 개청 전 "(가칭)" 라벨
//   - 학교지원단은 직속기관으로 분류(사용자 목록 기준)
//
// 브랜딩(하이브리드): ci/slogan은 현재 본청 자산 폴백. 기관 자체 CI·슬로건은
//   .iceprofile(branding.customByAgency) 교체 또는 자산 수집 후 반영 예정.
//   슬로건 문구는 사용자가 이후 별도 업데이트(현재 값 임의 생성 금지).
//
// coverProfile(3자 검토 §4.2): 교육지원청·도서관 레퍼런스 미확보 →
//   확보 전까지 본청 A 임시 재사용. 직속기관은 실측된 direct-g 기본,
//   학생교육원=direct-g / 평생학습관=direct-f는 확정.

const DEFAULT_CI = './branding/incheon-ci.png';
const DEFAULT_SLOGAN_ASSET = './branding/incheon-slogan.png';
const SLOGAN_PLACEHOLDER = '기관별 슬로건을 설정하세요';

function agency(entry) {
  return {
    englishName: null,
    slogan: SLOGAN_PLACEHOLDER,
    ci: DEFAULT_CI,
    sloganAsset: DEFAULT_SLOGAN_ASSET,
    activeFrom: null,
    ...entry,
  };
}

// ── 본청 ────────────────────────────────────────────────────────────────
const HEADQUARTERS = [
  agency({
    id: 'metropolitan', type: 'metropolitan',
    label: '인천광역시교육청 본청', displayName: '인천광역시교육청',
    coverProfile: 'metropolitan-a',
    slogan: '함께 가는 인천교육, 세계로 나아가는 인천교육',
  }),
];

// ── 교육지원청 7종 (인천광역시○○교육지원청) ─────────────────────────────
const DISTRICTS = [
  agency({ id: 'district-nambu', type: 'district', label: '남부교육지원청', displayName: '인천광역시남부교육지원청', coverProfile: 'metropolitan-a' }),
  agency({ id: 'district-bukbu', type: 'district', label: '북부교육지원청', displayName: '인천광역시북부교육지원청', coverProfile: 'metropolitan-a' }),
  agency({ id: 'district-dongbu', type: 'district', label: '동부교육지원청', displayName: '인천광역시동부교육지원청', coverProfile: 'metropolitan-a' }),
  agency({ id: 'district-seobu', type: 'district', label: '서부교육지원청', displayName: '인천광역시서부교육지원청', coverProfile: 'metropolitan-a' }),
  agency({ id: 'district-ganghwa', type: 'district', label: '강화교육지원청', displayName: '인천광역시강화교육지원청', coverProfile: 'metropolitan-a' }),
  agency({ id: 'district-yeongjong', type: 'district', label: '영종교육지원청 (2027 개청 예정)', displayName: '인천광역시영종교육지원청', coverProfile: 'metropolitan-a', activeFrom: '2027-03-01' }),
  agency({ id: 'district-geomdan', type: 'district', label: '검단교육지원청 (2027 개청 예정)', displayName: '인천광역시검단교육지원청', coverProfile: 'metropolitan-a', activeFrom: '2027-03-01' }),
];

// ── 직속기관 10종 ───────────────────────────────────────────────────────
const DIRECT = [
  agency({ id: 'direct-ai', type: 'direct', label: 'AI융합교육원', displayName: '인천광역시교육청AI융합교육원', coverProfile: 'direct-g' }),
  agency({ id: 'direct-training', type: 'direct', label: '교육연수원', displayName: '인천광역시교육청교육연수원', coverProfile: 'direct-g' }),
  agency({ id: 'direct-culture', type: 'direct', label: '학생교육문화회관', displayName: '인천광역시교육청학생교육문화회관', coverProfile: 'direct-g' }),
  agency({ id: 'direct-student', type: 'direct', label: '학생교육원', displayName: '인천광역시교육청학생교육원', englishName: 'Incheon Student Education Institute', coverProfile: 'direct-g', innerCover: false }),
  agency({ id: 'direct-staff', type: 'direct', label: '교직원수련원', displayName: '인천광역시교육청교직원수련원', coverProfile: 'direct-g' }),
  agency({ id: 'direct-lifelong', type: 'direct', label: '평생학습관', displayName: '인천광역시교육청평생학습관', englishName: 'Incheon Lifelong Learning Center', coverProfile: 'direct-f' }),
  agency({ id: 'direct-early', type: 'direct', label: '유아교육진흥원', displayName: '인천광역시교육청유아교육진흥원', coverProfile: 'direct-g' }),
  // 사용자 목록상 유일하게 '교육청'이 없는 명칭 — 원문 그대로 보존
  agency({ id: 'direct-eastasia', type: 'direct', label: '동아시아국제교육원', displayName: '인천광역시동아시아국제교육원', coverProfile: 'direct-g' }),
  agency({ id: 'direct-schoolsupport', type: 'direct', label: '학교지원단', displayName: '인천광역시교육청학교지원단', coverProfile: 'direct-g' }),
  agency({ id: 'direct-peace', type: 'direct', label: '난정평화교육원', displayName: '인천광역시교육청난정평화교육원', coverProfile: 'direct-g' }),
];

// ── 도서관 8종 ──────────────────────────────────────────────────────────
const LIBRARIES = [
  agency({ id: 'library-sinteuri', type: 'library', label: '신트리도서관', displayName: '인천광역시교육청신트리도서관', coverProfile: 'metropolitan-a' }),
  agency({ id: 'library-jungang', type: 'library', label: '중앙도서관', displayName: '인천광역시교육청중앙도서관', coverProfile: 'metropolitan-a' }),
  agency({ id: 'library-bupyeong', type: 'library', label: '부평도서관', displayName: '인천광역시교육청부평도서관', coverProfile: 'metropolitan-a' }),
  agency({ id: 'library-juan', type: 'library', label: '주안도서관', displayName: '인천광역시교육청주안도서관', coverProfile: 'metropolitan-a' }),
  agency({ id: 'library-hwadojin', type: 'library', label: '화도진도서관', displayName: '인천광역시교육청화도진도서관', coverProfile: 'metropolitan-a' }),
  agency({ id: 'library-seogu', type: 'library', label: '서구도서관', displayName: '인천광역시교육청서구도서관', coverProfile: 'metropolitan-a' }),
  agency({ id: 'library-gyeyang', type: 'library', label: '계양도서관', displayName: '인천광역시교육청계양도서관', coverProfile: 'metropolitan-a' }),
  agency({ id: 'library-yeonsu', type: 'library', label: '연수도서관', displayName: '인천광역시교육청연수도서관', coverProfile: 'metropolitan-a' }),
];

const ALL_AGENCIES = [...HEADQUARTERS, ...DISTRICTS, ...DIRECT, ...LIBRARIES];

export const agencyProfiles = Object.fromEntries(ALL_AGENCIES.map((item) => [item.id, item]));

// 구 버전(0.1) 저장 프로젝트가 쓰던 범용 id를 대표 기관으로 해석(하위 호환).
export const legacyAgencyAliases = {
  district: 'district-nambu',
  direct: 'direct-student',
};

// 유형 그룹 — UI 선택기용(라벨 순서 고정).
export const agencyGroups = [
  { type: 'metropolitan', label: '본청', agencies: HEADQUARTERS },
  { type: 'district', label: '교육지원청', agencies: DISTRICTS },
  { type: 'direct', label: '직속기관', agencies: DIRECT },
  { type: 'library', label: '도서관', agencies: LIBRARIES },
];

export const defaultAgencyProfile = agencyProfiles.metropolitan;

// id → 프로필 해석(레거시 별칭 처리 포함).
export function resolveAgency(id) {
  return agencyProfiles[id] || agencyProfiles[legacyAgencyAliases[id]] || defaultAgencyProfile;
}
