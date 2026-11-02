const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");
const logic = require(path.join(__dirname, "..", "public", "connect", "logic.js"));

const sample = (overrides = {}) => ({
  team: "아스날",
  birthYear: 2000,
  position: "RW",
  positions: ["RW"],
  nationality: "잉글랜드",
  shirtNumber: 7,
  ...overrides,
});

assert.deepEqual(logic.getConnections([sample(), sample(), sample(), sample()]).map((item) => item.label), [
  "아스날", "2000년생", "RW", "잉글랜드 국적", "7번",
]);
assert.deepEqual(logic.getConnections([sample(), sample(), sample(), sample({ nationality: "프랑스" })]).map((item) => item.label), [
  "아스날", "2000년생", "RW", "7번",
]);
assert.deepEqual(logic.getConnections([sample(), sample(), sample()]), []);
assert.deepEqual(logic.getConnections([
  sample({ position: "RW", positions: ["RW", "CAM"] }),
  sample({ position: "CAM", positions: ["CAM"] }),
  sample({ position: "CM", positions: ["CM", "CAM"] }),
  sample({ position: "LW", positions: ["LW", "CAM"] }),
]).map((item) => item.label), ["아스날", "2000년생", "CAM", "잉글랜드 국적", "7번"]);
const context = {};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "public", "connect", "puzzles.js"), "utf8"), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "public", "connect", "hints.js"), "utf8"), context);
assert.equal(context.CONNECT_PUZZLES.length, 100);
assert.equal(Object.keys(context.CONNECT_HINTS).length, 100);
const hasPhotos = fs.existsSync(path.join(__dirname, "..", "public", "captcha", "photos"));
for (const puzzle of context.CONNECT_PUZZLES) {
  assert.equal(puzzle.players.length, 16, `문제 ${puzzle.id} 선수 수`);
  assert.equal(new Set(puzzle.players.map((player) => player.id)).size, 16, `문제 ${puzzle.id} 중복 선수`);
  for (const player of puzzle.players) {
    assert.ok(player.team && player.birthYear && player.position && player.positions && player.nationality && player.shirtNumber && player.photo, `문제 ${puzzle.id} 필수 정보`);
    assert.match(player.position, /^(GK|CB|LB|RB|LWB|RWB|CDM|CM|CAM|LM|RM|LW|RW|ST|CF)$/, `문제 ${puzzle.id} FotMob 포지션 코드: ${player.name}`);
    assert.ok(player.positions.length >= 1 && player.positions.length <= 2, `문제 ${puzzle.id} 인정 포지션 수: ${player.name}`);
    assert.equal(player.positions[0], player.position, `문제 ${puzzle.id} 주 포지션: ${player.name}`);
    for (const position of player.positions) assert.match(position, /^(GK|CB|LB|RB|LWB|RWB|CDM|CM|CAM|LM|RM|LW|RW|ST|CF)$/, `문제 ${puzzle.id} 인정 포지션: ${player.name}`);
    // 선수 사진은 저작권 때문에 공개 저장소에서 빠져 있으므로, 사진 폴더가 있을 때만 존재를 검사한다.
    if (hasPhotos) {
      assert.ok(fs.existsSync(path.join(__dirname, "..", "public", player.photo.replace(/^\.\.\//, ""))), `문제 ${puzzle.id} 사진: ${player.name}`);
    }
  }

  const validGroups = [];
  for (let a = 0; a < 13; a += 1) {
    for (let b = a + 1; b < 14; b += 1) {
      for (let c = b + 1; c < 15; c += 1) {
        for (let d = c + 1; d < 16; d += 1) {
          const indexes = [a, b, c, d];
          if (logic.getConnections(indexes.map((index) => puzzle.players[index])).length) validGroups.push(indexes);
        }
      }
    }
  }
  const fullMask = (1 << 16) - 1;
  const masks = validGroups.map((group) => group.reduce((mask, index) => mask | (1 << index), 0));
  let solutionCount = 0;
  const solutionLimit = 1000;
  function countPartitions(usedMask, startAt, depth) {
    if (solutionCount >= solutionLimit) return;
    if (depth === 4) {
      if (usedMask === fullMask) solutionCount += 1;
      return;
    }
    for (let index = startAt; index < masks.length; index += 1) {
      if ((usedMask & masks[index]) === 0) countPartitions(usedMask | masks[index], index + 1, depth + 1);
    }
  }
  countPartitions(0, 0, 0);
  assert.ok(solutionCount > 0, `문제 ${puzzle.id} 완성 경로`);
  assert.ok(solutionCount <= 10, `문제 ${puzzle.id} 완성 경로 과다: ${solutionCount}`);
  console.log(`puzzle ${puzzle.id}: ${validGroups.length} valid groups, ${solutionCount}${solutionCount >= solutionLimit ? "+" : ""} complete partitions`);
}

// 아래 설계 그룹·힌트 검사는 크롤러 원본 리포트(crawler/data/, 저장소 제외)가 있을 때만 돈다.
const reportPath = path.join(__dirname, "data", "connect_puzzle_report.json");
if (!fs.existsSync(reportPath)) {
  console.log("skip: crawler/data/connect_puzzle_report.json 없음 - 설계 그룹·힌트 검사 생략");
} else {
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.length, 100);
  const puzzleById = new Map(Array.from(context.CONNECT_PUZZLES, (puzzle) => [puzzle.id, puzzle]));
  for (const item of report) {
    const playerByName = new Map(Array.from(puzzleById.get(item.id).players, (player) => [player.name, player]));
    for (const group of item.designedGroups) {
      for (const name of group.players) {
        const player = playerByName.get(name);
        assert.ok(player, `문제 ${item.id} 설계 그룹 선수: ${name}`);
        if (group.field === "position") assert.ok(player.positions.includes(group.value), `문제 ${item.id} 설계 포지션 ${group.value}: ${name}`);
        else assert.equal(player[group.field], group.value, `문제 ${item.id} 설계 ${group.field}: ${name}`);
      }
    }
  }
  const playerSnapshot = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "connect_players.json"), "utf8"));
  const snapshotByName = new Map(playerSnapshot.map((player) => [player.name, player]));
  assert.deepEqual(snapshotByName.get("Bukayo Saka").positions, ["RW"]);
  assert.deepEqual(snapshotByName.get("Phil Foden").positions, ["CAM", "RW"]);
  assert.deepEqual(snapshotByName.get("Raphinha").positions, ["LW", "ST"]);
  const categoryLabels = { team: "소속팀", birthYear: "출생 연도", position: "포지션", nationality: "국적", shirtNumber: "등번호" };
  const groupDetail = (group) => ({
    team: `${group.value} 소속`,
    birthYear: `${group.value}년생`,
    position: `${group.value} 포지션`,
    nationality: `${group.value} 국적`,
    shirtNumber: `등번호 ${group.value}번`,
  }[group.field]);
  for (const item of report) {
    const counts = {};
    for (const group of item.designedGroups) counts[group.field] = (counts[group.field] || 0) + 1;
    const expected = [
      `${Object.entries(counts).map(([field, count]) => `${categoryLabels[field]} ${count}그룹`).join(" · ")}으로 풀 수 있습니다.`,
      `한 그룹의 공통점은 ${groupDetail(item.designedGroups[0])}입니다.`,
    ];
    assert.deepEqual(Array.from(context.CONNECT_HINTS[item.id]), expected, `문제 ${item.id} 2단계 힌트`);
  }
  const typeCounts = report.reduce((counts, item) => {
    counts[item.patternType] = (counts[item.patternType] || 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(typeCounts, {
    "1-category": 20,
    "2-category": 40,
    "3-category": 20,
    "4-category": 20,
  });
}

const appSource = fs.readFileSync(path.join(__dirname, "..", "public", "connect", "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(__dirname, "..", "public", "connect", "styles.css"), "utf8");
const adminSource = fs.readFileSync(path.join(__dirname, "..", "public", "bymile", "index.html"), "utf8");
const rulesSource = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
assert.match(appSource, /game: "connect"/);
assert.match(appSource, /connectPuzzleRecordsV3/);
assert.match(appSource, /statsCounters/);
assert.match(appSource, /statsDaily/);
assert.match(appSource, /puzzle-list-title/);
assert.match(appSource, /소속팀 · 출생 연도 · 포지션 · 국적 · 등번호/);
assert.match(appSource, /2단계 힌트 보기/);
assert.match(appSource, /hintLevel/);
assert.match(appSource, /배치를 초기화했습니다\./);
assert.match(appSource, /game\.pool = game\.puzzle\.players\.map/);
assert.match(appSource, /game\.zones = \[\[\], \[\], \[\], \[\]\]/);
assert.match(stylesSource, /--pool-mobile-height-px/);
assert.match(stylesSource, /\.hint-overlay/);
assert.match(stylesSource, /\.reset-label/);
assert.match(stylesSource, /repeat\(var\(--pool-rows\)/);
assert.match(adminSource, /"connect": "커넥트"/);
assert.match(rulesSource, /'connect'/);

console.log("connect logic tests passed");
