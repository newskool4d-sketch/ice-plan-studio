/**
 * 9단계 적응 조판 — 2-pass 간격 보정 루프.
 *
 * 1-pass 추정(문자폭 900 고정 근사)은 채움률 경계 판정에 필요한 정밀도가 없다.
 * 그래서 **생성 → 측정 → 간격 재조정 → 재생성**을 실제로 돌린다. 조정은 매번
 * 생성기 파라미터로 들어가므로(이미 만든 HWPX를 후처리 변조하지 않음) 같은
 * 입력이면 같은 결과가 나온다.
 *
 * 설계 원칙 3가지:
 *  1) 1차 신호는 쪽수다. 실제 통증은 "1쪽 살짝 넘겨 2쪽이 됨"이고 쪽수는 견고하다.
 *     단 kordoc 원쪽수가 아니라 **채움률 안전 임계로 보정한 쪽수**를 쓴다
 *     (layout-measure.cjs 참조 — 보정 없이 쓰면 한글에서 쪽이 늘어난다).
 *  2) 바닥값 아래로는 절대 내려가지 않는다. 사다리를 다 써도 목표에 못 가면
 *     **조정을 포기하고 원래 조판을 정직하게 보고한다** — 목표 쪽수를 강제하지 않는다.
 *  3) 완화(부족 보정)는 쪽수를 늘리지 않고, 이득이 작으면 아예 하지 않는다.
 */
const { measureHwpx } = require('./layout-measure.cjs');

const sameSpacing = (a, b) => a.lineSpacingPercent === b.lineSpacingPercent
  && a.paraNextHwpUnit === b.paraNextHwpUnit;

const percent = (ratio) => `${Math.round(ratio * 100)}%`;

function summarize(spacing, measurement) {
  const last = measurement.chunks[measurement.chunks.length - 1] || null;
  return {
    spacing,
    pageCount: measurement.pageCount,
    rawPageCount: measurement.rawPageCount,
    // 마지막 청크(=본문)가 스스로 몇 쪽을 차지하는가. 표지는 하드 쪽 나눔으로 갈린
    // 별도 청크라 간격을 조여도 본문과 절대 합쳐지지 않는다 — 전체 쪽수로 판단하면
    // 합쳐질 수 없는 쪽을 줄이겠다고 사다리를 끝까지 헛돈다.
    lastChunkPages: last ? last.effectivePageCount : 0,
    lastPageFillRatio: last ? last.lastPageFillRatio : null,
    overflowed: last ? last.overflowed : false,
    confident: measurement.confident,
  };
}

function describe(reason, base, final) {
  const spacing = `본문 줄간격 ${base.spacing.lineSpacingPercent}% → ${final.spacing.lineSpacingPercent}%`;
  // 완화는 쪽수를 바꾸지 않으므로 "2쪽 → 2쪽"이라 쓰면 사용자에게 아무 정보가 없다.
  const effect = reason === 'squeeze'
    ? `${base.pageCount}쪽 → ${final.pageCount}쪽`
    : `마지막 쪽 채움 ${percent(base.lastPageFillRatio)} → ${percent(final.lastPageFillRatio)}`;
  return `간격 자동 조정됨 — ${spacing} (${effect})`;
}

/**
 * 조이기를 시도할 만한 상태인가.
 *
 * 두 가지 모습으로 나타난다.
 *  (a) kordoc이 쪽을 나눈 경우 — 마지막 쪽이 거의 비어 있다(꼬리 몇 줄만 넘어감).
 *  (b) kordoc이 쪽을 안 나눈 경우 — 마지막 쪽이 안전 임계를 조금 넘겼다.
 *      표가 든 문서에서 이 모습이 나온다(kordoc은 표 넘침을 쪽으로 나누지 않음).
 * 둘 다 "조금만 조이면 한 쪽 줄어든다"는 같은 상황이다. 많이 넘친 경우는
 * 간격으로 해결될 분량이 아니므로 시도하지 않는다.
 */
function shouldSqueeze(entry, tokens) {
  // 줄일 수 있는 쪽은 본문 청크가 스스로 넘긴 쪽뿐이다.
  if (entry.lastChunkPages < 2) return false;
  const fill = entry.lastPageFillRatio;
  if (fill === null) return false;
  const tailSpill = !entry.overflowed && fill <= tokens.squeezeMaxLastPageFill;
  const overflowSpill = entry.overflowed && fill <= 1 + tokens.squeezeMaxLastPageFill;
  return tailSpill || overflowSpill;
}

/**
 * @param {(spacing: {lineSpacingPercent:number, paraNextHwpUnit:number}) => Promise<Buffer>} regenerate
 *        주어진 간격으로 HWPX를 생성해 바이트를 돌려준다.
 * @param {object} tokens layout-tokens.json의 adaptiveSpacing 블록.
 */
async function fitLayout(regenerate, tokens) {
  const attempts = [];
  const run = async (spacing) => {
    const entry = summarize(spacing, await measureHwpx(await regenerate(spacing), tokens));
    attempts.push(entry);
    return entry;
  };

  const base = await run(tokens.squeezeLadder[0]);
  const result = { base, final: base, applied: false, reason: 'none', notice: null, attempts };

  if (shouldSqueeze(base, tokens)) {
    const target = base.pageCount - 1;
    for (const spacing of tokens.squeezeLadder.slice(1)) {
      const attempt = await run(spacing);
      if (attempt.pageCount <= target) {
        return { ...result, final: attempt, applied: true, reason: 'squeeze', notice: describe('squeeze', base, attempt) };
      }
    }
    // 바닥값에서도 못 줄였다 — 강제하지 않고 원래 조판으로 돌아간다.
    return { ...result, reason: 'squeeze-exhausted' };
  }

  // 완화: 한 쪽을 너무 못 채운 경우. 쪽수가 늘어나는 순간 직전 단계에서 멈춘다.
  const underfilled = base.lastPageFillRatio !== null
    && !base.overflowed
    && base.lastPageFillRatio < tokens.underfillThreshold;
  if (underfilled) {
    let best = base;
    for (const spacing of tokens.loosenLadder) {
      if (sameSpacing(spacing, base.spacing)) continue;
      const attempt = await run(spacing);
      if (attempt.pageCount > base.pageCount || attempt.overflowed) break;
      best = attempt;
    }
    // 완화는 쪽수를 줄이지 못하므로, 채움률 이득이 작으면 조판만 흔들고 사용자에게는
    // 의미 없는 고지가 뜬다. 최소 이득에 못 미치면 무보정으로 남긴다.
    const gain = best.lastPageFillRatio - base.lastPageFillRatio;
    if (best !== base && gain >= tokens.minLoosenFillGain) {
      return { ...result, final: best, applied: true, reason: 'loosen', notice: describe('loosen', base, best) };
    }
    return { ...result, reason: best === base ? 'loosen-unavailable' : 'loosen-negligible' };
  }

  return result;
}

module.exports = { fitLayout, shouldSqueeze };
