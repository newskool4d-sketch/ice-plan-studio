import { renderInline } from "../domain/previewText.js";

function PreviewBlock({ block, index, highlighted }) {
  const highlightClass = highlighted ? "rule-target-preview" : "";
  if (block.type === "heading") {
    const Tag = `h${Math.min(Math.max(block.level || 1, 1), 3)}`;
    return <Tag className={highlightClass} key={index}>{renderInline(block.text)}</Tag>;
  }
  if (block.type === "listItem") {
    const sectionClass = block.ordered && Number(block.level || 0) === 0 ? "section-heading" : "";
    return <p className={`loaded-list-item ${sectionClass} ${highlightClass}`.trim()} key={index}><span className="list-marker">{block.marker || (block.ordered ? "1." : "- ")}</span>{renderInline(block.text)}</p>;
  }
  if (block.type === "table") {
    const [header, ...body] = block.rows;
    return <table className={`plan-table loaded-table ${highlightClass}`.trim()} key={index} data-width-hwpunit={block.widthHwpUnit}>
      <thead><tr>{header.map((cell, column) => <th key={column} style={{ width: `${(block.columnWidthsHwpUnit[column] / block.widthHwpUnit) * 100}%` }}>{renderInline(cell)}</th>)}</tr></thead>
      <tbody>{body.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, column) => <td key={column}>{renderInline(cell)}</td>)}</tr>)}</tbody>
    </table>;
  }
  if (block.type === "image") return <p className={`loaded-paragraph ${highlightClass}`.trim()} key={index}>이미지 보존: {block.image?.filename || block.image?.sha256 || "원본 이미지"}</p>;
  return <p className={`loaded-paragraph ${highlightClass}`.trim()} key={index}>{renderInline(block.text)}</p>;
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
    <h1>{projection.title}</h1>
    {departmentLine ? <p>{departmentLine}</p> : null}
  </div>;
}

export function PlanPreview({ projection, page, agencyName, highlightBlockIndex = null }) {
  if (!projection || !page) return null;
  const previewStyle = {
    "--plan-body-size": `${projection.layoutProfile?.bodySizePt || projection.tokens.typography.body.sizePt}pt`,
    "--opening-title-size": `${projection.layoutProfile?.openingTitleSizePt || 18}pt`,
    "--opening-department-size": `${projection.layoutProfile?.openingDepartmentSizePt || 12}pt`,
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
        {page.blocks.map((block, index) => <PreviewBlock block={block} index={index} highlighted={index === highlightBlockIndex} key={`${page.id}-${index}`} />)}
      </div>
      {page.displayNumber ? <div className="page-number">- {page.displayNumber} -</div> : null}
    </>}
  </article>;
}
