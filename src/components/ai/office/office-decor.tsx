"use client";

import { memo, type ReactNode } from "react";
import type { DecorArt, DecorItem } from "@/lib/office/decor";
import { DEPTH_RANK, depthZ } from "@/lib/office/depth";

/**
 * Office decorations, drawn as small pixel-style SVGs in the office's existing look: flat
 * fills, thick dark outlines, Acton navy and gold, warm wood. No tiny text — charts, plans,
 * and documents are symbols. Each item is positioned in world space and depth-sorted:
 * wall art behind characters, rugs under them, floor furniture by its baseline.
 */

const INK = "#2b2118";
const NAVY = "#1e3a5f";
const NAVY_DARK = "#0b1f3a";
const GOLD = "#f5c518";
const WOOD = "#a0703f";
const WOOD_LIGHT = "#c38b52";
const WOOD_DARK = "#7a5230";
const PAPER = "#fffaf0";
const BLUEPRINT = "#2f5f9e";
const GREEN = "#3f8f4f";
const GREEN_LIGHT = "#5aa863";
const STEEL = "#7d8591";
const STEEL_LIGHT = "#c9cdd4";
const RED = "#c0503a";
const CORK = "#c99a5b";
const SKY = "#58c4f5";

const sw = 2; // outline width

function Box(props: { x: number; y: number; w: number; h: number; fill: string; r?: number }) {
  return (
    <rect
      x={props.x}
      y={props.y}
      width={Math.max(0, props.w)}
      height={Math.max(0, props.h)}
      rx={props.r ?? 0}
      fill={props.fill}
      stroke={INK}
      strokeWidth={sw}
    />
  );
}

function Bars({
  x,
  y,
  w,
  h,
  colors,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  colors: string[];
}) {
  const n = colors.length;
  const bw = w / (n * 1.6);
  return (
    <g>
      {colors.map((c, i) => {
        const bh = h * (0.35 + ((i * 37) % 60) / 100);
        return <rect key={i} x={x + i * bw * 1.6} y={y + h - bh} width={bw} height={bh} fill={c} />;
      })}
    </g>
  );
}

function Plant({ w, h, tall }: { w: number; h: number; tall?: boolean }) {
  const potH = tall ? h * 0.22 : h * 0.38;
  return (
    <g>
      {tall ? (
        <rect x={w / 2 - 1.5} y={h * 0.35} width={3} height={h * 0.45} fill={WOOD_DARK} />
      ) : null}
      <circle
        cx={w * 0.35}
        cy={tall ? h * 0.3 : h * 0.4}
        r={w * 0.28}
        fill={GREEN}
        stroke={INK}
        strokeWidth={sw}
      />
      <circle
        cx={w * 0.65}
        cy={tall ? h * 0.22 : h * 0.34}
        r={w * 0.26}
        fill={GREEN_LIGHT}
        stroke={INK}
        strokeWidth={sw}
      />
      <circle
        cx={w * 0.5}
        cy={tall ? h * 0.12 : h * 0.22}
        r={w * 0.24}
        fill={GREEN}
        stroke={INK}
        strokeWidth={sw}
      />
      <Box x={w * 0.2} y={h - potH - 1} w={w * 0.6} h={potH} fill={tall ? NAVY : "#a0522d"} />
    </g>
  );
}

function Shelf({ w, h, books }: { w: number; h: number; books: string[] }) {
  const rows = 3;
  const rh = (h - 6) / rows;
  return (
    <g>
      <Box x={1} y={1} w={w - 2} h={h - 2} fill={WOOD} />
      {Array.from({ length: rows }, (_, r) => (
        <g key={r}>
          {books.map((c, i) => {
            const bw = (w - 8) / books.length;
            const tall = (i + r) % 3 === 0 ? 0.55 : 0.75;
            return (
              <rect
                key={i}
                x={4 + i * bw}
                y={3 + r * rh + rh * (1 - tall)}
                width={bw - 1}
                height={rh * tall - 2}
                fill={books[(i + r) % books.length]}
              />
            );
          })}
          <rect x={2} y={3 + (r + 1) * rh - 2} width={w - 4} height={2} fill={WOOD_DARK} />
        </g>
      ))}
    </g>
  );
}

