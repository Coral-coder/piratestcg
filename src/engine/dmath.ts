// Deterministic math. Math.sin/cos/atan2 are not required to give identical
// results across JS engines, which would break lockstep play. These use only
// + - * / and Math.sqrt, which IEEE 754 defines exactly.

export const PI = 3.141592653589793;
const DEG = PI / 180;

/** Round to 1e-4 so positions stay compact and replay-stable. */
export function q(x: number): number {
  const r = Math.round(x * 10000) / 10000;
  return r === 0 ? 0 : r; // no -0
}

/** Normalize degrees to (-180, 180]. */
export function normDeg(d: number): number {
  let x = d % 360;
  if (x <= -180) x += 360;
  if (x > 180) x -= 360;
  return x;
}

function sinRad(x: number): number {
  // Reduce to [-pi, pi], then to [-pi/2, pi/2], then Taylor series.
  let r = x % (2 * PI);
  if (r > PI) r -= 2 * PI;
  if (r < -PI) r += 2 * PI;
  if (r > PI / 2) r = PI - r;
  else if (r < -PI / 2) r = -PI - r;
  const r2 = r * r;
  // Taylor to x^15: error < 1e-12 on [-pi/2, pi/2].
  let term = r;
  let sum = r;
  for (let n = 1; n <= 7; n++) {
    term *= -r2 / ((2 * n) * (2 * n + 1));
    sum += term;
  }
  return sum;
}

export function dsin(deg: number): number {
  return sinRad(deg * DEG);
}
export function dcos(deg: number): number {
  return sinRad((deg + 90) * DEG);
}

function atanSmall(z: number): number {
  // atan for |z| <= ~0.42 by series; callers reduce the range first.
  const z2 = z * z;
  let term = z;
  let sum = z;
  for (let n = 1; n < 30; n++) {
    term *= -z2;
    sum += term / (2 * n + 1);
  }
  return sum;
}

function datanRad(z: number): number {
  const neg = z < 0;
  let a = neg ? -z : z;
  let invert = false;
  if (a > 1) {
    a = 1 / a;
    invert = true;
  }
  // atan(a) = 2*atan(a / (1 + sqrt(1 + a^2))) halves the argument.
  const h = a / (1 + Math.sqrt(1 + a * a));
  let r = 2 * atanSmall(h);
  if (invert) r = PI / 2 - r;
  return neg ? -r : r;
}

/** atan2 in degrees, (-180, 180]. */
export function datan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  let r: number;
  if (x > 0) r = datanRad(y / x);
  else if (x < 0) r = y >= 0 ? datanRad(y / x) + PI : datanRad(y / x) - PI;
  else r = y > 0 ? PI / 2 : -PI / 2;
  return normDeg(r / DEG);
}

/** Unit vector for a heading in degrees. 0 = +x, 90 = +y. */
export function dir(deg: number): { x: number; y: number } {
  return { x: dcos(deg), y: dsin(deg) };
}
