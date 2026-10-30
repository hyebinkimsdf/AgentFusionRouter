// Self-contained HTML: no scripts, no network, so a report opens the same
// anywhere, years later, and its screenshot shows exactly what the file holds.

export const esc = (value: unknown): string =>
  String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)

export const usd = (n: number | undefined): string =>
  n === undefined ? '—' : `$${n.toFixed(n !== 0 && Math.abs(n) < 1 ? 4 : 2)}`

/** Full precision, for figures whose exact agreement is the point. */
export const exactUsd = (n: number | undefined): string =>
  n === undefined ? '—' : `${n < 0 ? '−' : ''}$${Math.abs(n).toFixed(8)}`

/** Whether a cost reconciles: plugin + outside the conversation − Claude Code's total. */
export const accounted = (unaccounted: number | undefined): string =>
  unaccounted === undefined
    ? '—'
    : Math.abs(unaccounted) < 5e-9
      ? '<span class="pass">✓ to the last digit</span>'
      : `<span class="fail">off by ${exactUsd(unaccounted)}</span>`

export const pct = (n: number): string => `${Math.round(n * 100)}%`

export const duration = (ms: number): string => {
  const s = Math.round(ms / 1000)

  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

export const compact = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${Math.round(n)}`

/** Categorical slots in fixed order: an arm keeps its color everywhere in a report. */
export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'] as const

export const swatch = (color: string): string => `<span class="swatch" style="background:${color}" aria-hidden="true"></span>`

export const passMark = (ok: boolean): string =>
  ok ? '<span class="pass">✓ Pass</span>' : '<span class="fail">✗ Fail</span>'

export type Bar = { label: string; value: number; color: string; text: string }

/** A data end rounded 4px, square at the baseline. */
const barPath = (x: number, y: number, w: number, h: number): string => {
  if (w < 4) return `M${x},${y}h${w}v${h}h${-w}z`

  return `M${x},${y}h${w - 4}a4,4 0 0 1 4,4v${h - 8}a4,4 0 0 1 -4,4h${-(w - 4)}z`
}

/** Horizontal bars from one baseline, value at the tip, a native tooltip per bar. */
export const barChart = (bars: readonly Bar[], title: string): string => {
  const width = 560
  const labelW = 150
  const valueW = 90
  const rowH = 34
  const barH = 18
  const plotW = width - labelW - valueW
  const max = Math.max(0, ...bars.map(b => b.value)) || 1
  const height = bars.length * rowH + 8

  const rows = bars
    .map((b, i) => {
      const y = 4 + i * rowH + (rowH - barH) / 2
      const w = Math.max(0, (b.value / max) * plotW)

      return `<g><title>${esc(`${b.label}: ${b.text}`)}</title>
  <text x="0" y="${y + barH / 2}" dominant-baseline="middle" class="lbl">${esc(b.label)}</text>
  <path d="${barPath(labelW, y, w, barH)}" fill="${b.color}"/>
  <text x="${labelW + w + 6}" y="${y + barH / 2}" dominant-baseline="middle" class="val">${esc(b.text)}</text></g>`
    })
    .join('\n')

  return `<figure class="chart"><figcaption>${esc(title)}</figcaption>
<svg viewBox="0 0 ${width} ${height}" width="${width}" role="img" aria-label="${esc(title)}">
  <line x1="${labelW}" y1="0" x2="${labelW}" y2="${height}" class="axis"/>
${rows}
</svg></figure>`
}

/** Bars grouped per category, one bar per series, with a legend above. */
export const groupedBarChart = (
  groups: readonly { label: string; bars: readonly { value: number; text: string }[] }[],
  series: readonly { label: string; color: string }[],
  title: string,
): string => {
  const width = 760
  const labelW = 170
  const valueW = 90
  const barH = 12
  const gap = 2
  const groupGap = 14
  const plotW = width - labelW - valueW
  const max = Math.max(0, ...groups.flatMap(g => g.bars.map(b => b.value))) || 1
  const groupH = series.length * (barH + gap) - gap
  const height = groups.length * (groupH + groupGap) + 4

  const body = groups
    .map((g, gi) => {
      const top = 4 + gi * (groupH + groupGap)
      const bars = g.bars
        .map((b, si) => {
          const y = top + si * (barH + gap)
          const w = Math.max(0, (b.value / max) * plotW)
          const s = series[si]

          return `<g><title>${esc(`${g.label} · ${s?.label}: ${b.text}`)}</title>
  <path d="${barPath(labelW, y, w, barH)}" fill="${s?.color}"/>
  <text x="${labelW + w + 6}" y="${y + barH / 2}" dominant-baseline="middle" class="val small">${esc(b.text)}</text></g>`
        })
        .join('\n')

      return `<text x="0" y="${top + groupH / 2}" dominant-baseline="middle" class="lbl">${esc(g.label)}</text>\n${bars}`
    })
    .join('\n')

  const legend = series.map(s => `<span>${swatch(s.color)}${esc(s.label)}</span>`).join('')

  return `<figure class="chart"><figcaption>${esc(title)}</figcaption>
<div class="legend">${legend}</div>
<svg viewBox="0 0 ${width} ${height}" width="${width}" role="img" aria-label="${esc(title)}">
  <line x1="${labelW}" y1="0" x2="${labelW}" y2="${height}" class="axis"/>
${body}
</svg></figure>`
}

export const tile = (label: string, value: string, note = ''): string =>
  `<div class="tile"><div class="label">${esc(label)}</div><div class="value">${value}</div>${note === '' ? '' : `<div class="note">${note}</div>`}</div>`

/** A table; cells are HTML. Columns named in `numeric` are right-aligned. */
export const table = (head: readonly string[], rows: readonly (readonly string[])[], numeric: readonly number[] = []): string => {
  const align = (i: number) => (numeric.includes(i) ? ' class="num"' : '')

  return `<div class="scroll"><table>
<thead><tr>${head.map((h, i) => `<th${align(i)}>${esc(h)}</th>`).join('')}</tr></thead>
<tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${align(i)}>${c}</td>`).join('')}</tr>`).join('\n')}</tbody>
</table></div>`
}

const STYLE = `
:root {
  color-scheme: light;
  --page: #f9f9f7; --surface: #fcfcfb; --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781;
  --grid: #e1e0d9; --axis: #c3c2b7; --border: rgba(11,11,11,0.10);
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100;
  --good-text: #006300; --critical: #d03b3b; --warning: #fab219; --warning-wash: #fff6dd;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --page: #0d0d0d; --surface: #1a1a19; --ink: #f0efec; --ink-2: #c3c2b7; --muted: #898781;
    --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10);
    --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500;
    --good-text: #0ca30c; --critical: #e66767; --warning-wash: #2e2610;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --page: #0d0d0d; --surface: #1a1a19; --ink: #f0efec; --ink-2: #c3c2b7; --muted: #898781;
  --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10);
  --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500;
  --good-text: #0ca30c; --critical: #e66767; --warning-wash: #2e2610;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--ink); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1180px; margin: 0 auto; padding: 32px 16px 40px; }
