// 워크플로가 쓰는 순수 변환 함수 모음.
//
// WorkflowApp.jsx에서 분리했다(11단계 선행 리팩터링). 화면 상태에 의존하지 않는
// 계산만 모아 두어야 시각 리디자인이 로직을 건드리지 않는다.
import { createPreviewProjection } from "./previewProjection.js";
import { ensurePlanDecisions, pagePlanFromDecisions } from "./planDecisions.js";

export function modelTitle(model, fallback) {
  return model?.blocks?.find((block) => block.type === "heading" && block.level === 1)?.text
    || model?.metadata?.cover?.title
    || model?.metadata?.title
    || fallback.replace(/\.(md|txt|hwpx?|iceplan)$/i, "");
}

export function compositionModel(model, agency) {
  if (!model) return null;
  return {
    ...model,
    metadata: {
      ...model.metadata,
      cover: {
        ...(model.metadata?.cover || {}),
        title: model.metadata?.cover?.title || model.metadata?.title,
        displayName: model.metadata?.cover?.displayName || agency.displayName,
        // 표지 영문명은 기관 레지스트리 값으로 구동한다. 직속기관 10종이 같은
        // coverProfile(direct-g)을 공유하므로, 프로필에 박힌 영문명을 그대로 쓰면
        // 모든 기관이 학생교육원 영문명으로 출력된다. 레지스트리 값(없으면 null)을
        // 넘겨 기관별로 정확히 반영하고, 영문명 없는 기관은 표지에서 생략한다.
        englishName: agency.englishName ?? null,
      },
      layout: {
        ...(model.metadata?.layout || {}),
        template: "boncheong",
        coverProfile: agency.coverProfile,
      },
    },
  };
}

export function profilePackage(agency) {
  return {
    schemaVersion: "0.2",
    kind: "iceprofile",
    profile: {
      id: agency.id,
      label: agency.label,
      baseAgencyId: agency.id,
      organization: { displayName: agency.displayName, department: null },
      branding: { slogan: agency.slogan, ci: agency.ci, sloganAsset: agency.sloganAsset, customByAgency: {} },
      layout: { coverProfile: agency.coverProfile },
      extensions: {},
    },
  };
}

export function pageDraftsFrom(model, agency) {
  const prepared = ensurePlanDecisions(model);
  const planned = pagePlanFromDecisions(prepared);
  const projectionModel = {
    ...prepared,
    metadata: { ...prepared.metadata, pages: planned },
  };
  return createPreviewProjection(compositionModel(projectionModel, agency)).pages.map((page, index) => ({
    id: page.id,
    type: page.type,
    title: page.title,
    role: planned[index]?.role || page.type,
    decisionMode: planned[index]?.decisionMode || null,
    blocks: planned[index]?.blocks || [],
    confirmed: false,
  }));
}
