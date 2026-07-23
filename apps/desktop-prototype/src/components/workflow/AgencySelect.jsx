import { agencyGroups } from "../../domain/agencyProfiles.js";

// 상단바와 기본정보 패널이 같은 선택기를 쓴다. 두 곳에 같은 markup을 두면
// 기관 목록이 늘어날 때 한쪽만 고쳐지는 사고가 난다.
export function AgencySelect({ value, onChange }) {
  return <select value={value} onChange={onChange}>
    {agencyGroups.map((group) => <optgroup key={group.type} label={group.label}>
      {group.agencies.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
    </optgroup>)}
  </select>;
}
