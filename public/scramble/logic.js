// 이름 뒤죽박죽 - 화면과 무관한 순수 로직 (글자 정리, 섞기).
// 브라우저에선 window.ScrambleLogic, node에선 module.exports로 쓴다.
(function (root) {
  // NFD로 분해되지 않아 악센트 제거로는 알파벳이 안 되는 글자들
  const SPECIAL = { "ø": "o", "ı": "i", "ß": "ss", "ł": "l", "đ": "d", "æ": "ae", "œ": "oe", "þ": "th" };

  function letters(s) {
    return (s || "")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[øıßłđæœþ]/g, c => SPECIAL[c])
      .replace(/[^a-z]/g, "")
      .toUpperCase();
  }

  // "Trent Alexander-Arnold" -> [{word:"TRENT"}, {sep:" "}, {word:"ALEXANDER"}, {sep:"-"}, {word:"ARNOLD"}]
  function segments(name) {
    const out = [];
    for (const part of name.split(/([\s-])/)) {
      if (part === "") continue;
      if (part === " " || part === "-") out.push({ sep: part });
      else {
        const w = letters(part);
        if (w) out.push({ word: w });
      }
    }
    return out;
  }

  function shuffleArr(arr, rand = Math.random) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 이름 전체 글자를 한데 섞는다. 원래 철자가 비쳐 보이면 다시 섞는다:
  // 제자리에 남은 글자가 ⌊길이/3⌋개 초과, 첫 두 글자가 그대로, 3글자 이상 단어가 통째로 붙어 있음.
  // 조건을 못 맞추면 "다르기만 한" 결과라도 쓴다.
  function scramble(words, rand = Math.random) {
    const answer = words.join("");
    if (new Set(answer).size === 1) return answer;
    let fallback = null;
    for (let t = 0; t < 80; t++) {
      const s = shuffleArr([...answer], rand).join("");
      if (s === answer) continue;
      fallback = fallback || s;
      const inPlace = [...s].filter((c, i) => c === answer[i]).length;
      if (inPlace > Math.floor(answer.length / 3)) continue;
      if (s.slice(0, 2) === answer.slice(0, 2)) continue;
      if (words.some(w => w.length >= 3 && s.includes(w))) continue;
      return s;
    }
    return fallback || answer;
  }

  // 화면용 문제 하나: 단어 목록(칸 길이용)과 전체를 섞은 타일 한 줄
  function makeBoard(name, rand = Math.random) {
    const segs = segments(name);
    const words = segs.filter(s => s.word).map(s => s.word);
    const tiles = [...scramble(words, rand)].map((ch, id) => ({ id, ch }));
    return { segs, words, tiles };
  }

  const api = { letters, segments, shuffleArr, scramble, makeBoard };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ScrambleLogic = api;
})(typeof window !== "undefined" ? window : globalThis);
