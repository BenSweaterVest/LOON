import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const EXAMPLES = path.join(ROOT, 'examples');
const LOCAL_STATE_DIR = path.join(DATA_DIR, '.local');
const LOCAL_STATE_PATH = path.join(LOCAL_STATE_DIR, 'state.json');
const LOCAL_AUDIT_PATH = path.join(LOCAL_STATE_DIR, 'audit.json');
const LOCAL_REVISIONS_DIR = path.join(LOCAL_STATE_DIR, 'revisions');

const PORT = Number(process.env.LOCAL_PORT || 8787);

const sessions = new Map();
const users = new Map([
  ['local', { username: 'local', role: 'admin', password: 'local', created: new Date().toISOString() }]
]);
const watchlists = new Map();
let auditLog = [];
let localStateLoaded = false;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

const SEED_PAGES = [
  { pageId: 'welcome', template: 'landing-page' },
  { pageId: 'news-update', template: 'blog-post' },
  { pageId: 'faq', template: 'faq' },
  { pageId: 'event', template: 'event' },
  { pageId: 'team', template: 'team-profile' },
  { pageId: 'menu', template: 'menu-page' },
  { pageId: 'tasks', template: 'todo-page' },
  { pageId: 'docs', template: 'documentation-page' }
];

function json(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function notFound(res, message = 'Not found') {
  json(res, 404, { error: message });
}

function unauthorized(res, message = 'Unauthorized') {
  json(res, 401, { error: message });
}

async function readJson(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2));
}

function generatePassword(length = 16) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const values = new Uint8Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, value => alphabet[value % alphabet.length]).join('');
}

