// 아이템 아이콘: 이모지 대신 직접 그린 SVG. 모두 48x48, 진한 갈색 외곽선에 밝은 면 색.
// 경기장 상자(보라 + 노란 리본 + ?)와 같은 만화 톤으로 맞췄다.

const LINE = "#2b1d12";

// 축구공 무늬: 가운데 오각형 + 테두리로 뻗는 선
function soccerBall(cx, cy, r) {
  const pent = [];
  const rim = [];
  for (let k = 0; k < 5; k++) {
    const a = (-90 + k * 72) * Math.PI / 180;
    pent.push(`${(cx + Math.cos(a) * r * 0.38).toFixed(1)},${(cy + Math.sin(a) * r * 0.38).toFixed(1)}`);
    rim.push(`M${pent[k].replace(",", " ")} L${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" stroke="${LINE}" stroke-width="2.6"/>`
    + `<path d="M${cx - r * 0.62} ${cy + r * 0.5} A${r} ${r} 0 0 0 ${cx + r * 0.72} ${cy + r * 0.42}" fill="none" stroke="#d6dee8" stroke-width="2.4"/>`
    + `<path d="${rim.join(" ")}" stroke="${LINE}" stroke-width="1.6"/>`
    + `<polygon points="${pent.join(" ")}" fill="${LINE}"/>`;
}

// 골대 바꾸기 화살표 하나 (오른쪽을 보는 통짜 모양). 몸통 위쪽은 밝게, 아래쪽은 어둡게 줘서 도톰하게.
// 아래 화살표는 좌우로 뒤집고 아래로 내려서 쓴다 (빛은 계속 위에서 오게)
function swapArrow(fill, light, shade, transform) {
  return `<g ${transform}>`
    + `<path d="M8.5 12.6 H27.5 V8.6 Q27.5 7.6 28.4 8.1 L40.6 15.2 Q41.6 16 40.6 16.8 L28.4 23.9 Q27.5 24.4 27.5 23.4 V19.4 H8.5 Q6.9 19.4 6.9 17.8 V14.2 Q6.9 12.6 8.5 12.6 Z" fill="${fill}" stroke="${LINE}" stroke-width="2.6" stroke-linejoin="round"/>`
    + `<path d="M9.6 17.6 H28.6 M29.6 21.4 L38.2 16.4" fill="none" stroke="${shade}" stroke-width="1.8" opacity=".8"/>`
    + `<path d="M9.8 14.4 H26 M29.5 11 L35.6 14.6" fill="none" stroke="${light}" stroke-width="1.7"/>`
    + `</g>`;
}

// VAR 글자를 직접 그린 굵은 모양 (글꼴이 없는 기기에서도 똑같이 보이게). 글자 높이 17.5~30.5.
// A·R 속 구멍은 evenodd로 뚫는다.
const VAR_LETTERS = "M4.5 17.5 H8.8 L10.5 24.6 L12.2 17.5 H16.5 L12.6 30.5 H8.4 Z"
  + " M20.4 17.5 H26.4 L30 30.5 H25.9 L25.3 28.2 H21.5 L20.9 30.5 H16.8 Z M22.3 25.1 H24.5 L23.4 20.9 Z"
  + " M30.6 17.5 H38.6 C41.9 17.5 43.6 19.4 43.6 21.9 C43.6 23.8 42.6 25.1 41 25.7 L44 30.5 H39.5 L37.2 26.3 H34.6 V30.5 H30.6 Z"
  + " M34.6 20.6 H38 C39 20.6 39.5 21.1 39.5 21.9 C39.5 22.7 39 23.2 38 23.2 H34.6 Z";

const ICONS = {
  // 파워슛: 불꽃 꼬리를 단 공
  power:
    `<path d="M21 40 C9 38 4 28 7 16 C9.5 21 12.5 22.5 15 21.5 C12.5 14 16 7 23.5 3 C22.5 9.5 25 13.5 29 15.5 C31 11.5 34.5 9.5 39 9 C36.5 13 37.5 16.5 40 19.5 Z" fill="#ff6a1a" stroke="${LINE}" stroke-width="2.6"/>`
    + `<path d="M21.5 35 C14 33.5 10.5 27 12.5 20.5 C14.5 24.5 17.5 25.5 20 24.5 C19 18.5 21.5 13.5 25.5 10.5 C25.5 15.5 27.5 18.5 31.5 20.5 Z" fill="#ffd23f"/>`
    + soccerBall(30.5, 30.5, 12),
  // 비치볼: 빨강·하양·노랑 줄무늬
  beach:
    `<circle cx="24" cy="25" r="17" fill="#ff5a4e"/>`
    + `<ellipse cx="24" cy="25" rx="12" ry="17" fill="#fff" stroke="${LINE}" stroke-width="1.4"/>`
    + `<ellipse cx="24" cy="25" rx="6" ry="17" fill="#ffc93c" stroke="${LINE}" stroke-width="1.4"/>`
    + `<ellipse cx="24" cy="8.6" rx="3.6" ry="1.8" fill="#3b82f6" stroke="${LINE}" stroke-width="1.4"/>`
    + `<path d="M11.5 19 A13 13 0 0 1 16.5 12" fill="none" stroke="#fff" stroke-width="3" opacity=".75"/>`
    + `<circle cx="24" cy="25" r="17" fill="none" stroke="${LINE}" stroke-width="2.6"/>`,
  // 골대 바꾸기: 🔄처럼 서로 반대로 가는 통통한 화살표 두 개 (⇄)
  swap:
    swapArrow("#ffb020", "#ffe08a", "#d98300", "")
    + swapArrow("#38bdf8", "#c4ecff", "#1784c4", `transform="translate(48 16) scale(-1 1)"`),
  // 찬스볼: 🎯처럼 과녁 한가운데 꽂힌 다트
  reset:
    `<circle cx="24" cy="24" r="18" fill="#ff5a4e" stroke="${LINE}" stroke-width="2.6"/>`
    + `<circle cx="24" cy="24" r="13" fill="#fff"/>`
    + `<circle cx="24" cy="24" r="8" fill="#ff5a4e"/>`
    + `<circle cx="24" cy="24" r="3.6" fill="#fff"/>`
    + `<path d="M12.5 14.5 A15 15 0 0 1 19 10.2" fill="none" stroke="#fff" stroke-width="2.6" opacity=".6"/>`
    + `<path d="M24 24 L38.5 9.5" stroke="${LINE}" stroke-width="5.4"/>`
    + `<path d="M24 24 L38.5 9.5" stroke="#ffd23f" stroke-width="2.6"/>`
    + `<path d="M36.5 11.5 L35.5 3.5 L40.5 7.5 Z M36.5 11.5 L44.5 12.5 L40.5 7.5 Z" fill="#3b82f6" stroke="${LINE}" stroke-width="2" stroke-linejoin="round"/>`
    + `<circle cx="24" cy="24" r="2" fill="${LINE}"/>`,
  // 빙판: 🧊처럼 둥글린 얼음 정육면체
  ice:
    `<path d="M24 7 L40 15 L24 23 L8 15 Z" fill="#e3f7ff"/>`
    + `<path d="M8 15 L24 23 V41 L8 33 Z" fill="#a5defa"/>`
    + `<path d="M24 23 L40 15 V33 L24 41 Z" fill="#6cc4f0"/>`
    + `<path d="M24 23 V41 M8 15 L24 23 L40 15" fill="none" stroke="${LINE}" stroke-width="1.6" opacity=".55"/>`
    + `<path d="M15 15.2 L24 11 M19 17.5 L27 13.7" stroke="#fff" stroke-width="2.2"/>`
    + `<path d="M11.5 21 V28.5" stroke="#fff" stroke-width="2.2" opacity=".85"/>`
    + `<path d="M34.5 22 V27" stroke="#fff" stroke-width="1.8" opacity=".5"/>`
    + `<path d="M24 7 L40 15 V33 L24 41 L8 33 V15 Z" fill="none" stroke="${LINE}" stroke-width="2.6"/>`,
  // 운동장 기울이기: 나무 받침 위에 비스듬히 놓인 경기장, 공이 내리막으로 굴러간다
  tilt:
    `<polygon points="4.6,25.3 41.5,34.5 41.5,38.5 4.6,38.5" fill="#d9a066" stroke="${LINE}" stroke-width="2.6" stroke-linejoin="round"/>`
    + `<path d="M8 36 H38" stroke="#b97a3d" stroke-width="1.6" opacity=".7"/>`
    + `<g transform="rotate(14 24 26)">`
    + `<rect x="5" y="21" width="38" height="9" rx="2.5" fill="#4caf50" stroke="${LINE}" stroke-width="2.6"/>`
    + `<path d="M13 21.8 V29.2 M33 21.8 V29.2" stroke="#5fbf63" stroke-width="5"/>`
    + `<path d="M24 21.8 V29.2" stroke="#fff" stroke-width="1.6" opacity=".9"/></g>`
    + `<path d="M20.2 15.6 L14.4 14.1 M21.3 11.2 L15.5 9.8" stroke="${LINE}" stroke-width="2.4"/>`
    + soccerBall(28.6, 15, 5.6),
  // 레드카드: 기울어진 빨간 카드 + 번쩍
  red:
    `<g transform="rotate(12 24 25)"><rect x="13" y="8" width="22" height="31" rx="3.5" fill="#ef2b2b" stroke="${LINE}" stroke-width="2.6"/>`
    + `<rect x="16.5" y="11.5" width="4.5" height="15" rx="2.2" fill="#fff" opacity=".4"/></g>`
    + `<path d="M39 8 L43.5 4 M41.5 13.5 L46 12.5 M35.5 5 L36.5 1.5" stroke="${LINE}" stroke-width="2.4"/>`,
  // VAR: 흰 테두리를 두른 빨간 굵은 영문 글씨 (글꼴 대신 직접 그린 글자)
  var:
    `<path d="${VAR_LETTERS}" fill="${LINE}" fill-rule="evenodd" stroke="${LINE}" stroke-width="6.5" stroke-linejoin="round"/>`
    + `<path d="${VAR_LETTERS}" fill="#e3141c" fill-rule="evenodd" stroke="#fff" stroke-width="3" stroke-linejoin="round" paint-order="stroke"/>`,
  // 상대가 가진 아이템 / 상대가 먹은 상자: 경기장 상자와 같은 보라 상자
  box:
    `<rect x="9" y="19" width="30" height="22" rx="3" fill="#7c3aed" stroke="${LINE}" stroke-width="2.6"/>`
    + `<rect x="7" y="13" width="34" height="8" rx="2.5" fill="#a855f7" stroke="${LINE}" stroke-width="2.6"/>`
    + `<rect x="21" y="13" width="6" height="8" fill="#ffd23f" stroke="${LINE}" stroke-width="2"/>`
    + `<path d="M24 13 C19 4 11 7 15.5 12.5 Z M24 13 C29 4 37 7 32.5 12.5 Z" fill="#ffd23f" stroke="${LINE}" stroke-width="2"/>`
    + `<text x="24" y="37.5" text-anchor="middle" font-family="'Jua', Arial, sans-serif" font-size="17" fill="#fff">?</text>`,
};

// 그림의 주인공(공·카드·과녁 등)이 48x48 한가운데(24,24)에 오게 옮기는 양.
// 번쩍임·다트 같은 곁들인 효과는 기준에서 뺀다. 빠진 그림은 이미 가운데.
const CENTER = {
  power: [-0.3, 1.3],
  beach: [-1, -0.7],
  // 카드 몸통(12도 기울인 22x31)의 가운데 기준
  red: [-0.3, 0.5],
  var: [-0.2, 0],
};

function inner(name) {
  const o = CENTER[name];
  return o ? `<g transform="translate(${o[0]} ${o[1]})">${ICONS[name]}</g>` : ICONS[name];
}

// 다른 SVG 안에 넣을 그림 (커서 등)
export function iconInner(name) {
  return inner(name);
}

export function iconSvg(name) {
  return `<svg class="ic" viewBox="0 0 48 48" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">${inner(name)}</svg>`;
}

export function iconEl(name) {
  const s = document.createElement("span");
  s.className = "ic-wrap";
  s.innerHTML = iconSvg(name);
  return s;
}
