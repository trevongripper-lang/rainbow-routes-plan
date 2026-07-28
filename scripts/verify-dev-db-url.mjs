#!/usr/bin/env node
// Verify DEV_SUPABASE_DB_URL points at the expected disposable Supabase branch.
// Usage:
//   DEV_SUPABASE_DB_URL=... EXPECTED_REF=wuxpfelvcijjbuijxkofb node scripts/verify-dev-db-url.mjs
// Optional:
//   FORBIDDEN_REF=oohyehpikrweipgdxpxd  (defaults to the production ref)
// Never prints the password or the full URL.

const url = process.env.DEV_SUPABASE_DB_URL;
const expected = process.env.EXPECTED_REF || "wuxpfelvcijjbuijxkofb";
const forbidden = process.env.FORBIDDEN_REF || "oohyehpikrweipgdxpxd";

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}
function ok(msg) {
  console.log(`OK  : ${msg}`);
}

if (!url) fail("DEV_SUPABASE_DB_URL is not set in the environment.");

let parsed;
try {
  parsed = new URL(url);
} catch (e) {
  fail(`Could not parse DEV_SUPABASE_DB_URL as a URL: ${e.message}`);
}

const scheme = parsed.protocol.replace(":", "");
const username = decodeURIComponent(parsed.username || "");
const hostname = parsed.hostname;
const port = parsed.port || (scheme.startsWith("postgres") ? "5432" : "");
const database = (parsed.pathname || "/").replace(/^\//, "") || "(none)";

// Extract ref: pooler style "postgres.<ref>" in username, or direct "db.<ref>.supabase.co" in host.
let ref = null;
let refSource = null;
const userMatch = username.match(/^postgres\.([a-z0-9]{20})$/i);
if (userMatch) {
  ref = userMatch[1];
  refSource = "username (pooler)";
} else {
  const hostMatch = hostname.match(/^db\.([a-z0-9]{20})\.supabase\.(co|com|net)$/i);
  if (hostMatch) {
    ref = hostMatch[1];
    refSource = "hostname (direct)";
  }
}

console.log("Parsed identity (password not shown):");
console.log(`  scheme    : ${scheme}`);
console.log(`  username  : ${username || "(none)"}`);
console.log(`  hostname  : ${hostname}`);
console.log(`  port      : ${port}`);
console.log(`  database  : ${database}`);
console.log(`  ref       : ${ref ?? "(not found)"}  [${refSource ?? "n/a"}]`);
console.log("");

let hadFailure = false;

if (!ref) {
  console.error("FAIL: Could not extract a project ref from the URL.");
  hadFailure = true;
} else {
  if (ref === expected) {
    ok(`ref matches expected disposable ref (${expected}).`);
  } else {
    console.error(`FAIL: ref '${ref}' does not match expected '${expected}'.`);
    // Character-level diff to catch typos like buijx vs bujx.
    const len = Math.max(ref.length, expected.length);
    let diff = "";
    for (let i = 0; i < len; i++) {
      diff += ref[i] === expected[i] ? " " : "^";
    }
    console.error(`  expected: ${expected}`);
    console.error(`  actual  : ${ref}`);
    console.error(`  diff    : ${diff}`);
    hadFailure = true;
  }
  if (ref === forbidden) {
    console.error(`FAIL: ref matches FORBIDDEN production ref (${forbidden}). Refusing.`);
    hadFailure = true;
  } else {
    ok(`ref is not the forbidden production ref (${forbidden}).`);
  }
}

if (url.includes(forbidden)) {
  console.error(`FAIL: URL contains forbidden production ref substring '${forbidden}'.`);
  hadFailure = true;
}

if (scheme !== "postgres" && scheme !== "postgresql") {
  console.error(`FAIL: unexpected scheme '${scheme}' (want postgres/postgresql).`);
  hadFailure = true;
} else {
  ok(`scheme is ${scheme}.`);
}

if (database !== "postgres") {
  console.error(`FAIL: database is '${database}', expected 'postgres'.`);
  hadFailure = true;
} else {
  ok("database is 'postgres'.");
}

if (port && port !== "5432" && port !== "6543") {
  console.error(`FAIL: unexpected port '${port}' (want 5432 direct or 6543 pooler).`);
  hadFailure = true;
} else if (port) {
  ok(`port is ${port}.`);
}

if (hadFailure) {
  console.error("\nVerification FAILED. Do not run migrations against this URL.");
  process.exit(1);
}
console.log("\nAll checks passed. Safe to use for the disposable branch.");
