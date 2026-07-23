// 워크플로 단계 정의와 페이지 유형 선택지.
// 단계 패널 컴포넌트와 WorkflowApp이 함께 쓰므로 별도 모듈로 둔다.
import { layoutTokens } from "../../domain/previewProjection.js";

export const workflowSteps = [
  { key: "start", label: "시작", detail: "문서 불러오기" },
  { key: "analysis", label: "분석", detail: "입력 구조 확인" },
  { key: "information", label: "기본정보", detail: "제목·기관 확정" },
  { key: "structure", label: "구조편집", detail: "페이지 유형 확정" },
  { key: "rules", label: "규칙검수", detail: "검수 결과 확인" },
  { key: "export", label: "내보내기", detail: "HWPX 생성" },
];

export const pageTypeOptions = Object.entries(layoutTokens.pageTypes)
  .map(([value, label]) => ({ value, label }));
