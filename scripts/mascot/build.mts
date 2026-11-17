// Draws the mascot, a young Greco-Roman wrestler in ear guards and a red singlet, in every mood the
// interface uses, and writes them to public/mascot/<mood>.svg. The files are plain images: no
// JavaScript, cached by the browser, the same for every language. Run after changing a part:
//   pnpm mascot:build
import { mkdir, writeFile } from "node:fs/promises";

import { MASCOT_MOODS, type MascotMood } from "../../src/lib/mascot.ts";

const OUTLINE = "#2b1b1e";
const SKIN = "#eeb98c";
const SKIN_SHADE = "#d99e70";
const HAIR = "#2a1d1a";
const RED = "#d0101f";
const RED_DARK = "#9c0d18";
const CHEEK = "#f2898a";
const SWEAT = "#5aa9e6";
const LINE = `stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;

type Point = readonly [number, number];
type Pose = { left: readonly Point[]; right: readonly Point[] };
type Face = { brows: string; eyes: string; mouth: string };

/** An arm as a rounded tube: a wide outline stroke under a skin stroke, a fist at the end. */
function arm(points: readonly Point[], id: string, fist = true): string {
  const d = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`)
    .join(" ");
  const end = points.at(-1) ?? [0, 0];
  const hand = fist
    ? `<circle cx="${end[0]}" cy="${end[1]}" r="9" fill="${SKIN}" ${LINE}/>`
    : "";
  return `<g class="${id}">
<path d="${d}" fill="none" stroke="${OUTLINE}" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/>
<path d="${d}" fill="none" stroke="${SKIN}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
${hand}</g>`;
}

// Hanging arms run along the torso and leave the picture at the bottom: no hand to draw.
const DOWN_LEFT: readonly Point[] = [
  [50, 128],
  [45, 170],
];

const POSES: Record<MascotMood, Pose> = {
  hello: {
    left: DOWN_LEFT,
    right: [
      [108, 126],
      [128, 112],
      [134, 88],
    ],
  },
  ok: {
    left: DOWN_LEFT,
    right: [
      [108, 128],
      [128, 126],
      [130, 108],
    ],
  },
  champion: {
    left: [
      [52, 126],
      [36, 104],
      [32, 78],
    ],
    right: [
      [108, 126],
      [124, 104],
      [128, 78],
    ],
  },
  search: {
    left: DOWN_LEFT,
    right: [
      [108, 128],
      [130, 118],
      [124, 98],
    ],
  },
  oops: {
    left: [
      [52, 126],
      [36, 112],
      [40, 90],
    ],
    right: [
      [108, 126],
      [124, 112],
      [120, 90],
    ],
  },
  stop: {
    left: DOWN_LEFT,
    right: [
      [108, 126],
      [128, 118],
      [132, 100],
    ],
  },
  lost: {
    left: [
      [52, 128],
      [30, 126],
      [22, 112],
    ],
    right: [
      [108, 128],
      [130, 126],
      [138, 112],
    ],
  },
  focus: {
    left: [
      [52, 128],
      [56, 140],
      [66, 132],
    ],
    right: [
      [108, 128],
      [104, 140],
      [94, 132],
    ],
  },
};

const EYES_OPEN = `<g class="eyes">
<ellipse cx="68" cy="74" rx="4" ry="5" fill="${OUTLINE}"/><ellipse cx="92" cy="74" rx="4" ry="5" fill="${OUTLINE}"/>
<circle cx="69.5" cy="72" r="1.5" fill="#fff"/><circle cx="93.5" cy="72" r="1.5" fill="#fff"/></g>`;
const EYES_HAPPY = `<path d="M62 76 Q68 68 74 76 M86 76 Q92 68 98 76" fill="none" ${LINE}/>`;

