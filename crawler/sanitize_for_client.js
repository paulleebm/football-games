#!/usr/bin/env node
/**
 * public/index.html에 그대로 나가는 데이터(guessPlayers Firestore 문서,
 * silhouette_players.json, records_quiz.json/team_records_quiz.json)에서
 * 정답으로 쓰이는 문자열(이름/사진 URL/출처 URL)을 평문으로 두지 않기 위한
 * 변환기. public/index.html의 normalize()/sha256Hex()/deobfuscate()와
 * 반드시 동일한 알고리즘이어야 한다 - 한쪽만 바뀌면 매칭이 깨진다.
 *
 * 매칭(정답 확인)에만 쓰는 값 -> 되돌릴 수 없는 SHA-256 해시(matchHash/aliasHashes/
 * answerHash)로 교체하고 평문은 삭제한다.
 * 라운드가 끝난 뒤 화면에 보여줘야 하는 값(nameKo/nameEn/photoUrl/source) ->
 * 되돌릴 수 있는 XOR+Base64로 뒤섞은 *Enc 필드로 교체하고 평문은 삭제한다.
 *
 * Usage:
 *   node sanitize_for_client.js players    <in.json> <out.json>
 *   node sanitize_for_client.js silhouette <in.json> <out.json>
 *   node sanitize_for_client.js records    <in.json> <out.json>
 */
const fs = require("fs");
const crypto = require("crypto");

// public/index.html의 OBF_KEY와 반드시 동일해야 한다.
const OBF_KEY = "gyp-cheatguard-2024";

function normalize(s) {
  return (s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s.\-'’]/g, "");
}
function sha256Hex(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}
function matchHashOf(s) {
  return sha256Hex(normalize(s || ""));
}
function obfuscate(s) {
  const buf = Buffer.from(s ?? "", "utf8");
  const keyBytes = Buffer.from(OBF_KEY, "utf8");
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ keyBytes[i % keyBytes.length];
  return out.toString("base64");
}

function sanitizePlayer(raw) {
  const p = JSON.parse(JSON.stringify(raw));
  const pr = p.profile || {};
  if (pr.nameEn) {
    pr.matchHash = matchHashOf(pr.nameEn);
    pr.nameEnEnc = obfuscate(pr.nameEn);
    delete pr.nameEn;
  }
  if (pr.nameKo) {
    pr.nameKoEnc = obfuscate(pr.nameKo);
    delete pr.nameKo;
  }
  if (pr.photoUrl) {
    pr.photoUrlEnc = obfuscate(pr.photoUrl);
    delete pr.photoUrl;
  }
  if (Array.isArray(pr.aliases) && pr.aliases.length) {
    pr.aliasHashes = pr.aliases.map(matchHashOf);
  }
  delete pr.aliases;
  p.profile = pr;
  return p;
}

function sanitizeSilhouette(raw) {
  const p = JSON.parse(JSON.stringify(raw));
  if (p.nameEn) {
    p.matchHash = matchHashOf(p.nameEn);
    p.nameEnEnc = obfuscate(p.nameEn);
    delete p.nameEn;
  }
  if (p.nameKo) {
    p.nameKoEnc = obfuscate(p.nameKo);
    delete p.nameKo;
  }
  return p;
}

function sanitizeRecord(raw) {
  const it = JSON.parse(JSON.stringify(raw));
  if (it.answer) {
    it.answerHash = matchHashOf(it.answer);
    it.answerEnc = obfuscate(it.answer);
    delete it.answer;
  }
  if (it.source) {
    it.sourceEnc = obfuscate(it.source);
    delete it.source;
  }
  return it;
}

const MODES = { players: sanitizePlayer, silhouette: sanitizeSilhouette, records: sanitizeRecord };

function main() {
  const [, , mode, inPath, outPath] = process.argv;
  const fn = MODES[mode];
  if (!fn || !inPath || !outPath) {
    console.error("Usage: node sanitize_for_client.js <players|silhouette|records> <in.json> <out.json>");
    process.exit(1);
  }
  const items = JSON.parse(fs.readFileSync(inPath, "utf8"));
  const sanitized = items.map(fn);
  fs.writeFileSync(outPath, JSON.stringify(sanitized, null, 2) + "\n");
  console.log(`sanitized ${sanitized.length} items (${mode}) -> ${outPath}`);
}

main();
