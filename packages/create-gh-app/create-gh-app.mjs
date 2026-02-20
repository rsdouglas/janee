#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { URL } from "node:url";
import readline from "node:readline/promises";

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function hasCmd(cmd) {
  const r = spawnSync("bash", ["-lc", `command -v ${cmd} >/dev/null 2>&1`], { stdio: "ignore" });
  return r.status === 0;
}

function ghToken() {
  const r = spawnSync("gh", ["auth", "token"], { encoding: "utf8" });
  if (r.status !== 0) die("gh not authenticated. Run: gh auth login");
  const tok = (r.stdout || "").trim();
  if (!tok) die("Could not read GitHub token from `gh auth token`.");
  return tok;
}

function openBrowser(url) {
  if (process.platform === "darwin") {
    spawnSync("open", [url], { stdio: "ignore" });
    return;
  }
  if (process.platform === "win32") {
    spawnSync("cmd", ["/c", "start", url], { stdio: "ignore" });
    return;
  }
  // linux
  if (hasCmd("xdg-open")) spawnSync("xdg-open", [url], { stdio: "ignore" });
  else console.log(`Open this URL in your browser:\n${url}`);
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function pickPort() {
  return new Promise((resolve) => {
    const srv = http.createServer(() => {});
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function githubApi(token, method, urlPath, bodyObj) {
  const res = await fetch(`https://api.github.com${urlPath}`, {
    method,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "User-Agent": "create-gh-app",
      ...(bodyObj ? { "Content-Type": "application/json" } : {}),
    },
    body: bodyObj ? JSON.stringify(bodyObj) : undefined,
  });

  const txt = await res.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch { /* ignore */ }

  if (!res.ok) {
    const msg = json?.message || txt || `${res.status} ${res.statusText}`;
    throw new Error(`GitHub API error: ${msg}`);
  }
  return json;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let agent = null;
  let owner = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--owner" && i + 1 < args.length) {
      owner = args[++i];
    } else if (!agent) {
      agent = args[i];
    }
  }
  return { agent, owner };
}

function fetchOrgs() {
  const r = spawnSync("gh", ["api", "/user/orgs", "--paginate", "--jq", ".[].login"], { encoding: "utf8" });
  if (r.status !== 0) return [];
  return r.stdout.trim().split("\n").filter(Boolean);
}

async function pickOwner() {
  const orgs = fetchOrgs();
  const choices = ["@me (personal)", ...orgs];

  console.log("\nWhere should the GitHub App be created?\n");
  choices.forEach((c, i) => console.log(`  ${i + 1}) ${c}`));
  console.log();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Pick a number: ");
  rl.close();

  const idx = parseInt(answer, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= choices.length) die("Invalid selection.");
  return idx === 0 ? "@me" : orgs[idx - 1];
}

const APP_BASE = path.join(process.cwd(), ".gh-apps");

function loadApps() {
  if (!fs.existsSync(APP_BASE)) return [];
  const results = [];
  for (const agent of fs.readdirSync(APP_BASE)) {
    const agentDir = path.join(APP_BASE, agent);
    if (!fs.statSync(agentDir).isDirectory()) continue;
    for (const ts of fs.readdirSync(agentDir).sort().reverse()) {
      const appFile = path.join(agentDir, ts, "app.json");
      if (!fs.existsSync(appFile)) continue;
      try {
        const app = JSON.parse(fs.readFileSync(appFile, "utf8"));
        const pemPath = path.join(agentDir, ts, "private-key.pem");
        results.push({ agent, ts, dir: path.join(agentDir, ts), app, pemPath });
      } catch { /* skip corrupt entries */ }
    }
  }
  return results;
}

function appJwt(appId, pemKey) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iat: now - 60,
    exp: now + 5 * 60,
    iss: String(appId),
  })).toString("base64url");
  const sigInput = `${header}.${payload}`;
  const sig = crypto.sign("sha256", Buffer.from(sigInput), pemKey).toString("base64url");
  return `${sigInput}.${sig}`;
}

function createUrl(owner, state) {
  if (owner === "@me") {
    return `https://github.com/settings/apps/new?state=${encodeURIComponent(state)}`;
  }
  return `https://github.com/organizations/${encodeURIComponent(owner)}/settings/apps/new?state=${encodeURIComponent(state)}`;
}

function resolveApp(slug) {
  const apps = loadApps();
  const match = apps.find((a) => a.app.slug === slug);
  if (!match) die(`No local app with slug "${slug}". Run: node create-gh-app.mjs list`);
  const { app, pemPath, dir } = match;
  if (!fs.existsSync(pemPath)) die(`No private key at ${pemPath}`);
  const pem = fs.readFileSync(pemPath, "utf8");
  const jwt = appJwt(app.id, pem);
  return { ...match, pem, jwt };
}