async function hasLocalPages() {
  try {
    const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const schemaPath = path.join(DATA_DIR, entry.name, 'schema.json');
      const contentPath = path.join(DATA_DIR, entry.name, 'content.json');
      try {
        await fs.access(schemaPath);
        return true;
      } catch {
        try {
          await fs.access(contentPath);
          return true;
        } catch {
          // continue
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

async function ensureLocalData() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const hasPages = await hasLocalPages();
  if (hasPages) return;

  for (const seed of SEED_PAGES) {
    const targetDir = path.join(DATA_DIR, seed.pageId);
    const schemaPath = path.join(targetDir, 'schema.json');
    const contentPath = path.join(targetDir, 'content.json');

    try {
      await fs.access(schemaPath);
      await fs.access(contentPath);
      continue;
    } catch {
      // seed
    }

    const templateSchema = await readJson(path.join(EXAMPLES, seed.template, 'schema.json'));
    if (!templateSchema) {
      continue;
    }

    const templateContent = await readJson(path.join(EXAMPLES, seed.template, 'content.json'), {});
    const contentData = {
      ...templateContent,
      _meta: {
        createdBy: 'local',
        created: new Date().toISOString(),
        modifiedBy: 'local',
        lastModified: new Date().toISOString(),
        status: 'draft',
        workflowStatus: 'draft'
      }
    };

    await writeJson(schemaPath, templateSchema);
    await writeJson(contentPath, contentData);
  }
}

async function ensureLocalState() {
  if (localStateLoaded) return;
  await fs.mkdir(LOCAL_STATE_DIR, { recursive: true });
  await fs.mkdir(LOCAL_REVISIONS_DIR, { recursive: true });

  const state = await readJson(LOCAL_STATE_PATH, null);
  if (state) {
    users.clear();
    (state.users || []).forEach(user => {
      if (user && user.username) {
        users.set(user.username, user);
      }
    });

    sessions.clear();
    const now = Date.now();
    (state.sessions || []).forEach(session => {
      if (session && session.token && session.expiresAt && session.expiresAt > now) {
        sessions.set(session.token, session);
      }
    });

    watchlists.clear();
    const rawWatchlists = state.watchlists || {};
    Object.entries(rawWatchlists).forEach(([username, pages]) => {
      if (!Array.isArray(pages)) return;
      watchlists.set(username, new Set(pages));
    });
  } else if (!users.has('local')) {
    users.set('local', { username: 'local', role: 'admin', password: 'local', created: new Date().toISOString() });
  }

  auditLog = await readJson(LOCAL_AUDIT_PATH, []);
  if (!Array.isArray(auditLog)) auditLog = [];

  localStateLoaded = true;
}

async function persistLocalState() {
  const now = Date.now();
  const sessionList = Array.from(sessions.values()).filter(entry => entry.expiresAt && entry.expiresAt > now);
  const payload = {
    users: Array.from(users.values()),
    sessions: sessionList,
    watchlists: Object.fromEntries(Array.from(watchlists.entries()).map(([username, set]) => [username, Array.from(set)]))
  };
  await writeJson(LOCAL_STATE_PATH, payload);
}

async function appendAuditLog(entry) {
  auditLog.push(entry);
  if (auditLog.length > 5000) {
    auditLog = auditLog.slice(auditLog.length - 5000);
  }
  await writeJson(LOCAL_AUDIT_PATH, auditLog);
}

async function logAudit(session, action, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    username: session?.username || 'system',
    action,
    details
  };
  await appendAuditLog(entry);
}

function buildRevisionEntry(content, message, session) {
  return {
    sha: crypto.randomBytes(10).toString('hex'),
    message,
    author: session?.username || 'system',
    date: new Date().toISOString(),
    content
  };
}

async function loadRevisions(pageId) {
  const filePath = path.join(LOCAL_REVISIONS_DIR, `${pageId}.json`);
  const data = await readJson(filePath, []);
  return Array.isArray(data) ? data : [];
}

async function saveRevisions(pageId, revisions) {
  const filePath = path.join(LOCAL_REVISIONS_DIR, `${pageId}.json`);
  await writeJson(filePath, revisions);
}

async function recordRevision(pageId, content, message, session) {
  const revisions = await loadRevisions(pageId);
  revisions.unshift(buildRevisionEntry(content, message, session));
  const limited = revisions.slice(0, 50);
  await saveRevisions(pageId, limited);
  return limited[0];
}

function diffLines(fromText, toText) {
  const left = String(fromText || '').split('\n');
  const right = String(toText || '').split('\n');
  const max = Math.max(left.length, right.length);
  const rows = [];
  let added = 0;
  let removed = 0;
  let unchanged = 0;

  for (let i = 0; i < max; i += 1) {
    const a = left[i];
    const b = right[i];
    if (a === b) {
      if (a !== undefined) {
        rows.push({ type: 'same', line: a });
        unchanged += 1;
      }
      continue;
    }
    if (a !== undefined) {
      rows.push({ type: 'remove', line: a });
      removed += 1;
    }
    if (b !== undefined) {
      rows.push({ type: 'add', line: b });
      added += 1;
    }
  }

  return {
    summary: { added, removed, unchanged },
    diff: rows
  };
}

function getSession(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  return sessions.get(token) || null;
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) return null;
  const raw = Buffer.concat(chunks).toString('utf-8');
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function listPages() {
  const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  const pages = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pageId = entry.name;
    const schema = await readJson(path.join(DATA_DIR, pageId, 'schema.json'));
    const content = await readJson(path.join(DATA_DIR, pageId, 'content.json'));
    if (!schema && !content) continue;
    pages.push({
      pageId,
      title: schema?.title || pageId,
      createdBy: content?._meta?.createdBy || 'local',
      lastModified: content?._meta?.lastModified || null,
      hasContent: !!content
    });
  }
  return pages;
}

async function loadTemplateSchema(templateName) {
  return readJson(path.join(EXAMPLES, templateName, 'schema.json'));
}

function sanitizePageId(input) {
  return String(input || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function sanitizePath(root, urlPath) {
  const normalized = path.normalize(urlPath).replace(/^([/\\])+/, '');
  const resolved = path.join(root, normalized);
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

function ensureUser(username, password = null, role = 'contributor') {
  const key = String(username || '').trim().toLowerCase();
  if (!key) return null;
  if (!users.has(key)) {
    users.set(key, {
      username: key,
      role,
      password: password || generatePassword(),
      created: new Date().toISOString()
    });
  }
  return users.get(key);
}

function listSessions() {
  return Array.from(sessions.values()).map(session => ({
    username: session.username,
    role: session.role,
    created: new Date(session.createdAt || Date.now()).toISOString(),
    ip: 'local',
    isCurrent: false
  }));
}

const server = http.createServer(async (req, res) => {
  try {
    await ensureLocalData();
    await ensureLocalState();
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith('/api/')) {
      const method = req.method || 'GET';

      if (url.pathname === '/api/health') {
        return json(res, 200, {
          status: 'ok',
          localMode: true,
          checks: {
            kv_database: true,
            github_repo: true,
            github_token: true,
            passkeys_ready: false,
            passkeys_rp_id: false,
            passkeys_rp_origin: false
          }
        });
      }

      if (url.pathname === '/api/setup') {
        return json(res, 200, {
          setupRequired: false,
          setupTokenConfigured: true
        });
      }

      if (url.pathname === '/api/auth') {
        if (method === 'POST') {
          const body = await parseBody(req);
          const username = String(body?.username || '').trim().toLowerCase();
          const password = String(body?.password || '').trim();
          const user = users.get(username);
          if (!user || user.password !== password) {
            return unauthorized(res, 'Invalid credentials');
          }
          const token = crypto.randomBytes(16).toString('hex');
          const session = {
            username: user.username,
            role: user.role,
            token,
            expiresAt: Date.now() + 1000 * 60 * 60 * 12,
            createdAt: Date.now()
          };
          sessions.set(token, session);
          await persistLocalState();
          await logAudit(session, 'login', { username: session.username });
          return json(res, 200, {
            success: true,
            token: session.token,
            role: session.role,
            expiresIn: Math.floor((session.expiresAt - Date.now()) / 1000)
          });
        }

        if (method === 'GET') {
          const session = getSession(req);
          if (!session) return unauthorized(res, 'Invalid session');
          return json(res, 200, {
            valid: true,
            username: session.username,
            role: session.role,
            expiresIn: Math.floor((session.expiresAt - Date.now()) / 1000)
          });
        }

        if (method === 'DELETE') {
          const session = getSession(req);
          if (!session) return unauthorized(res, 'Invalid session');
          sessions.delete(session.token);
          await persistLocalState();
          await logAudit(session, 'logout', { username: session.username });
          return json(res, 200, { success: true });
        }
      }

      if (url.pathname === '/api/pages' && method === 'GET') {
        const pages = await listPages();
        const minimal = url.searchParams.get('minimal') === 'true';
        const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || pages.length)));
        const results = pages.slice(0, limit).map(page => {
          if (minimal) return { pageId: page.pageId, title: page.title };
          return page;
        });
        return json(res, 200, {
          pages: results,
          canEditAll: true,
          total: pages.length,
          page: 1,
          limit,
          hasMore: pages.length > limit
        });
      }

      if (url.pathname === '/api/pages' && method === 'POST') {
        const session = getSession(req);
        if (!session) return unauthorized(res, 'Login required');
        const body = await parseBody(req);
        const pageId = sanitizePageId(body?.pageId);
        if (!pageId) return json(res, 400, { error: 'pageId is required' });

        const targetDir = path.join(DATA_DIR, pageId);
        try {
          await fs.access(targetDir);
          return json(res, 409, { error: `Page "${pageId}" already exists` });
        } catch {
          // ok
        }

        let schema = body?.schema || null;
        if (!schema && body?.template) {
          schema = await loadTemplateSchema(body.template);
        }
        if (!schema) {
          schema = {
            title: body?.title || pageId,
            description: `Content for ${pageId}`,
            fields: [
              { key: 'content', label: 'Content', type: 'textarea', placeholder: 'Enter content here...' }
            ]
          };
        }
        if (body?.title) schema.title = body.title;

        const now = new Date().toISOString();
        const content = {
          _meta: {
            createdBy: session.username,
            created: now,
            modifiedBy: session.username,
            lastModified: now,
            status: 'draft',
            workflowStatus: 'draft'
          }
        };

        await writeJson(path.join(targetDir, 'schema.json'), schema);
        await writeJson(path.join(targetDir, 'content.json'), content);

        await recordRevision(pageId, content, 'Page created', session);
        await logAudit(session, 'page_create', { pageId, title: schema.title || pageId });

        return json(res, 201, {
          success: true,
          pageId,
          schema,
          content
        });
      }

      if (url.pathname === '/api/save' && method === 'POST') {
        const session = getSession(req);
        if (!session) return unauthorized(res, 'Login required');
        const body = await parseBody(req);
        const pageId = sanitizePageId(body?.pageId);
        if (!pageId) return json(res, 400, { error: 'pageId is required' });

        const contentPath = path.join(DATA_DIR, pageId, 'content.json');
        const existing = await readJson(contentPath, { _meta: {} });
        const now = new Date().toISOString();
        const content = {
          ...(body?.content || {}),
          _meta: {
            ...existing._meta,
            createdBy: existing._meta?.createdBy || session.username,
            created: existing._meta?.created || now,
            modifiedBy: session.username,
            lastModified: now,
            status: body?.saveAs === 'draft' ? 'draft' : (existing._meta?.status || 'draft'),
            workflowStatus: body?.saveAs === 'draft' ? 'draft' : (existing._meta?.workflowStatus || 'draft')
          }
        };
        await writeJson(contentPath, content);
        await recordRevision(pageId, content, body?.saveAs === 'draft' ? 'Saved draft' : 'Saved content', session);
        await logAudit(session, 'content_save', { pageId, mode: body?.saveAs === 'draft' ? 'draft' : 'live' });
        return json(res, 200, { success: true, modifiedBy: session.username });
      }

      if (url.pathname === '/api/publish' && method === 'POST') {
        const session = getSession(req);
        if (!session) return unauthorized(res, 'Login required');
        const body = await parseBody(req);
        const pageId = sanitizePageId(body?.pageId);
        if (!pageId) return json(res, 400, { error: 'pageId is required' });
        const action = body?.action === 'unpublish' ? 'unpublish' : 'publish';

        const contentPath = path.join(DATA_DIR, pageId, 'content.json');
        const existing = await readJson(contentPath, { _meta: {} });
        const now = new Date().toISOString();
        existing._meta = {
          ...existing._meta,
          modifiedBy: session.username,
          lastModified: now,
          status: action === 'publish' ? 'published' : 'draft',
          workflowStatus: action === 'publish' ? 'published' : (existing._meta?.workflowStatus || 'draft')
        };
        await writeJson(contentPath, existing);
        await recordRevision(pageId, existing, action === 'publish' ? 'Published content' : 'Unpublished content', session);
        await logAudit(session, action === 'publish' ? 'content_publish' : 'content_unpublish', { pageId });
        return json(res, 200, { success: true, status: existing._meta.status });
      }

      if (url.pathname === '/api/content' && method === 'DELETE') {
        const session = getSession(req);
        if (!session) return unauthorized(res, 'Login required');
        const body = await parseBody(req);
        const pageId = sanitizePageId(body?.pageId);
        if (!pageId) return json(res, 400, { error: 'pageId is required' });
        const contentPath = path.join(DATA_DIR, pageId, 'content.json');
        const now = new Date().toISOString();
        const content = {
          _meta: {
            createdBy: session.username,
            created: now,
            modifiedBy: session.username,
            lastModified: now,
            status: 'draft',
            workflowStatus: 'draft'
          }
        };
        await writeJson(contentPath, content);
        await recordRevision(pageId, content, 'Deleted content', session);
        await logAudit(session, 'content_delete', { pageId });
        return json(res, 200, { success: true, commit: 'local-delete' });
      }

      if (url.pathname === '/api/workflow' && method === 'POST') {
        const session = getSession(req);
        if (!session) return unauthorized(res, 'Login required');
        const body = await parseBody(req);
        const pageId = sanitizePageId(body?.pageId);
        if (!pageId) return json(res, 400, { error: 'pageId is required' });
        const status = String(body?.status || 'draft');
        const contentPath = path.join(DATA_DIR, pageId, 'content.json');
        const existing = await readJson(contentPath, { _meta: {} });
        existing._meta = {
          ...existing._meta,
          workflowStatus: status,
          scheduledFor: body?.scheduledFor || null,
          modifiedBy: session.username,
          lastModified: new Date().toISOString()
        };
        await writeJson(contentPath, existing);
        await recordRevision(pageId, existing, `Workflow set to ${status}`, session);
        await logAudit(session, 'content_workflow_update', { pageId, status });
        return json(res, 200, { success: true });
      }

      if (url.pathname === '/api/blocks') {
        return json(res, 200, {
          blocks: [
            { id: 'cta', label: 'Call To Action', content: '## Ready to take the next step?\nAdd a clear call to action here.' },
            { id: 'note', label: 'Quick Note', content: 'Use this block for short updates or alerts.' }
          ]
        });
      }

      if (url.pathname === '/api/users') {
        const session = getSession(req);
        if (!session) return unauthorized(res, 'Login required');

        if (method === 'GET') {
          return json(res, 200, {
            users: Array.from(users.values()).map(({ password, ...rest }) => rest),
            total: users.size
          });
        }

        if (method === 'POST') {
          const body = await parseBody(req);
          const username = String(body?.username || '').trim().toLowerCase();
          if (!username) return json(res, 400, { error: 'username is required' });
          if (users.has(username)) return json(res, 409, { error: 'User already exists' });
          const role = String(body?.role || 'contributor');
          const password = String(body?.password || generatePassword());
          users.set(username, { username, role, password, created: new Date().toISOString() });
          await persistLocalState();
          await logAudit(session, 'user_create', { username, role });
          return json(res, 201, { success: true, username, role, password });
        }

        if (method === 'PATCH') {
          const body = await parseBody(req);
          const username = String(body?.username || '').trim().toLowerCase();
          if (!username || !users.has(username)) return json(res, 404, { error: 'User not found' });
          const user = users.get(username);
          const role = body?.role ? String(body.role) : user.role;
          let password = body?.password ? String(body.password) : user.password;
          let resetPassword = false;
          if (body?.resetPassword) {
            password = generatePassword();
            resetPassword = true;
          }
          users.set(username, { ...user, role, password });
          await persistLocalState();
          if (resetPassword) {
            await logAudit(session, 'password_change', { username, reset: true });
            return json(res, 200, { success: true, username, role, newPassword: password });
          }
          await logAudit(session, 'user_role_change', { username, role });
          return json(res, 200, { success: true, username, role });
        }

        if (method === 'DELETE') {
          const body = await parseBody(req);
          const username = String(body?.username || '').trim().toLowerCase();
          if (!username || !users.has(username)) return json(res, 404, { error: 'User not found' });
          if (username === session.username) return json(res, 400, { error: 'Cannot delete current user' });
          users.delete(username);
          await persistLocalState();
          await logAudit(session, 'user_delete', { username });
          return json(res, 200, { success: true, username });
        }
      }

      if (url.pathname === '/api/sessions') {
        const session = getSession(req);
        if (!session) return unauthorized(res, 'Login required');

        if (method === 'GET') {
          const list = listSessions().map(entry => ({
            ...entry,
            isCurrent: entry.username === session.username
          }));
          return json(res, 200, { sessions: list, total: list.length });
        }

        if (method === 'DELETE') {
          const body = await parseBody(req);
          const username = String(body?.username || '').trim().toLowerCase();
          if (!username) return json(res, 400, { error: 'username is required' });
          for (const [token, entry] of sessions.entries()) {
            if (entry.username === username) {
              sessions.delete(token);
            }
          }
          await persistLocalState();
          await logAudit(session, 'logout', { username, revoked: true });
          return json(res, 200, { success: true, revoked: username });
        }
      }

      if (url.pathname === '/api/history') {
        const pageId = sanitizePageId(url.searchParams.get('pageId'));
        if (!pageId) return json(res, 400, { error: 'pageId is required' });
        const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 25)));
        const revisions = await loadRevisions(pageId);
        const history = revisions.slice(0, limit).map(entry => ({
          sha: entry.sha,
          message: entry.message,
          author: entry.author,
          date: entry.date,
          url: null
        }));
        return json(res, 200, { history });
      }

      if (url.pathname === '/api/revision-diff') {
        const pageId = sanitizePageId(url.searchParams.get('pageId'));
        const fromSha = String(url.searchParams.get('from') || '');
        const toSha = String(url.searchParams.get('to') || '');
        if (!pageId || !fromSha || !toSha) {
          return json(res, 400, { error: 'pageId, from, and to are required' });
        }
        const revisions = await loadRevisions(pageId);
        const fromEntry = revisions.find(entry => entry.sha === fromSha);
        const toEntry = revisions.find(entry => entry.sha === toSha);
        if (!fromEntry || !toEntry) {
          return json(res, 404, { error: 'Revision not found' });
        }
        const fromText = JSON.stringify(fromEntry.content || {}, null, 2);
        const toText = JSON.stringify(toEntry.content || {}, null, 2);
        const diff = diffLines(fromText, toText);
        return json(res, 200, diff);
      }

      if (url.pathname === '/api/rollback' && method === 'POST') {
        const session = getSession(req);
        if (!session) return unauthorized(res, 'Login required');
        const body = await parseBody(req);
        const pageId = sanitizePageId(body?.pageId);
        const commitSha = String(body?.commitSha || '');
        if (!pageId || !commitSha) return json(res, 400, { error: 'pageId and commitSha are required' });
        const revisions = await loadRevisions(pageId);
        const target = revisions.find(entry => entry.sha === commitSha);
        if (!target) return json(res, 404, { error: 'Revision not found' });
        const contentPath = path.join(DATA_DIR, pageId, 'content.json');
        await writeJson(contentPath, target.content || {});
        const newEntry = await recordRevision(pageId, target.content || {}, `Rollback to ${commitSha.slice(0, 10)}`, session);
        await logAudit(session, 'content_rollback', { pageId, commitSha });
        return json(res, 200, { commit: newEntry.sha });
      }

      if (url.pathname === '/api/scheduled-publish' && method === 'POST') {
        const session = getSession(req);
        if (!session) return unauthorized(res, 'Login required');
        await logAudit(session, 'content_scheduled_publish', { triggeredAt: new Date().toISOString() });
        return json(res, 200, { published: [] });
      }

      if (url.pathname === '/api/watch') {
        const session = getSession(req);
        if (!session) return unauthorized(res, 'Login required');

        if (method === 'GET') {
          const watched = Array.from(watchlists.get(session.username) || []);
          return json(res, 200, { watchedPages: watched, recent: [] });
        }

        if (method === 'POST') {
          const body = await parseBody(req);
          const pageId = sanitizePageId(body?.pageId);
          if (!pageId) return json(res, 400, { error: 'pageId is required' });
          const set = watchlists.get(session.username) || new Set();
          set.add(pageId);
          watchlists.set(session.username, set);
          await persistLocalState();
          return json(res, 200, { success: true, pageId, watchedPages: Array.from(set) });
        }

        if (method === 'DELETE') {
          const body = await parseBody(req);
          const pageId = sanitizePageId(body?.pageId);
          if (!pageId) return json(res, 400, { error: 'pageId is required' });
          const set = watchlists.get(session.username) || new Set();
          set.delete(pageId);
          watchlists.set(session.username, set);
          await persistLocalState();
          return json(res, 200, { success: true, pageId, watchedPages: Array.from(set) });
        }
      }

      if (url.pathname === '/api/audit') {
        const limit = Math.max(1, Math.min(2000, Number(url.searchParams.get('limit') || 100)));
        const logs = auditLog.slice(-limit).reverse();
        return json(res, 200, { logs, total: auditLog.length, filters: {} });
      }

      if (url.pathname === '/api/bulk-publish' && method === 'POST') {
        const session = getSession(req);
        if (!session) return unauthorized(res, 'Login required');
        const body = await parseBody(req);
        const pageIds = Array.isArray(body?.pageIds) ? body.pageIds.map(sanitizePageId).filter(Boolean) : [];
        if (!pageIds.length) return json(res, 400, { error: 'pageIds are required' });
        const action = body?.action === 'unpublish' ? 'unpublish' : 'publish';
        const dryRun = !!body?.dryRun;
        const results = [];
        for (const pageId of pageIds) {
          const contentPath = path.join(DATA_DIR, pageId, 'content.json');
          const existing = await readJson(contentPath, null);
          if (!existing) {
            results.push({ pageId, ok: false, error: 'Content not found' });
            continue;
          }
          if (!dryRun) {
            const now = new Date().toISOString();
            existing._meta = {
              ...existing._meta,
              modifiedBy: session.username,
              lastModified: now,
              status: action === 'publish' ? 'published' : 'draft',
              workflowStatus: action === 'publish' ? 'published' : (existing._meta?.workflowStatus || 'draft')
            };
            await writeJson(contentPath, existing);
            await recordRevision(pageId, existing, action === 'publish' ? 'Bulk published' : 'Bulk unpublished', session);
          }
          results.push({ pageId, ok: true });
        }
        await logAudit(session, 'bulk_publish', { action, dryRun, count: results.length });
        return json(res, 200, { success: true, dryRun, results });
      }

      if (url.pathname === '/api/feedback' && method === 'POST') {
        return json(res, 200, { success: true });
      }

      if (url.pathname === '/api/upload' && method === 'POST') {
        return json(res, 501, { error: 'Uploads are not available in local mode.' });
      }

      return notFound(res, 'Unknown API route');
    }

    if (url.pathname.startsWith('/data/')) {
      const segments = url.pathname.split('/').filter(Boolean);
      const pageId = segments[1];
      const fileName = segments[2];
      if (!pageId || !fileName) return notFound(res, 'Invalid data path');
      const filePath = sanitizePath(DATA_DIR, `${pageId}/${fileName}`);
      if (!filePath) return notFound(res, 'Invalid data path');
      try {
        const file = await fs.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(file);
        return;
      } catch {
        return notFound(res, 'Data file not found');
      }
    }

    let pathname = url.pathname;
    if (pathname === '/' || pathname === '') pathname = '/index.html';
    if (pathname === '/admin') pathname = '/admin.html';

    const filePath = sanitizePath(ROOT, pathname);
    if (!filePath) return notFound(res);
    try {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        return notFound(res, 'Directory listing disabled');
      }
      const file = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(file);
    } catch {
      notFound(res);
    }
  } catch (err) {
    json(res, 500, { error: err.message || 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`LOON local server running at http://localhost:${PORT}`);
  console.log('Local login: username "local" / password "local"');
});
