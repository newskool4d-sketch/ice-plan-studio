export const agencyProfiles = {
  metropolitan: {
    id: 'metropolitan',
    label: '인천광역시교육청 본청',
    displayName: '인천광역시교육청',
    coverProfile: 'metropolitan-a',
    slogan: '함께 가는 인천교육, 세계로 나아가는 인천교육',
    ci: './branding/incheon-ci.png',
    sloganAsset: './branding/incheon-slogan.png',
  },
  district: {
    id: 'district',
    label: '교육지원청',
    displayName: '인천광역시교육지원청',
    coverProfile: 'metropolitan-a',
    slogan: '기관별 슬로건을 설정하세요',
    ci: './branding/incheon-ci.png',
    sloganAsset: './branding/incheon-slogan.png',
  },
  direct: {
    id: 'direct',
    label: '직속기관',
    displayName: '인천광역시교육청 직속기관',
    coverProfile: 'direct-g',
    slogan: '기관별 슬로건을 설정하세요',
    ci: './branding/incheon-ci.png',
    sloganAsset: './branding/incheon-slogan.png',
  },
};

export const defaultAgencyProfile = agencyProfiles.metropolitan;