const FACES: Record<MascotMood, Face> = {
  hello: {
    brows: "M62 62 Q68 58 74 61 M86 61 Q92 58 98 62",
    eyes: EYES_OPEN,
    mouth: `<path d="M70 86 Q80 98 90 86 Z" fill="${RED_DARK}" ${LINE}/>`,
  },
  ok: {
    brows: "M62 63 Q68 60 74 63 M86 63 Q92 60 98 63",
    eyes: EYES_HAPPY,
    mouth: `<path d="M71 87 Q80 94 89 87" fill="none" ${LINE}/>`,
  },
  champion: {
    brows: "M61 61 Q68 56 75 60 M85 60 Q92 56 99 61",
    eyes: EYES_HAPPY,
    mouth: `<path d="M68 85 Q80 102 92 85 Z" fill="${RED_DARK}" ${LINE}/>`,
  },
  search: {
    brows: "M62 64 Q68 62 74 64 M86 59 Q92 55 98 59",
    eyes: EYES_OPEN,
    mouth: `<ellipse cx="80" cy="90" rx="3.5" ry="4" fill="${RED_DARK}" ${LINE}/>`,
  },
  oops: {
    brows: "M62 64 Q68 60 74 60 M86 60 Q92 60 98 64",
    eyes: EYES_OPEN,
    mouth: `<path d="M70 91 Q75 87 80 91 Q85 95 90 91" fill="none" ${LINE}/>`,
  },
  stop: {
    brows: "M62 61 L74 64 M86 64 L98 61",
    eyes: EYES_OPEN,
    mouth: `<path d="M72 90 L88 90" fill="none" ${LINE}/>`,
  },
  lost: {
    brows: "M62 60 Q68 57 74 60 M86 63 Q92 62 98 63",
    eyes: EYES_OPEN,
    mouth: `<path d="M72 91 Q80 87 88 90" fill="none" ${LINE}/>`,
  },
  focus: {
    brows: "M62 61 L74 65 M86 65 L98 61",
    eyes: EYES_OPEN,
    mouth: `<path d="M72 88 Q80 93 88 88" fill="none" ${LINE}/>`,
  },
};

/** Extra drawing for a mood: props in hand, a sweat drop, a question mark, sparkles. */
const PROPS: Record<MascotMood, string> = {
  hello: `<path class="wave-lines" d="M142 74 l6 -4 M144 84 l7 0 M142 94 l6 4" fill="none" stroke="${RED}" stroke-width="3" stroke-linecap="round"/>`,
  ok: `<rect x="125" y="89" width="9" height="16" rx="4.5" fill="${SKIN}" ${LINE}/>`,
  champion: `<g class="sparkle" fill="${RED}">
<path d="M20 50 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z"/><path d="M140 44 l2.5 6 6 2.5 -6 2.5 -2.5 6 -2.5 -6 -6 -2.5 6 -2.5z"/>
<path d="M24 112 l2 4 4 2 -4 2 -2 4 -2 -4 -4 -2 4 -2z"/></g>`,
  search: `<path d="M112 86 L122 98" stroke="${OUTLINE}" stroke-width="7" stroke-linecap="round"/>
<circle class="lens" cx="102" cy="74" r="14" fill="#ffffff" fill-opacity="0.45" stroke="${OUTLINE}" stroke-width="4.5"/>`,
  oops: `<path class="drop" d="M124 46 Q131 56 124 60 Q117 56 124 46 Z" fill="${SWEAT}" ${LINE}/>`,
  stop: `<g><rect x="120" y="76" width="24" height="28" rx="9" fill="${SKIN}" ${LINE}/>
<path d="M126 78 L126 88 M132 77 L132 88 M138 78 L138 88" fill="none" stroke="${SKIN_SHADE}" stroke-width="2" stroke-linecap="round"/></g>`,
  lost: `<text class="question" x="124" y="40" font-family="system-ui, sans-serif" font-size="30" font-weight="800" fill="${RED}" stroke="${OUTLINE}" stroke-width="1.5">?</text>`,
  focus: "",
};

/** The motion of each mood; all of it stops when the system asks for reduced motion. */
const STYLE = `<style>
.body{animation:breathe 3.6s ease-in-out infinite;transform-origin:80px 150px}
.eyes{animation:blink 5s infinite;transform-origin:80px 74px}
.arm-right.hello{animation:wave 1.6s ease-in-out infinite;transform-origin:108px 126px}
.sparkle,.question,.drop,.wave-lines{animation:pop 2.4s ease-in-out infinite;transform-origin:80px 80px}
.lens{animation:look 3s ease-in-out infinite}
@keyframes breathe{50%{transform:translateY(-2px)}}
@keyframes blink{0%,94%,100%{transform:scaleY(1)}97%{transform:scaleY(.1)}}
@keyframes wave{50%{transform:rotate(-10deg)}}
@keyframes pop{50%{opacity:.55}}
@keyframes look{50%{transform:translateX(-3px)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>`;

