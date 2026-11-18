import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { ScannedPackage } from '../types';
import { lastSeen, pkgKey, plural, riskBand, STATUS_LABEL } from '../format';

interface Props {
  packages: ScannedPackage[];
  /** Selected package as name@version. */
  selected: string | null;
  /** Resurrected packages as name@version. */
  resurrected: Set<string>;
  /** Called with name@version. */
  onSelect: (key: string) => void;
}

type Width = 'wide' | 'medium' | 'narrow';
/**
 * viewBox width per breakpoint. Phones keep the compact 600 layout so the map
 * stays short; the list under the map carries the readable names there.
 */
const VIEW_W: Record<Width, number> = { wide: 1000, medium: 600, narrow: 600 };

interface PlacedStone {
  pkg: ScannedPackage;
  x: number;
  baseline: number;
  scale: number;
  direct: boolean;
}

interface Tooltip {
  pkg: ScannedPackage;
  x: number;
  y: number;
}

const STONE_W = 64;
const STONE_H = 92;
const GAP = 20;

export function GraveyardMap({ packages, selected, resurrected, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<Width>('wide');
  const [tip, setTip] = useState<Tooltip | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setWidth(w >= 700 ? 'wide' : w >= 520 ? 'medium' : 'narrow');
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const zombies = useMemo(() => packages.filter((p) => p.score.zombie), [packages]);
  const living = packages.length - zombies.length;
  const layout = useMemo(() => layoutStones(zombies, VIEW_W[width]), [zombies, width]);
  const listed = useMemo(
    () => [...zombies].sort((a, b) => Number(b.direct) - Number(a.direct) || b.score.risk - a.score.risk),
    [zombies],
  );
  const { W, H, stones, fenceY } = layout;
  const stars = useMemo(() => makeStars(W, fenceY), [W, fenceY]);

  const showTip = (pkg: ScannedPackage, e: PointerEvent<SVGGElement>) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTip({ pkg, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const onKey = (key: string) => (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(key);
    }
  };

  const lanternCount = Math.min(living, Math.floor((W - 120) / 28));

  return (
    <div className="map" ref={wrapRef}>
      <svg
        className="map__svg"
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-label={`Graveyard map: ${plural(zombies.length, 'zombie package')}, ${plural(living, 'living package')}`}
      >
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#05060d" />
            <stop offset="0.55" stopColor="#141a33" />
            <stop offset="1" stopColor="#262b4a" />
          </linearGradient>
          <radialGradient id="moonGlow">
            <stop offset="0" stopColor="#f6efc9" stopOpacity="0.55" />
            <stop offset="1" stopColor="#f6efc9" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="hillBack" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1d2238" />
            <stop offset="1" stopColor="#11142a" />
          </linearGradient>
          <linearGradient id="hillFront" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#192036" />
            <stop offset="1" stopColor="#0a0c18" />
          </linearGradient>
          <linearGradient id="stone" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#8a91b0" />
            <stop offset="1" stopColor="#4a5070" />
          </linearGradient>
          <linearGradient id="stoneRisen" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#b8f5d6" />
            <stop offset="1" stopColor="#4d9f7c" />
          </linearGradient>
          <filter id="fogBlur" x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="14" />
          </filter>
        </defs>

        <rect width={W} height={H} fill="url(#sky)" />
        {stars.map((s, i) => (
          <circle key={i} className="star" cx={s.x} cy={s.y} r={s.r} style={{ animationDelay: `${s.delay}s` }} />
        ))}
        <circle cx={W - 120} cy={92} r={120} fill="url(#moonGlow)" />
        <circle cx={W - 120} cy={92} r={44} fill="#f3edc8" />
        <circle cx={W - 104} cy={82} r={7} fill="#e1d9ae" />
        <circle cx={W - 134} cy={106} r={5} fill="#e1d9ae" />
        <path className="bat" d={`M${W - 250},70 q8,-8 16,0 q4,-6 8,0 q8,-8 16,0 q-8,2 -12,8 q-4,-4 -8,0 q-4,-6 -20,-8z`} fill="#05060d" />

        {/* Back hill and fence with living packages as lanterns */}
        <path
          d={`M0,${fenceY + 30} C${W * 0.2},${fenceY - 30} ${W * 0.45},${fenceY + 10} ${W * 0.62},${fenceY - 18} S${W * 0.9},${fenceY + 4} ${W},${fenceY - 10} V${H} H0 Z`}
          fill="url(#hillBack)"
        />
        <g className="fence" aria-hidden="true">
          <line x1={40} x2={W - 40} y1={fenceY + 4} y2={fenceY + 4} />
          <line x1={40} x2={W - 40} y1={fenceY + 16} y2={fenceY + 16} />
          {Array.from({ length: Math.floor((W - 80) / 28) + 1 }, (_, i) => (
            <path key={i} d={`M${40 + i * 28},${fenceY + 24} V${fenceY - 6} l3,-6 l3,6 V${fenceY + 24}`} />
          ))}
        </g>
        <g aria-hidden="true">
          {Array.from({ length: lanternCount }, (_, i) => {
            const x = 60 + i * 28;
            return (
              <g key={i} className="lantern" style={{ animationDelay: `${(i * 0.37) % 3}s` }}>
                <line x1={x} x2={x} y1={fenceY - 2} y2={fenceY - 16} stroke="#3a3f5c" strokeWidth={1.5} />
                <circle cx={x} cy={fenceY - 20} r={4.5} />
              </g>
            );
          })}
        </g>
        {living > 0 && (
          <text className="map__fence-label" x={W - 44} y={fenceY - 30} textAnchor="end">
            {plural(living, 'living package')} beyond the fence
          </text>
        )}

        <path
          d={`M0,${fenceY + 70} C${W * 0.25},${fenceY + 40} ${W * 0.55},${fenceY + 80} ${W},${fenceY + 50} V${H} H0 Z`}
          fill="url(#hillFront)"
        />

        {stones.map((s) => (
          <Tombstone
            key={pkgKey(s.pkg)}
            stone={s}
            selected={selected === pkgKey(s.pkg)}
            risen={resurrected.has(pkgKey(s.pkg))}
            onSelect={() => onSelect(pkgKey(s.pkg))}
            onKey={onKey(pkgKey(s.pkg))}
            onHover={(e) => showTip(s.pkg, e)}
            onLeave={() => setTip(null)}
          />
        ))}

        <g className="fog" aria-hidden="true">
          <ellipse cx={W * 0.25} cy={H - 30} rx={W * 0.3} ry={26} filter="url(#fogBlur)" />
          <ellipse cx={W * 0.75} cy={H - 12} rx={W * 0.32} ry={22} filter="url(#fogBlur)" className="fog__b" />
        </g>

        {zombies.length === 0 && (
          <g className="map__empty">
            <text x={W / 2} y={fenceY + 120} textAnchor="middle" className="map__empty-title">
              Nothing buried here
            </text>
            <text x={W / 2} y={fenceY + 150} textAnchor="middle" className="map__empty-sub">
              {living > 0 ? `All ${plural(living, 'package')} still have a pulse.` : 'The lockfile lists no packages.'}
            </text>
          </g>
        )}
      </svg>

      {tip && (
        <div
          className="map__tip"
          style={{ left: Math.min(tip.x + 14, (wrapRef.current?.clientWidth ?? 0) - 230), top: tip.y + 14 }}
          role="tooltip"
        >
          <strong>
            {tip.pkg.name}@{tip.pkg.version}
          </strong>
          <span>
            {STATUS_LABEL[tip.pkg.score.status]} · risk {Math.round(tip.pkg.score.risk)}
          </span>
          <span>
            {tip.pkg.direct ? 'Direct dependency' : `Transitive, via ${tip.pkg.dependents.slice(0, 2).join(', ') || 'another package'}`}
          </span>
          {tip.pkg.signals.advisories.length > 0 && (
            <span className="map__tip-flaw">{plural(tip.pkg.signals.advisories.length, 'known flaw')}</span>
          )}
          {resurrected.has(pkgKey(tip.pkg)) && <span className="map__tip-risen">Resurrected</span>}
        </div>
      )}

      {width === 'narrow' && listed.length > 0 && (
        <div className="map__list">
          <p className="map__list-title">Zombies, highest risk first</p>
          <ul>
            {listed.map((p) => {
              const key = pkgKey(p);
              return (
                <li key={key}>
                  <button
                    type="button"
                    className={`map__list-item${selected === key ? ' is-selected' : ''}`}
                    aria-pressed={selected === key}
                    onClick={() => onSelect(key)}
                  >
                    <i className={`dot dot--${riskBand(p.score.risk)}`} aria-hidden="true" />
                    <span className="map__list-name mono">{p.name}</span>
                    <span className="muted small">
                      {p.version} · {p.direct ? 'direct' : 'transitive'} · risk {Math.round(p.score.risk)}
                    </span>
                    {p.signals.advisories.length > 0 && <i className="dot dot--flaw" aria-label="known flaw" />}
                    {resurrected.has(key) && <span className="map__tip-risen">Risen</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <ul className="map__legend" aria-label="Map legend">
        <li><i className="dot dot--high" /> High risk</li>
        <li><i className="dot dot--medium" /> Medium</li>
        <li><i className="dot dot--low" /> Low</li>
        <li><i className="dot dot--flaw" /> Known flaw</li>
        <li><i className="dot dot--risen" /> Resurrected</li>
        <li className="map__legend-note">Bigger stone = more code uses it · front row = direct</li>
      </ul>
    </div>
  );
}

interface StoneProps {
  stone: PlacedStone;
  selected: boolean;
  risen: boolean;
  onSelect: () => void;
  onKey: (e: KeyboardEvent<SVGGElement>) => void;
  onHover: (e: PointerEvent<SVGGElement>) => void;
  onLeave: () => void;
}

function Tombstone({ stone, selected, risen, onSelect, onKey, onHover, onLeave }: StoneProps) {
  const { pkg, x, baseline, scale } = stone;
  const band = riskBand(pkg.score.risk);
  const flaw = pkg.signals.advisories.length > 0;
  const name = pkg.name.length > 13 ? `${pkg.name.slice(0, 12)}…` : pkg.name;
  const nameSize = Math.min(11, 54 / Math.max(1, name.length * 0.62));
  const classes = ['stone', `stone--${band}`, selected && 'is-selected', risen && 'is-risen', flaw && 'has-flaw']
    .filter(Boolean)
    .join(' ');

  return (
    <g
      className={classes}
      transform={`translate(${x},${baseline}) scale(${scale})`}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      aria-label={`${pkg.name} ${pkg.version}, ${STATUS_LABEL[pkg.score.status]}, risk ${Math.round(pkg.score.risk)}${flaw ? `, ${pkg.signals.advisories.length} known flaws` : ''}${risen ? ', resurrected' : ''}`}
      onClick={onSelect}
      onKeyDown={onKey}
      onPointerEnter={onHover}
      onPointerMove={onHover}
      onPointerLeave={onLeave}
      onBlur={onLeave}
    >
      <ellipse className="stone__mound" cx={0} cy={2} rx={46} ry={8} />
      <g className="stone__body">
        {risen && <path className="stone__wisp" d="M-6,-104 q-10,-14 0,-26 q10,-12 0,-24 M8,-100 q8,-12 0,-22" />}
        <path className="stone__shape" d={`M-32,0 V-60 A32,32 0 0 1 32,-60 V0 Z`} />
        <rect className="stone__slab" x={-40} y={-5} width={80} height={9} rx={2} />
        <text className="stone__rip" y={-66} textAnchor="middle">{risen ? 'RISEN' : 'R.I.P.'}</text>
        <text className="stone__name" y={-46} textAnchor="middle" style={{ fontSize: nameSize }}>{name}</text>
        <text className="stone__seen" y={-30} textAnchor="middle">last seen {lastSeen(pkg)}</text>
        <text className="stone__risk" y={-15} textAnchor="middle">risk {Math.round(pkg.score.risk)}</text>
        {flaw && !risen && (
          <g className="stone__flaw">
            <path d="M10,-90 l-7,13 l8,8 l-9,13 l6,10" />
            <circle cx={25} cy={-82} r={8} />
            <text x={25} y={-78.5} textAnchor="middle">!</text>
          </g>
        )}
      </g>
    </g>
  );
}

function stoneScale(pkg: ScannedPackage): number {
  const usage = pkg.signals.usageSites || pkg.signals.dependents || 0;
  if (pkg.direct) {
    return 1.05 + Math.min(0.5, Math.log2(1 + usage) * 0.16) + pkg.score.risk / 350;
  }
  return 0.62 + Math.min(0.2, Math.log2(1 + usage) * 0.08) + pkg.score.risk / 600;
}

/** Highest-risk stone in the middle of each row, the rest fanning outwards. */
function centreOut<T>(items: T[]): T[] {
  const out: T[] = [];
  items.forEach((item, i) => {
    if (i % 2 === 0) out.push(item);
    else out.unshift(item);
  });
  return out;
}

function packRows(pkgs: ScannedPackage[], width: number): { pkg: ScannedPackage; scale: number }[][] {
  const rows: { pkg: ScannedPackage; scale: number }[][] = [];
  let row: { pkg: ScannedPackage; scale: number }[] = [];
  let used = 0;
  for (const pkg of pkgs) {
    const scale = stoneScale(pkg);
    const w = STONE_W * scale + GAP;
    if (row.length && used + w > width) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push({ pkg, scale });
    used += w;
  }
  if (row.length) rows.push(row);
  return rows;
}

function layoutStones(zombies: ScannedPackage[], W: number) {
  const byRisk = (a: ScannedPackage, b: ScannedPackage) => b.score.risk - a.score.risk;
  const usable = W - 90;
  const frontRows = packRows(zombies.filter((p) => p.direct).sort(byRisk), usable);
  const backRows = packRows(zombies.filter((p) => !p.direct).sort(byRisk), usable);
  // Rows listed back to front: transitive (furthest first), then direct.
  const rows = [...backRows.reverse(), ...frontRows.reverse()];

  // Each row sits far enough behind the one in front of it that its stones
  // show above the front stones' heads.
  const heights = rows.map((row) => Math.max(...row.map((r) => r.scale)) * STONE_H);
  const steps = heights.map((h, i) => (i === 0 ? h * 0.3 : Math.max(h * 0.9, heights[i - 1] * 0.55)));
  const stack = steps.reduce((a, b) => a + b, 0);
  const fenceY = W >= 1000 ? 250 : 270;
  const H = Math.max(W >= 1000 ? 560 : 620, fenceY + 110 + stack);

  const stones: PlacedStone[] = [];
  let baseline = H - 34 - stack;
  rows.forEach((row, i) => {
    baseline += steps[i];
    const ordered = centreOut(row);
    const total = ordered.reduce((sum, r) => sum + STONE_W * r.scale + GAP, 0) - GAP;
    let x = (W - total) / 2;
    ordered.forEach((r) => {
      const w = STONE_W * r.scale;
      stones.push({ pkg: r.pkg, scale: r.scale, x: x + w / 2, baseline, direct: r.pkg.direct });
      x += w + GAP;
    });
  });

  return { W, H, stones, fenceY };
}

function makeStars(W: number, maxY: number) {
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: Math.round(W / 14) }, () => ({
    x: rand() * W,
    y: rand() * (maxY - 40),
    r: 0.4 + rand() * 1.2,
    delay: rand() * 4,
  }));
}