function Frame({
  w,
  h,
  children,
  fill = PAPER,
}: {
  w: number;
  h: number;
  children?: ReactNode;
  fill?: string;
}) {
  return (
    <g>
      <Box x={1} y={1} w={w - 2} h={h - 2} fill={WOOD_DARK} />
      <rect x={4} y={4} width={w - 8} height={h - 8} fill={fill} />
      {children}
    </g>
  );
}

function Chair({ w, h }: { w: number; h: number }) {
  return (
    <g>
      <Box x={w * 0.15} y={1} w={w * 0.7} h={h * 0.5} fill={NAVY} r={2} />
      <Box x={1} y={h * 0.48} w={w - 2} h={h * 0.22} fill={NAVY_DARK} r={2} />
      <rect x={w * 0.2} y={h * 0.7} width={2} height={h * 0.3 - 1} fill={INK} />
      <rect x={w * 0.8 - 2} y={h * 0.7} width={2} height={h * 0.3 - 1} fill={INK} />
    </g>
  );
}

function Cabinet({
  w,
  h,
  drawers,
  lock,
}: {
  w: number;
  h: number;
  drawers: number;
  lock?: boolean;
}) {
  const dh = (h - 6) / drawers;
  return (
    <g>
      <Box x={1} y={1} w={w - 2} h={h - 2} fill={lock ? "#4b5563" : STEEL} />
      {Array.from({ length: drawers }, (_, i) => (
        <g key={i}>
          <rect
            x={4}
            y={4 + i * dh}
            width={w - 8}
            height={dh - 3}
            fill={lock ? "#5b6472" : STEEL_LIGHT}
            stroke={INK}
            strokeWidth={1}
          />
          <rect x={w / 2 - 3} y={4 + i * dh + dh / 2 - 2} width={6} height={2} fill={INK} />
        </g>
      ))}
      {lock ? (
        <g>
          <rect
            x={w / 2 - 4}
            y={h * 0.18}
            width={8}
            height={7}
            fill={GOLD}
            stroke={INK}
            strokeWidth={1}
          />
          <path
            d={`M${w / 2 - 2.5} ${h * 0.18} v-3 a2.5 2.5 0 0 1 5 0 v3`}
            fill="none"
            stroke={INK}
            strokeWidth={1.5}
          />
        </g>
      ) : null}
    </g>
  );
}

function Table({
  w,
  h,
  top = WOOD_LIGHT,
  children,
}: {
  w: number;
  h: number;
  top?: string;
  children?: ReactNode;
}) {
  return (
    <g>
      <rect x={4} y={h * 0.55} width={3} height={h * 0.45 - 1} fill={INK} />
      <rect x={w - 7} y={h * 0.55} width={3} height={h * 0.45 - 1} fill={INK} />
      <Box x={1} y={h * 0.38} w={w - 2} h={h * 0.2} fill={top} />
      {children}
    </g>
  );
}