h1 { font-size: 24px; line-height: 1.25; margin: 0 0 6px; }
h2 { font-size: 17px; margin: 36px 0 12px; }
h3 { font-size: 14px; margin: 20px 0 8px; }
p { margin: 0 0 10px; }
.sub, .note { color: var(--ink-2); }
.note { font-size: 12px; margin-top: 2px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
.cards { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
.tiles { display: grid; gap: 10px 16px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 10px; }
.tile .label { color: var(--ink-2); font-size: 12px; }
.tile .value { font-size: 22px; font-weight: 600; }
.charts { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); }
.chart { margin: 0; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
figcaption { font-weight: 600; margin-bottom: 8px; }
/* Charts keep their drawn size, so their text matches the page's; they shrink on narrow screens. */
.chart svg { display: block; max-width: 100%; height: auto; }
svg .lbl { fill: var(--ink-2); font-size: 12px; }
svg .val { fill: var(--ink); font-size: 12px; font-variant-numeric: tabular-nums; }
svg .small { font-size: 11px; }
svg .axis { stroke: var(--axis); stroke-width: 1; }
.legend { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 8px; color: var(--ink-2); font-size: 12px; }
.swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; }
.scroll { overflow-x: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 7px 12px; border-bottom: 1px solid var(--grid); white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
th { color: var(--ink-2); font-weight: 600; font-size: 12px; }
.num { text-align: right; }
.pass { color: var(--good-text); font-weight: 600; }
.fail { color: var(--critical); font-weight: 600; }
.banner { border: 2px solid var(--warning); background: var(--warning-wash); border-radius: 10px; padding: 12px 16px; margin: 16px 0; }
.banner strong { display: block; font-size: 15px; }
/* A hash wraps rather than overflow: a screenshot must show every character. */
.hash { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: 12px; word-break: break-all; white-space: normal; }
code { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: 12px; }
pre { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; overflow-x: auto; }
footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid var(--grid); color: var(--muted); font-size: 12px; }
`

export const page = (title: string, body: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body><main>
${body}
</main></body>
</html>
`