function headgear(): string {
  return `<path d="M50 62 Q80 22 110 62" fill="none" stroke="${OUTLINE}" stroke-width="10" stroke-linecap="round"/>
<path d="M50 62 Q80 22 110 62" fill="none" stroke="${RED}" stroke-width="5" stroke-linecap="round"/>
<path d="M50 88 Q80 118 110 88" fill="none" stroke="${OUTLINE}" stroke-width="6" stroke-linecap="round"/>
<path d="M50 88 Q80 118 110 88" fill="none" stroke="${RED_DARK}" stroke-width="2" stroke-linecap="round"/>
<rect x="38" y="62" width="17" height="27" rx="8" fill="${RED}" ${LINE}/>
<rect x="105" y="62" width="17" height="27" rx="8" fill="${RED}" ${LINE}/>
<circle cx="46.5" cy="75.5" r="3" fill="${RED_DARK}"/><circle cx="113.5" cy="75.5" r="3" fill="${RED_DARK}"/>`;
}

function mascot(mood: MascotMood): string {
  const pose = POSES[mood];
  const face = FACES[mood];
  const handOpen = mood === "stop";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160">
${STYLE}
<clipPath id="badge"><path d="M0 0 H160 V84 H152 A72 72 0 0 1 8 84 H0 Z"/></clipPath>
<circle cx="80" cy="84" r="72" fill="${RED}" fill-opacity="0.1"/>
<g clip-path="url(#badge)"><g class="body">
<path d="M40 160 C40 132 54 118 80 118 C106 118 120 132 120 160 Z" fill="${SKIN}" ${LINE}/>
<path d="M54 160 L56 128 L64 124 Q72 138 80 138 Q88 138 96 124 L104 128 L106 160 Z" fill="${RED}" ${LINE}/>
<path d="M64 124 L66 118 M96 124 L94 118" stroke="${OUTLINE}" stroke-width="3" stroke-linecap="round"/>
<path d="M60 150 L100 150" stroke="${RED_DARK}" stroke-width="3" stroke-linecap="round"/>
<rect x="71" y="100" width="18" height="20" rx="4" fill="${SKIN_SHADE}" ${LINE}/>
<circle cx="80" cy="72" r="33" fill="${SKIN}" ${LINE}/>
<path d="M48 66 C46 42 62 34 80 34 C98 34 114 42 112 66 C106 56 98 52 90 55 C84 50 72 50 66 56 C58 52 52 58 48 66 Z" fill="${HAIR}" ${LINE}/>
${headgear()}
<circle cx="62" cy="84" r="5" fill="${CHEEK}" fill-opacity="0.55"/><circle cx="98" cy="84" r="5" fill="${CHEEK}" fill-opacity="0.55"/>
<path d="${face.brows}" fill="none" stroke="${OUTLINE}" stroke-width="3.5" stroke-linecap="round"/>
${face.eyes}
${face.mouth}
${arm(pose.left, `arm-left ${mood}`, pose.left !== DOWN_LEFT)}
${arm(pose.right, `arm-right ${mood}`, !handOpen)}
${PROPS[mood]}
</g></g>
</svg>
`;
}

/**
 * The picture as a data: address for the first screen (sign-in, page headers): it arrives inside
 * the HTML, so the largest element on the sign-in page does not wait for a second request. Only
 * the characters a data: URL needs escaped are escaped, which keeps it close to the file's size.
 */
function dataUri(svg: string): string {
  const compact = svg.replace(/\n/g, "").replaceAll('"', "'");
  return `data:image/svg+xml,${compact.replace(/[%#<>{}|\\^`]/g, encodeURIComponent)}`;
}

const outDir = new URL("../../public/mascot/", import.meta.url);
await mkdir(outDir, { recursive: true });
const inline: string[] = [];
for (const mood of MASCOT_MOODS) {
  const svg = mascot(mood);
  await writeFile(new URL(`${mood}.svg`, outDir), svg);
  inline.push(`  ${mood}: ${JSON.stringify(dataUri(svg))},`);
}
await writeFile(
  new URL("../../src/lib/mascot-inline.generated.ts", import.meta.url),
  `// GENERATED by \`pnpm mascot:build\` (scripts/mascot/build.mts): do not edit.
import type { MascotMood } from "./mascot";

/** Each mood as a data: address, for pictures on the first screen; imported by server code only. */
export const MASCOT_INLINE: Record<MascotMood, string> = {
${inline.join("\n")}
};
`,
);
process.stdout.write(
  `mascot: ${MASCOT_MOODS.length} moods written to public/mascot/ and src/lib/mascot-inline.generated.ts\n`,
);
