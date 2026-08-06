import { renderInline } from "../domain/previewText.js";
import { classifyStructuredBlock } from "../domain/headingPresentation.js";

const pt = (hwpUnit) => Number.isFinite(Number(hwpUnit)) ? `${Number(hwpUnit) / 100}pt` : undefined;
const positivePt = (hwpUnit) => Number(hwpUnit) > 0 ? pt(hwpUnit) : undefined;

function paragraphStyle(block, normalizeTypography = false) {
  const paragraph = block.layout?.paragraph;
  const character = paragraph?.character;
  if (!paragraph && !character) return undefined;
  return {
    fontFamily: normalizeTypography ? undefined : character?.fontFamily || undefined,
    fontSize: normalizeTypography ? undefined : character?.sizePt ? `${character.sizePt}pt` : undefined,
    color: normalizeTypography ? undefined : character?.color || undefined,
    letterSpacing: normalizeTypography ? undefined : character?.charSpacingPercent ? `${character.charSpacingPercent / 100}em` : undefined,
    lineHeight: paragraph?.lineSpacingPercent ? paragraph.lineSpacingPercent / 100 : undefined,
    marginTop: normalizeTypography ? undefined : positivePt(paragraph?.spaceBeforeHwpUnit),
    marginBottom: normalizeTypography ? undefined : positivePt(paragraph?.spaceAfterHwpUnit),
    marginLeft: normalizeTypography ? undefined : pt(paragraph?.marginLeftHwpUnit),
  };
}

function PreviewBlock({ block, index, highlighted, normalizeTypography = false }) {
  const highlightClass = highlighted ? "rule-target-preview" : "";
  if (block.type === "heading") {
    const structured = classifyStructuredBlock(block);
    if (structured && structured.kind !== "korean-subheading") {
      return <div className={`structured-heading structured-heading-${structured.kind} ${highlightClass}`.trim()} role="heading" aria-level={Math.min(Math.max(block.level || 1, 1), 3)} key={index}>
        <span className="structured-heading-label">{renderInline(structured.label)}</span>
        <span className="structured-heading-title">{renderInline(structured.title)}</span>
      </div>;
    }
    const Tag = `h${Math.min(Math.max(block.level || 1, 1), 3)}`;
    return <Tag className={`${structured?.kind === "korean-subheading" ? "korean-subheading" : ""} ${highlightClass}`.trim()} style={paragraphStyle(block, normalizeTypography)} key={index}>{renderInline(block.text)}</Tag>;
  }
  if (block.type === "listItem") {
    const sectionClass = block.ordered && Number(block.level || 0) === 0 ? "section-heading" : "";
    return <p className={`loaded-list-item ${sectionClass} ${highlightClass}`.trim()} style={paragraphStyle(block, normalizeTypography)} key={index}><span className="list-marker">{block.marker || (block.ordered ? "1." : "- ")}</span>{renderInline(block.text)}</p>;
  }
  if (block.type === "table") {
    const [header, ...body] = block.rows;
    const widthSum = block.columnWidthsHwpUnit.reduce((sum, width) => sum + Number(width || 0), 0) || block.widthHwpUnit;
    const tableStyle = { width: `${Math.min(100, (block.widthHwpUnit / projectionBodyWidth(block)) * 100)}%` };
    const cellStyle = (rowIndex) => ({
      height: block.rowHeightsHwpUnit?.[rowIndex] ? pt(block.rowHeightsHwpUnit[rowIndex]) : undefined,
    });
    return <table className={`plan-table loaded-table ${highlightClass}`.trim()} style={tableStyle} key={index} data-width-hwpunit={block.widthHwpUnit}>
      <thead><tr>{header.map((cell, column) => <th key={column} style={{ ...cellStyle(0), width: `${(block.columnWidthsHwpUnit[column] / widthSum) * 100}%` }}>{renderInline(cell)}</th>)}</tr></thead>
      <tbody>{body.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, column) => <td key={column} style={cellStyle(rowIndex + 1)}>{renderInline(cell)}</td>)}</tr>)}</tbody>
    </table>;
  }
  if (block.type === "image") return <p className={`loaded-paragraph ${highlightClass}`.trim()} style={paragraphStyle(block, normalizeTypography)} key={index}>이미지 보존: {block.image?.filename || block.image?.sha256 || "원본 이미지"}</p>;
  return <p className={`loaded-paragraph ${highlightClass}`.trim()} style={paragraphStyle(block, normalizeTypography)} key={index}>{renderInline(block.text)}</p>;
}

function projectionBodyWidth(block) {
  return Math.max(Number(block.widthHwpUnit) || 0, 48190);
}

