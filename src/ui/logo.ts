// Fictional product artwork. Revision 1 is a shade off; revision 2 is Isha's correction.
export const LOGO_COLORS: Record<number, string> = { 1: '#e8833a', 2: '#14b8a6' };

export function logoSvg(rev: number | null, size = 56): string {
  if (!rev)
    return `<svg width="${size}" height="${size}" viewBox="0 0 56 56" role="img" aria-label="No logo yet"><rect x="2" y="2" width="52" height="52" rx="10" fill="none" stroke="currentColor" stroke-dasharray="5 4" opacity=".5"/><text x="28" y="33" text-anchor="middle" font-size="10" fill="currentColor" opacity=".6">logo</text></svg>`;
  const c = LOGO_COLORS[rev] ?? '#888';
  return `<svg width="${size}" height="${size}" viewBox="0 0 56 56" role="img" aria-label="Lumen logo revision ${rev}"><circle cx="28" cy="28" r="24" fill="${c}"/><circle cx="34" cy="22" r="14" fill="#fff" opacity=".9"/><circle cx="28" cy="28" r="24" fill="none" stroke="#0002" stroke-width="2"/></svg>`;
}

/** Draws a preview/live page onto a 2D canvas for the 3D monitors. */
export function drawPage(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: { title: string; logoRev: number | null; locked?: boolean; version: number },
) {
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = opts.locked ? '#475569' : '#0f172a';
  ctx.fillRect(0, 0, w, h * 0.16);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = `600 ${Math.round(h * 0.08)}px system-ui, sans-serif`;
  ctx.fillText(opts.title, w * 0.05, h * 0.11);
  ctx.textAlign = 'right';
  ctx.fillText(`v${opts.version}`, w * 0.95, h * 0.11);
  ctx.textAlign = 'left';
  const cx = w * 0.28;
  const cy = h * 0.52;
  const r = h * 0.2;
  if (opts.logoRev) {
    ctx.fillStyle = LOGO_COLORS[opts.logoRev] ?? '#888';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.beginPath();
    ctx.arc(cx + r * 0.25, cy - r * 0.25, r * 0.58, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = '#94a3b8';
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 3;
    ctx.strokeRect(cx - r, cy - r, r * 2, r * 2);
    ctx.setLineDash([]);
  }
  ctx.fillStyle = '#0f172a';
  ctx.font = `700 ${Math.round(h * 0.13)}px system-ui, sans-serif`;
  ctx.fillText('Lumen', w * 0.5, h * 0.5);
  ctx.fillStyle = '#64748b';
  ctx.font = `${Math.round(h * 0.07)}px system-ui, sans-serif`;
  ctx.fillText(opts.locked ? 'Coming soon' : 'Launching tonight', w * 0.5, h * 0.64);
  if (opts.locked) {
    ctx.fillStyle = '#475569';
    ctx.font = `600 ${Math.round(h * 0.07)}px system-ui, sans-serif`;
    ctx.fillText('🔒 Protected', w * 0.05, h * 0.92);
  }
}
