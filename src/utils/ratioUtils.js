/* -------------------------------------------------
 * ratioUtils.js  ——  小数 ⇄ 最简分数
 * -------------------------------------------------*/

export function decToFrac(dec, maxDen = 20) {
  const EPS = 1e-4;
  if (typeof dec === "string") dec = parseFloat(dec);
  if (isNaN(dec)) return "";
  if (Math.abs(dec) < EPS) return "0";
  for (let d = 1; d <= maxDen; d++) {
    const n = Math.round(dec * d);
    if (Math.abs(dec - n / d) < EPS) return `${n}/${d}`;
  }
  return dec.toFixed(3); // 超出范围返回字符串小数
}

/* 允许 "3/4" | "0.75" | 0.75 → 十进制 */
export function fracToDec(str) {
  if (typeof str === "number") return str;
  if (/^\d+\/\d+$/.test(str)) {
    const [n, d] = str.split("/").map(Number);
    return d ? n / d : 0;
  }
  const f = parseFloat(str);
  return isNaN(f) ? null : f;
}