const ART: Record<DecorArt, (w: number, h: number) => ReactNode> = {
  bookcase: (w, h) => <Shelf w={w} h={h} books={[NAVY, GOLD, RED, BLUEPRINT, PAPER, GREEN]} />,
  dataShelf: (w, h) => <Shelf w={w} h={h} books={[NAVY, SKY, GOLD, NAVY_DARK, STEEL_LIGHT]} />,
  policyShelf: (w, h) => <Shelf w={w} h={h} books={["#5b3f8c", NAVY, PAPER, "#7a5aa8", GOLD]} />,
  plant: (w, h) => <Plant w={w} h={h} />,
  tallPlant: (w, h) => <Plant w={w} h={h} tall />,
  strategyBoard: (w, h) => (
    <Frame w={w} h={h}>
      {/* roadmap: three swimlanes of milestones */}
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect
            x={8}
            y={8 + i * ((h - 16) / 3)}
            width={(w - 16) * (0.4 + i * 0.2)}
            height={(h - 16) / 3 - 3}
            fill={[NAVY, GOLD, BLUEPRINT][i]}
          />
          <circle
            cx={8 + (w - 16) * (0.4 + i * 0.2)}
            cy={8 + i * ((h - 16) / 3) + (h - 16) / 6 - 1.5}
            r={2.5}
            fill={RED}
          />
        </g>
      ))}
    </Frame>
  ),
  framedPlan: (w, h) => (
    <Frame w={w} h={h} fill={BLUEPRINT}>
      {/* ADU floor plan */}
      <rect
        x={8}
        y={8}
        width={w - 16}
        height={h - 16}
        fill="none"
        stroke={PAPER}
        strokeWidth={1.5}
      />
      <path d={`M${w / 2} 8 V${h - 8} M8 ${h / 2} H${w / 2}`} stroke={PAPER} strokeWidth={1} />
      <rect x={w - 14} y={h - 14} width={4} height={4} fill={PAPER} />
    </Frame>
  ),
  award: (w, h) => (
    <Frame w={w} h={h} fill={NAVY}>
      <path
        d={`M${w / 2} ${h * 0.25} l2.4 4.8 5.2 .8 -3.8 3.7 .9 5.2 -4.7 -2.5 -4.7 2.5 .9 -5.2 -3.8 -3.7 5.2 -.8z`}
        fill={GOLD}
      />
    </Frame>
  ),
  credenza: (w, h) => (
    <g>
      <Box x={1} y={h * 0.45} w={w - 2} h={h * 0.55 - 1} fill={WOOD} />
      <path
        d={`M${w / 3} ${h * 0.5} V${h - 3} M${(2 * w) / 3} ${h * 0.5} V${h - 3}`}
        stroke={WOOD_DARK}
        strokeWidth={1.5}
      />
      {/* small ADU model: house with gold roof */}
      <Box x={w * 0.12} y={h * 0.22} w={w * 0.32} h={h * 0.24} fill={PAPER} />
      <path
        d={`M${w * 0.09} ${h * 0.24} L${w * 0.28} ${h * 0.04} L${w * 0.47} ${h * 0.24} Z`}
        fill={GOLD}
        stroke={INK}
        strokeWidth={sw}
      />
      <rect x={w * 0.25} y={h * 0.32} width={w * 0.07} height={h * 0.14} fill={NAVY} />
      {/* desk lamp */}
      <rect x={w * 0.76} y={h * 0.15} width={2} height={h * 0.3} fill={INK} />
      <path
        d={`M${w * 0.68} ${h * 0.2} L${w * 0.88} ${h * 0.2} L${w * 0.82} ${h * 0.04} L${w * 0.74} ${h * 0.04} Z`}
        fill={GOLD}
        stroke={INK}
        strokeWidth={sw}
      />
    </g>
  ),
  blueprintTubes: (w, h) => (
    <g>
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={2 + i * (w / 3.4)}
          y={2 + i * 3}
          width={w / 3.2}
          height={h - 4 - i * 3}
          rx={2}
          fill={[BLUEPRINT, PAPER, NAVY][i]}
          stroke={INK}
          strokeWidth={1.5}
        />
      ))}
    </g>
  ),
  roundTable: (w, h) => (
    <g>
      <rect x={w / 2 - 2} y={h * 0.5} width={4} height={h * 0.5 - 2} fill={INK} />
      <ellipse
        cx={w / 2}
        cy={h * 0.42}
        rx={w / 2 - 1}
        ry={h * 0.28}
        fill={WOOD_LIGHT}
        stroke={INK}
        strokeWidth={sw}
      />
      <rect x={w * 0.4} y={h * 0.32} width={w * 0.2} height={h * 0.12} fill={PAPER} />
    </g>
  ),
  chair: (w, h) => <Chair w={w} h={h} />,
  rug: (w, h) => (
    <g>
      <rect
        x={1}
        y={1}
        width={w - 2}
        height={h - 2}
        fill={NAVY}
        stroke={INK}
        strokeWidth={sw}
        opacity={0.85}
      />
      <rect
        x={6}
        y={6}
        width={w - 12}
        height={h - 12}
        fill="none"
        stroke={GOLD}
        strokeWidth={2}
        opacity={0.9}
      />
    </g>
  ),
  roundRug: (w, h) => (
    <g>
      <ellipse
        cx={w / 2}
        cy={h / 2}
        rx={w / 2 - 1}
        ry={h / 2 - 1}
        fill="#d9a441"
        stroke={INK}
        strokeWidth={sw}
        opacity={0.75}
      />
      <ellipse
        cx={w / 2}
        cy={h / 2}
        rx={w / 2 - 8}
        ry={h / 2 - 6}
        fill="none"
        stroke={PAPER}
        strokeWidth={2}
        opacity={0.8}
      />
    </g>
  ),
  floorLamp: (w, h) => (
    <g>
      <rect x={w / 2 - 1} y={h * 0.3} width={2} height={h * 0.65} fill={INK} />
      <rect x={w * 0.15} y={h - 4} width={w * 0.7} height={3} fill={INK} />
      <path
        d={`M1 ${h * 0.32} L${w - 1} ${h * 0.32} L${w * 0.75} 2 L${w * 0.25} 2 Z`}
        fill="#ffd27a"
        stroke={INK}
        strokeWidth={sw}
      />
    </g>
  ),
  fileCabinet: (w, h) => (
    <g>
      <Cabinet w={w} h={h} drawers={4} />
      {/* inbox/outbox trays */}
      <rect x={3} y={-4} width={w - 6} height={4} fill={PAPER} stroke={INK} strokeWidth={1} />
    </g>
  ),
  lockedCabinet: (w, h) => <Cabinet w={w} h={h} drawers={3} lock />,
  onboardingTable: (w, h) => (
    <Table w={w} h={h}>
      {/* welcome kits: gold box, clipboard, badge */}
      <Box x={w * 0.08} y={h * 0.12} w={w * 0.28} h={h * 0.26} fill={GOLD} />
      <rect x={w * 0.2} y={h * 0.12} width={2} height={h * 0.26} fill={NAVY} />
      <Box x={w * 0.44} y={h * 0.06} w={w * 0.2} h={h * 0.32} fill={WOOD_LIGHT} />
      <rect x={w * 0.47} y={h * 0.12} width={w * 0.14} height={h * 0.22} fill={PAPER} />
      <Box x={w * 0.72} y={h * 0.16} w={w * 0.18} h={h * 0.22} fill={NAVY} />
      <circle cx={w * 0.81} cy={h * 0.24} r={2} fill={GOLD} />
    </Table>
  ),
  bulletinBoard: (w, h) => (
    <Frame w={w} h={h} fill={CORK}>
      {/* calendar, people, checklist, onboarding star — as pinned icons */}
      <rect x={8} y={8} width={w * 0.22} height={h * 0.38} fill={PAPER} />
      <rect x={8} y={8} width={w * 0.22} height={4} fill={RED} />
      <circle cx={w * 0.45} cy={h * 0.32} r={4} fill={NAVY} />
      <path d={`M${w * 0.45 - 6} ${h * 0.62} a6 5 0 0 1 12 0 z`} fill={NAVY} />
      <rect x={w * 0.62} y={8} width={w * 0.26} height={h * 0.5} fill={PAPER} />
      <path d={`M${w * 0.65} ${h * 0.3} l3 3 5 -6`} stroke={GREEN} strokeWidth={2} fill="none" />
      <rect x={10} y={h * 0.62} width={w * 0.2} height={h * 0.22} fill={GOLD} />
      {[0.18, 0.45, 0.72].map((f) => (
        <circle key={f} cx={w * f} cy={7} r={1.8} fill={RED} />
      ))}
    </Frame>
  ),
  calendarBoard: (w, h) => (
    <Frame w={w} h={h}>
      <rect x={4} y={4} width={w - 8} height={5} fill={NAVY} />
      {Array.from({ length: 9 }, (_, i) => (
        <rect
          key={i}
          x={6 + (i % 3) * ((w - 12) / 3)}
          y={11 + Math.floor(i / 3) * ((h - 16) / 3)}
          width={(w - 12) / 3 - 2}
          height={(h - 16) / 3 - 2}
          fill={i === 4 ? GOLD : "#e8e2d4"}
        />
      ))}
    </Frame>
  ),
  checklistBoard: (w, h) => (
    <Frame w={w} h={h}>
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect
            x={7}
            y={8 + i * ((h - 14) / 3)}
            width={4}
            height={4}
            fill="none"
            stroke={INK}
            strokeWidth={1}
          />
          {i < 2 ? (
            <path
              d={`M7 ${10 + i * ((h - 14) / 3)} l2 2 3 -4`}
              stroke={GREEN}
              strokeWidth={1.5}
              fill="none"
            />
          ) : null}
          <rect x={14} y={9 + i * ((h - 14) / 3)} width={w - 22} height={2} fill={STEEL} />
        </g>
      ))}
    </Frame>
  ),
  divider: (w, h) => (
    <g>
      <Box x={1} y={1} w={w - 2} h={h - 5} fill="#8fa6bf" r={2} />
      {Array.from({ length: Math.floor(h / 8) }, (_, i) => (
        <rect key={i} x={2} y={4 + i * 8} width={w - 4} height={2} fill="#7690ab" />
      ))}
      <rect x={0} y={h - 4} width={w} height={3} fill={INK} />
    </g>
  ),
  whiteboard: (w, h) => (
    <g>
      <Box x={1} y={1} w={w - 2} h={h - 4} fill="#f7f9fb" />
      <rect x={4} y={h - 4} width={w - 8} height={3} fill={STEEL} />
      {/* line chart, bars, and a flow arrow */}
      <polyline
        points={`8,${h * 0.7} ${w * 0.15},${h * 0.5} ${w * 0.25},${h * 0.58} ${w * 0.38},${h * 0.25}`}
        fill="none"
        stroke={BLUEPRINT}
        strokeWidth={2}
      />
      <Bars x={w * 0.46} y={h * 0.2} w={w * 0.22} h={h * 0.55} colors={[GOLD, NAVY, GOLD, NAVY]} />
      <circle
        cx={w * 0.82}
        cy={h * 0.45}
        r={Math.min(w, h) * 0.18}
        fill="none"
        stroke={RED}
        strokeWidth={2}
      />
      <path
        d={`M${w * 0.82} ${h * 0.45} L${w * 0.82} ${h * 0.45 - Math.min(w, h) * 0.18}`}
        stroke={RED}
        strokeWidth={2}
      />
    </g>
  ),
  kpiDisplay: (w, h) => (
    <g>
      <Box x={1} y={1} w={w - 2} h={h - 2} fill={NAVY_DARK} r={2} />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect
            x={5 + (i % 2) * ((w - 10) / 2)}
            y={5 + Math.floor(i / 2) * ((h - 10) / 2)}
            width={(w - 10) / 2 - 3}
            height={(h - 10) / 2 - 3}
            fill={NAVY}
          />
          <rect
            x={8 + (i % 2) * ((w - 10) / 2)}
            y={8 + Math.floor(i / 2) * ((h - 10) / 2)}
            width={((w - 10) / 2 - 9) * [0.8, 0.5, 0.65, 0.9][i]!}
            height={3}
            fill={[GOLD, SKY, GREEN_LIGHT, GOLD][i]}
          />
        </g>
      ))}
    </g>
  ),
  serverRack: (w, h) => (
    <g>
      <Box x={1} y={1} w={w - 2} h={h - 2} fill="#2f3640" />
      {Array.from({ length: 5 }, (_, i) => (
        <g key={i}>
          <rect
            x={4}
            y={4 + i * ((h - 8) / 5)}
            width={w - 8}
            height={(h - 8) / 5 - 2}
            fill="#3d4652"
          />
          <rect
            className="ai-office-led"
            x={6}
            y={6 + i * ((h - 8) / 5)}
            width={2}
            height={2}
            fill={i % 2 ? GREEN_LIGHT : SKY}
          />
          <rect x={10} y={6 + i * ((h - 8) / 5)} width={2} height={2} fill={GOLD} />
        </g>
      ))}
    </g>
  ),
  printerTable: (w, h) => (
    <Table w={w} h={h}>
      {/* printer with a page coming out, and a stack of report folders */}
      <Box x={w * 0.08} y={h * 0.1} w={w * 0.5} h={h * 0.28} fill={STEEL_LIGHT} />
      <rect
        x={w * 0.18}
        y={h * 0.02}
        width={w * 0.3}
        height={h * 0.12}
        fill={PAPER}
        stroke={INK}
        strokeWidth={1}
      />
      <rect x={w * 0.14} y={h * 0.2} width={w * 0.38} height={2} fill={INK} />
      <Box x={w * 0.66} y={h * 0.2} w={w * 0.26} h={h * 0.18} fill={NAVY} />
      <rect x={w * 0.66} y={h * 0.26} width={w * 0.26} height={2} fill={GOLD} />
    </Table>
  ),
  reviewTable: (w, h) => (
    <Table w={w} h={h}>
      {/* printed charts laid out for review, plus a calculator */}
      <rect
        x={w * 0.08}
        y={h * 0.18}
        width={w * 0.28}
        height={h * 0.22}
        fill={PAPER}
        stroke={INK}
        strokeWidth={1}
      />
      <Bars x={w * 0.11} y={h * 0.22} w={w * 0.2} h={h * 0.15} colors={[NAVY, GOLD, NAVY]} />
      <rect
        x={w * 0.42}
        y={h * 0.16}
        width={w * 0.26}
        height={h * 0.24}
        fill={PAPER}
        stroke={INK}
        strokeWidth={1}
      />
      <circle cx={w * 0.55} cy={h * 0.28} r={h * 0.08} fill={GOLD} stroke={NAVY} strokeWidth={2} />
      <Box x={w * 0.76} y={h * 0.18} w={w * 0.16} h={h * 0.22} fill={STEEL} />
      <rect x={w * 0.79} y={h * 0.21} width={w * 0.1} height={h * 0.05} fill={GREEN_LIGHT} />
    </Table>
  ),
  chartEasel: (w, h) => (
    <g>
      <path
        d={`M${w * 0.2} ${h - 1} L${w / 2} ${h * 0.1} L${w * 0.8} ${h - 1}`}
        stroke={WOOD_DARK}
        strokeWidth={3}
        fill="none"
      />
      <Box x={2} y={2} w={w - 4} h={h * 0.62} fill={PAPER} />
      <polyline
        points={`6,${h * 0.5} ${w * 0.35},${h * 0.35} ${w * 0.55},${h * 0.42} ${w - 6},${h * 0.14}`}
        fill="none"
        stroke={GREEN}
        strokeWidth={2}
      />
      <path d={`M${w - 10} ${h * 0.12} l4 2 -2 4`} stroke={GREEN} strokeWidth={2} fill="none" />
    </g>
  ),
  waterBowl: (w, h) => (
    <g>
      <ellipse
        cx={w / 2}
        cy={h / 2}
        rx={w / 2 - 1}
        ry={h / 2 - 1}
        fill={NAVY}
        stroke={INK}
        strokeWidth={1.5}
      />
      <ellipse cx={w / 2} cy={h / 2 - 0.5} rx={w / 2 - 4} ry={h / 2 - 2.5} fill={SKY} />
    </g>
  ),
  meetingTable: (w, h) => (
    <g>
      <rect
        x={1.5}
        y={1.5}
        width={w - 3}
        height={h - 3}
        fill="var(--office-desk)"
        stroke={INK}
        strokeWidth={3}
      />
      <rect x={3} y={3} width={w - 6} height={5} fill="var(--office-desk-top)" />
    </g>
  ),
};

function DecorPiece({ item }: { item: DecorItem }) {
  const z =
    item.layer === "wall"
      ? depthZ("wall")
      : item.layer === "rug"
        ? depthZ("background")
        : depthZ("world", item.sortY, DEPTH_RANK.decor);
  const w = Math.round(item.w);
  const h = Math.round(item.h);
  return (
    <span
      className="pointer-events-none absolute"
      data-decor={item.art}
      data-layer={item.layer}
      data-label={item.label}
      style={{ left: item.x, top: item.y, width: w, height: h, zIndex: z }}
    >
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} overflow="visible" aria-hidden>
        {ART[item.art](w, h)}
      </svg>
    </span>
  );
}

/** All decorations for the office; memoized because the list only changes with the layout. */
export const OfficeDecor = memo(function OfficeDecor({ items }: { items: DecorItem[] }) {
  return (
    <>
      {items.map((item) => (
        <DecorPiece key={item.id} item={item} />
      ))}
    </>
  );
});
