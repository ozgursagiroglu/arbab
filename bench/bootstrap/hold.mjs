#!/usr/bin/env node
// Waits until a quota window has reset, then exits 0 so a chained launch can start (the hand-made form of
// DESIGN.md §8's hold):  node bench/bootstrap/hold.mjs <resetsAt-epoch-seconds> <extra-seconds> && node launch.mjs …
const [resetsAt, extra = "60"] = process.argv.slice(2).map(Number);
if (!Number.isFinite(resetsAt)) {
  console.error("usage: hold.mjs <resetsAt-epoch-seconds> [extra-seconds]");
  process.exit(1);
}
const target = (resetsAt + extra) * 1000;
const wait = Math.max(0, target - Date.now());
console.log(`holding ${Math.round(wait / 60_000)} min until ${new Date(target).toISOString()}`);
setTimeout(() => console.log(`released at ${new Date().toISOString()}`), wait);
