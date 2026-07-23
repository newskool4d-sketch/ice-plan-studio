import { agencyGroups } from "../../domain/agencyProfiles.js";

// 기본정보 단계의 카드형 기관 선택기(과제 F). CI 미리보기와 영문명·개청 예정
// 배지를 함께 보여 준다. 상단바의 컴팩트 드롭다운(AgencySelect)은 그대로 두고,
// 카드는 여유 공간이 있는 인스펙터 패널에서만 쓴다.
//
// CI는 현재 전 기관이 본청 자산 폴백이다(agencyProfiles 참조 — 기관별 자산은
// 수집 후 반영). 카드 구조는 자산이 채워지면 그대로 기관별 CI를 보여 준다.
export function AgencyCardPicker({ value, onSelect }) {
  return <div className="agency-card-picker">
    {agencyGroups.map((group) => <section key={group.type} className="agency-card-group">
      <h3>{group.label}</h3>
      <div className="agency-card-grid" role="listbox" aria-label={`${group.label} 기관 선택`}>
        {group.agencies.map((agency) => {
          const pending = agency.activeFrom && new Date(agency.activeFrom) > new Date();
          return <button
            type="button"
            role="option"
            aria-selected={value === agency.id}
            className={`agency-card${value === agency.id ? " is-selected" : ""}`}
            data-agency-id={agency.id}
            onClick={() => onSelect(agency.id)}
            key={agency.id}
          >
            <span className="agency-card-ci"><img src={agency.ci} alt="" loading="lazy" /></span>
            <span className="agency-card-copy">
              <strong>{agency.label.replace(/ \(2027 개청 예정\)$/, "")}</strong>
              {agency.englishName ? <small>{agency.englishName}</small> : null}
              {pending ? <em className="agency-card-pending">2027. 3. 개청 예정</em> : null}
            </span>
          </button>;
        })}
      </div>
    </section>)}
  </div>;
}
