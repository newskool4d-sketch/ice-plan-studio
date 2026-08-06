const fs = require('node:fs');
const AdmZip = require('adm-zip');
const { renderHwpxToSvg } = require('kordoc');

function fail(message) {
  console.error(message);
  process.exit(1);
}

// electron/preview-split.cjs의 chunkBuffers()와 같은 로직의 복사본이다. 이 스크립트는
// ELECTRON_RUN_AS_NODE로 asar 밖(app.asar.unpacked/scripts)에서 단독 실행되므로
// asar 안의 electron/ 모듈을 require할 수 없다 — scripts/ 폴더 안에서 자급자족해야 한다.
// kordoc reflow는 pageBreak="1"(하드 쪽 나눔)을 읽지 않으므로, 문서 전체를 한 번에
// 렌더하면 표지·본문이 한 페이지로 뭉개져 쪽 번호 검색이 틀어진다. 하드 나눔 경계로
// 먼저 분할한 뒤 조각별로 렌더해야 실제 화면 쪽 번호와 일치한다.
// model_to_hwpx.py page_break_para()가 생성하는 마커와 정확히 일치해야 한다.
const PAGE_BREAK_PARA = /<hp:p id="\d+" paraPrIDRef="0" styleIDRef="0" pageBreak="1" columnBreak="0" merged="0">(?:<hp:ctrl>[\s\S]*?<\/hp:ctrl>)*<hp:run charPrIDRef="0">(?:<hp:ctrl>[\s\S]*?<\/hp:ctrl>)*<hp:t\/><\/hp:run><\/hp:p>/g;

function splitSection(sectionXml) {
  const open = sectionXml.indexOf('>', sectionXml.indexOf('<hs:sec')) + 1;
  const close = sectionXml.lastIndexOf('</hs:sec>');
  const head = sectionXml.slice(0, open);
  const tail = sectionXml.slice(close);
  const chunks = sectionXml.slice(open, close).split(PAGE_BREAK_PARA).filter((chunk) => chunk.trim());
  return chunks.map((chunk) => head + chunk + tail);
}

function chunkBuffers(hwpxBuffer) {
  const source = new AdmZip(hwpxBuffer);
  const section = source.readAsText('Contents/section0.xml');
  return splitSection(section).map((chunkXml) => {
    const zip = new AdmZip(hwpxBuffer);
    zip.updateFile('Contents/section0.xml', Buffer.from(chunkXml, 'utf8'));
    return zip.toBuffer();
  });
}

function splitPages(svg) {
  const marks = [...String(svg || '').matchAll(/<g\s+data-page="(\d+)"[^>]*>/g)];
  return marks.map((mark, index) => String(svg).slice(
    mark.index,
    index + 1 < marks.length ? marks[index + 1].index : String(svg).length,
  ));
}

function visibleText(svg) {
  return [...String(svg || '').matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
    .map((match) => match[1]
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'"))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  const [hwpxPath, entriesPath, bodyStartArg] = process.argv.slice(2);
  if (!hwpxPath || !entriesPath) fail('usage: populate-toc-pages.cjs document.hwpx entries.json bodyStartPage');
  const entries = JSON.parse(fs.readFileSync(entriesPath, 'utf8'));
  const requestedBodyStartPage = Math.max(1, Number(bodyStartArg) || 1);
  const source = fs.readFileSync(hwpxPath);
  const chunks = chunkBuffers(source);
  const buffers = chunks.length ? chunks : [source];
  const pageTexts = [];
  let pageCount = 0;
  for (const buffer of buffers) {
    const rendered = await renderHwpxToSvg(buffer, { reflow: true, reflowMode: 'keep' });
    pageTexts.push(...splitPages(rendered.svg).map(visibleText));
    pageCount += rendered.pageCount;
  }
  const occurrencePages = (needle) => pageTexts
    .map((text, index) => text.includes(needle) ? index + 1 : null)
    .filter(Boolean);
  const firstEntryPages = entries.length ? occurrencePages(entries[0].text) : [];
  const bodyStartPage = firstEntryPages.length
    ? Math.max(...firstEntryPages)
    : requestedBodyStartPage;
  const missing = [];
  const documentPages = new Map();

  for (const entry of entries) {
    const exactPages = occurrencePages(entry.text);
    const fallbackPages = exactPages.length ? exactPages : occurrencePages(entry.lookup);
    const documentPage = fallbackPages.find((page) => page >= bodyStartPage) || null;
    if (documentPage === null) {
      missing.push(entry.text);
      continue;
    }
    documentPages.set(entry.placeholder, documentPage);
  }
  if (missing.length) fail(`목차 쪽 번호를 찾지 못했습니다: ${missing.join(', ')}`);
  const pageValues = new Map(
    [...documentPages].map(([placeholder, documentPage]) => [
      placeholder,
      String(documentPage - bodyStartPage + 1),
    ]),
  );

  const archive = new AdmZip(source);
  let section = archive.readAsText('Contents/section0.xml');
  for (const entry of entries) {
    section = section.replace(entry.placeholder, pageValues.get(entry.placeholder));
  }
  archive.updateFile('Contents/section0.xml', Buffer.from(section, 'utf8'));
  archive.writeZip(hwpxPath);
  console.log(JSON.stringify({
    pageCount,
    bodyStartPage,
    entries: entries.map((entry) => ({
      text: entry.text,
      page: pageValues.get(entry.placeholder),
    })),
  }, null, 2));
}

main().catch((error) => fail(error?.stack || String(error)));