function CoverPage({ page, projection, agencyName }) {
  const { cover, profile } = projection;
  return <>
    {profile.bannerImage && cover.direction ? <div className="preview-cover-banner">{cover.direction}</div> : null}
    <div className={`preview-cover-title ${profile.titleBox ? "has-title-box" : ""}`}><h1>{cover.title || projection.title}</h1></div>
    <p className="preview-cover-date">{cover.date || ""}</p>
    <p className="preview-cover-agency">{cover.displayName || agencyName}</p>
    {profile.englishName ? <p className="preview-cover-english">{profile.englishName}</p> : null}
  </>;
}

function FrontMatterFrame({ page }) {
  const rows = page.type === "toc"
    ? ["Ⅰ.", "Ⅱ.", "Ⅲ.", "Ⅳ.", "[붙임]"]
    : ["추진 배경", "비전·목표", "추진 과제", "추진 일정", "성과 관리"];
  return <div className="front-matter-frame" aria-label={page.label + " 구성 틀"}>
    {rows.map((label) => <div className="front-matter-row" key={label}><span>{label}</span><span className="front-matter-leader" /></div>)}
  </div>;
}

function BodyOpeningHeader({ projection }) {
  const departmentLine = [projection.organization?.displayName, projection.organization?.department].filter(Boolean).join(" ");
  return <div className="body-opening-header">
    <table className="body-opening-title-table" aria-label="본문 제목">
      <tbody>
        <tr className="title-decoration-row"><td colSpan="2" /><td /><td /></tr>
        <tr><th colSpan="4">{projection.title}</th></tr>
        <tr className="title-decoration-row"><td /><td /><td colSpan="2" /></tr>
      </tbody>
    </table>
    {departmentLine ? <p>{departmentLine}</p> : null}
  </div>;
}

function isDuplicateBodyTitle(block, title) {
  const normalizedTitle = String(title || "").replace(/\.(md|txt|hwpx?|iceplan)$/i, "").trim();
  if (!normalizedTitle) return false;
  const text = String(block?.text || "").replace(/\.(md|txt|hwpx?|iceplan)$/i, "").trim();
  if (text === normalizedTitle) return true;
  if (block?.type !== "table") return false;
  const cells = [...(block.header || []), ...(block.rows || []).flat()]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("");
  return cells === normalizedTitle;
}

export function PlanPreview({ projection, page, agencyName, highlightBlockIndex = null }) {
  if (!projection || !page) return null;
  const visibleBlocks = page.type === "body-opening"
    ? page.blocks.filter((block) => !isDuplicateBodyTitle(block, projection.title))
    : page.blocks;
  const previewStyle = {
    "--plan-body-size": `${projection.layoutProfile?.bodySizePt || projection.tokens.typography.body.sizePt}pt`,
    "--opening-title-size": `${projection.layoutProfile?.openingTitleSizePt || 18}pt`,
    "--opening-department-size": `${projection.layoutProfile?.openingDepartmentSizePt || 12}pt`,
    "--chapter-label-size": `${projection.layoutProfile?.chapterLabelSizePt || 14}pt`,
    "--chapter-title-size": `${projection.layoutProfile?.chapterTitleSizePt || 18}pt`,
    "--task-label-size": `${projection.layoutProfile?.taskLabelSizePt || 13}pt`,
    "--task-title-size": `${projection.layoutProfile?.taskTitleSizePt || 14}pt`,
    "--task-sub-label-size": `${projection.layoutProfile?.taskSubLabelSizePt || 12}pt`,
    "--task-sub-title-size": `${projection.layoutProfile?.taskSubTitleSizePt || 12}pt`,
    "--chapter-accent": projection.layoutProfile?.chapterAccentColor || "#3057b9",
    "--task-accent": projection.layoutProfile?.taskAccentColor || "#1e7452",
    "--task-sub-accent": projection.layoutProfile?.taskSubAccentColor || "#2d629c",
  };
  return <article className={`a4-page composition-page page-type-${page.type}`} style={previewStyle} aria-label={`${page.number}쪽 ${page.label} 미리보기`}>
    {page.type === "cover" ? <CoverPage page={page} projection={projection} agencyName={agencyName} /> : <>
      {!["body-opening", "body-continuation", "body"].includes(page.type) ? <>
        <header className="document-header"><span>{projection.title}</span><span className="document-meta">{page.label}</span></header>
        <div className="document-rule" />
      </> : null}
      <div className="loaded-document-body">
        {page.type === "body-opening" ? <BodyOpeningHeader projection={projection} /> : null}
        {page.type !== "body" && page.type !== "body-opening" && page.type !== "body-continuation" ? <h1>{page.title}</h1> : null}
        {(page.type === "toc" || page.type === "summary") && page.blocks.length === 0 ? <FrontMatterFrame page={page} /> : null}
        {visibleBlocks.map((block, index) => <PreviewBlock block={block} index={index} highlighted={index === highlightBlockIndex} normalizeTypography={projection.sourceFormat === "hwpx"} key={`${page.id}-${index}`} />)}
      </div>
      {page.displayNumber ? <div className="page-number">- {page.displayNumber} -</div> : null}
    </>}
  </article>;
}