function cmdList() {
  const apps = loadApps();
  if (!apps.length) { console.log("No apps found in .gh-apps/"); return; }

  console.log();
  for (const { agent, ts, app } of apps) {
    const owner = app.owner?.login ? `  owner: ${app.owner.login}` : "";
    console.log(`  ${app.slug || app.name}  (id: ${app.id})${owner}`);
    console.log(`    agent: ${agent}  created: ${ts}`);
    console.log(`    https://github.com/apps/${app.slug}`);
    console.log();
  }
}

async function cmdDelete(slug) {
  const apps = loadApps();
  const match = apps.find((a) => a.app.slug === slug);
  if (!match) die(`No local app with slug "${slug}". Run: node create-gh-app.mjs list`);

  const { app, pemPath, dir } = match;

  if (fs.existsSync(pemPath)) {
    const pem = fs.readFileSync(pemPath, "utf8");
    const jwt = appJwt(app.id, pem);
    try {
      await githubApi(jwt, "DELETE", "/app", null);
      console.log(`✅ Deleted app "${slug}" (id: ${app.id}) from GitHub`);
    } catch (e) {
      console.error(`⚠️  Could not delete from GitHub: ${e.message}`);
      console.error(`   You may need to delete manually: https://github.com/settings/apps/${app.slug}`);
    }
  } else {
    console.error(`⚠️  No private key found — cannot delete from GitHub.`);
    console.error(`   Delete manually: https://github.com/settings/apps/${app.slug}`);
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`🗑  Removed local files: ${dir}`);

  const agentDir = path.dirname(dir);
  if (fs.existsSync(agentDir) && fs.readdirSync(agentDir).length === 0) {
    fs.rmdirSync(agentDir);
  }
}

async function cmdInstallations(slug) {
  const { jwt } = resolveApp(slug);
  const installations = await githubApi(jwt, "GET", "/app/installations", null);
  if (!installations?.length) { console.log("No installations found."); return installations; }

  console.log();
  for (const inst of installations) {
    const sel = inst.repository_selection === "all" ? "all repos" : "selected repos";
    console.log(`  ${inst.id}  ${inst.account.login}  (${sel})`);
  }
  console.log();
  return installations;
}

async function cmdToken(slug, installationId) {
  const { jwt, app } = resolveApp(slug);

  // Auto-resolve installation if not provided
  if (!installationId) {
    const installations = await githubApi(jwt, "GET", "/app/installations", null);
    if (!installations?.length) die("No installations found. Install the app first:\n  https://github.com/apps/" + app.slug + "/installations/new");

    if (installations.length === 1) {
      installationId = installations[0].id;
      console.error(`Using installation: ${installations[0].account.login} (${installationId})`);
    } else {
      console.log("\nMultiple installations found:\n");
      installations.forEach((inst, i) => {
        const sel = inst.repository_selection === "all" ? "all repos" : "selected repos";
        console.log(`  ${i + 1}) ${inst.account.login}  (${sel})  id: ${inst.id}`);
      });
      console.log();
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question("Pick a number: ");
      rl.close();
      const idx = parseInt(answer, 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= installations.length) die("Invalid selection.");
      installationId = installations[idx].id;
    }
  }

  // Need a fresh JWT for the token mint (the resolve one might be seconds old, but just in case)
  const data = await githubApi(jwt, "POST", `/app/installations/${installationId}/access_tokens`, {});

  // Print just the token to stdout (metadata to stderr) so it's pipe-friendly
  console.error(`✅ Token for installation ${installationId} (expires: ${data.expires_at})`);
  console.log(data.token);
}

async function cmdJaneeAdd(slug) {
  const { app, pemPath, jwt } = resolveApp(slug);

  const installations = await githubApi(jwt, "GET", "/app/installations", null);
  if (!installations?.length) die("No installations found. Install the app first:\n  https://github.com/apps/" + app.slug + "/installations/new");

  let installationId;
  if (installations.length === 1) {
    installationId = String(installations[0].id);
    console.log(`Using installation: ${installations[0].account.login} (${installationId})`);
  } else {
    console.log("\nMultiple installations found:\n");
    installations.forEach((inst, i) => {
      const sel = inst.repository_selection === "all" ? "all repos" : "selected repos";
      console.log(`  ${i + 1}) ${inst.account.login}  (${sel})  id: ${inst.id}`);
    });
    console.log();
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("Pick a number: ");
    rl.close();
    const idx = parseInt(answer, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= installations.length) die("Invalid selection.");
    installationId = String(installations[idx].id);
  }

  const serviceName = slug.replace(/[^a-z0-9-]/g, "-");
  const args = [
    "add", serviceName,
    "--auth-type", "github-app",
    "-u", "https://api.github.com",
    "--app-id", String(app.id),
    "--pem-file", pemPath,
    "--installation-id", installationId,
  ];

  console.log(`\nRunning: janee ${args.join(" ")}\n`);
  const r = spawnSync("janee", args, { stdio: "inherit", encoding: "utf8" });
  if (r.status !== 0) die("janee add failed");
}

async function main() {
  const { agent, owner: ownerArg } = parseArgs();

  if (agent === "list") { cmdList(); return; }
  if (agent === "delete") {
    const slug = process.argv[3];
    if (!slug) die("Usage: create-gh-app delete <slug>");
    await cmdDelete(slug);
    return;
  }
  if (agent === "installations") {
    const slug = process.argv[3];
    if (!slug) die("Usage: create-gh-app installations <slug>");
    await cmdInstallations(slug);
    return;
  }
  if (agent === "token") {
    const slug = process.argv[3];
    if (!slug) die("Usage: create-gh-app token <slug> [installation_id]");
    const instId = process.argv[4] || null;
    await cmdToken(slug, instId);
    return;
  }
  if (agent === "janee-add") {
    const slug = process.argv[3];
    if (!slug) die("Usage: create-gh-app janee-add <slug>");
    if (!hasCmd("janee")) die("janee CLI not found. Install: npm i -g @true-and-useful/janee");
    await cmdJaneeAdd(slug);
    return;
  }

  if (!agent) die(`Usage:
  create-gh-app <agent-name> [--owner <org|@me>]   Create a new app
  create-gh-app list                                List local apps
  create-gh-app installations <slug>                List installations
  create-gh-app token <slug> [installation_id]      Mint an installation token
  create-gh-app janee-add <slug>                    Add app to Janee as github-app service
  create-gh-app delete <slug>                       Delete an app`);

  if (!hasCmd("gh")) die("Missing dependency: gh (GitHub CLI). Install it and run `gh auth login`.");
  const token = ghToken();

  const owner = ownerArg || await pickOwner();
  console.log(`\nOwner: ${owner === "@me" ? "personal account" : owner}`);

  const ts = nowStamp();
  const outDir = path.join(process.cwd(), ".gh-apps", agent, ts);
  fs.mkdirSync(outDir, { recursive: true });

  const port = await pickPort();
  const state = crypto.randomBytes(18).toString("base64url");
  const redirectUrl = `http://127.0.0.1:${port}/redirect`;

  const manifest = {
    name: agent,
    url: "https://github.com",
    redirect_url: redirectUrl,
    description: `GitHub App: ${agent}`,
    public: false,
  
    default_permissions: {
      contents: "write",
      pull_requests: "write",
      issues: "write",
    },
  
    default_events: [
      "pull_request",
      "pull_request_review",
      "issues",
      "issue_comment",
    ],
  
    // ✅ REQUIRED in manifest flow
    hook_attributes: {
      url: "https://example.com/github/webhook", // must be non-empty + valid
      active: false
    }
  };
  

  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  let done = false;

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, `http://127.0.0.1:${port}`);

      if (u.pathname === "/") {
        // Serve a page that auto-POSTs to GitHub’s manifest endpoint
        const actionUrl = createUrl(owner, state);
        const html = `<!doctype html><meta charset="utf-8">
<title>Create GitHub App</title>
<p>Opening GitHub…</p>
<form id="f" action="${actionUrl}" method="post">
  <input type="hidden" name="manifest" id="manifest">
</form>
<script>
  document.getElementById("manifest").value = ${JSON.stringify(JSON.stringify(manifest))};
  document.getElementById("f").submit();
</script>`;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      if (u.pathname === "/redirect") {
        const code = u.searchParams.get("code");
        const gotState = u.searchParams.get("state");

        if (!code) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Missing ?code");
          return;
        }
        if (gotState !== state) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("State mismatch");
          return;
        }

        // Exchange the manifest code for credentials
        const app = await githubApi(token, "POST", `/app-manifests/${encodeURIComponent(code)}/conversions`, null);

        fs.writeFileSync(path.join(outDir, "app.json"), JSON.stringify(app, null, 2));

        const pem = app?.pem;
        if (!pem) throw new Error("No `pem` returned from GitHub conversion endpoint.");
        const pemPath = path.join(outDir, "private-key.pem");
        fs.writeFileSync(pemPath, pem, { mode: 0o600 });

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h1>Done</h1>
<p>App created and saved.</p>
<pre>${outDir}</pre>
<p>You can close this tab.</p>`);

        console.log("\n✅ GitHub App created");
        console.log(`   app_id: ${app.id}`);
        console.log(`   slug:   ${app.slug}`);
        console.log(`   saved:  ${outDir}`);
        console.log(`\nNext (optional): install it somewhere:\n  https://github.com/apps/${app.slug}/installations/new\n`);

        done = true;
        setTimeout(() => server.close(() => process.exit(0)), 250);
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(String(e?.message || e));
    }
  });

  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log(`\nOpening browser to create GitHub App for: ${agent}`);
    console.log(`If it doesn't open, go to: ${url}\n`);
    openBrowser(url);
  });

  // Safety timeout
  setTimeout(() => {
    if (!done) {
      console.error("Timed out waiting for GitHub redirect. Did you click 'Create GitHub App'?");
      server.close(() => process.exit(1));
    }
  }, 10 * 60 * 1000);
}

main().catch((e) => die(String(e?.message || e)));
