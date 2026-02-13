/**
 * Shared GitHub Contents API helpers.
 */

const DEFAULT_RETRY_STATUSES = [429, 500, 502, 503, 504];

function getRepoContentsUrl(env, path) {
    return `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;
}

function getRepoApiUrl(env, path) {
    return `https://api.github.com/repos/${env.GITHUB_REPO}/${path}`;
}

function encodeJsonToBase64(value, pretty = false) {
    const json = pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
    return btoa(unescape(encodeURIComponent(json)));
}

function decodeBase64Json(content) {
    return JSON.parse(atob(content));
}

function isRetryableNetworkError(err) {
    if (!(err instanceof Error)) return false;
    if (err instanceof TypeError) return true;
    return err.message.includes('fetch failed');
}

async function sleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function githubRequest(env, path, options = {}) {
    const {
        method = 'GET',
        body,
        retries = 0,
        retryStatuses = DEFAULT_RETRY_STATUSES,
        userAgent = 'LOON-CMS/1.0'
    } = options;

    const url = getRepoContentsUrl(env, path);
    const headers = {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': userAgent
    };

    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }

    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await fetch(url, {
                method,
                headers,
                body: body === undefined ? undefined : JSON.stringify(body)
            });

            if (response.ok || !retryStatuses.includes(response.status) || attempt === retries) {
                return response;
            }

            const text = await response.text();
            lastError = new Error(`GitHub API error: ${response.status} - ${text}`);
            await sleep(Math.pow(2, attempt) * 1000);
        } catch (err) {
            lastError = err;
            if (attempt === retries || !isRetryableNetworkError(err)) {
                throw err;
            }
            await sleep(Math.pow(2, attempt) * 1000);
        }
    }

    throw lastError || new Error('GitHub request failed');
}

async function githubApiRequest(env, path, options = {}) {
    const {
        method = 'GET',
        body,
        retries = 0,
        retryStatuses = DEFAULT_RETRY_STATUSES,
        userAgent = 'LOON-CMS/1.0'
    } = options;

    const url = getRepoApiUrl(env, path);
    const headers = {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': userAgent
    };

    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }

    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await fetch(url, {
                method,
                headers,
                body: body === undefined ? undefined : JSON.stringify(body)
            });

            if (response.ok || !retryStatuses.includes(response.status) || attempt === retries) {
                return response;
            }

            const text = await response.text();
            lastError = new Error(`GitHub API error: ${response.status} - ${text}`);
            await sleep(Math.pow(2, attempt) * 1000);
        } catch (err) {
            lastError = err;
            if (attempt === retries || !isRetryableNetworkError(err)) {
                throw err;
            }
            await sleep(Math.pow(2, attempt) * 1000);
        }
    }

    throw lastError || new Error('GitHub request failed');
}

function appendRef(path, ref) {
    if (!ref || ref === 'HEAD') return path;
    const delimiter = path.includes('?') ? '&' : '?';
    return `${path}${delimiter}ref=${encodeURIComponent(ref)}`;
}

export async function getRepoFileJson(env, path, options = {}) {
    const { ref = 'HEAD' } = options;
    const res = await githubRequest(env, appendRef(path, ref), { method: 'GET' });
    if (res.status === 404) {
        return { exists: false, sha: null, content: null };
    }
    if (!res.ok) {
        throw new Error(`GitHub GET failed: ${res.status}`);
    }

    const json = await res.json();
    return {
        exists: true,
        sha: json.sha,
        content: decodeBase64Json(json.content)
    };
}

export async function listRepoDirectory(env, path, options = {}) {
    const { ref = 'HEAD' } = options;
    const res = await githubRequest(env, appendRef(path, ref), { method: 'GET' });
    if (res.status === 404) {
        return null;
    }
    if (!res.ok) {
        throw new Error(`GitHub API error: ${res.status}`);
    }
    return res.json();
}

export async function repoPathExists(env, path) {
    const res = await githubRequest(env, path, { method: 'GET' });
    return res.ok;
}

export async function getRepoApiJson(env, path, options = {}) {
    const { allow404 = false, retries = 0 } = options;
    const res = await githubApiRequest(env, path, { method: 'GET', retries });
    if (res.status === 404 && allow404) {
        return null;
    }
    if (!res.ok) {
        const text = await res.text();
        const err = new Error(`GitHub API error: ${res.status} - ${text}`);
        err.status = res.status;
        throw err;
    }
    return res.json();
}

export async function putRepoFileJson(env, path, content, message, existingSha, options = {}) {
    const { retries = 0, pretty = false } = options;
    const payload = {
        message,
        content: encodeJsonToBase64(content, pretty)
    };

    if (existingSha) {
        payload.sha = existingSha;
    }

    const res = await githubRequest(env, path, {
        method: 'PUT',
        body: payload,
        retries
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`GitHub PUT failed: ${res.status} - ${text}`);
    }

    const json = await res.json();
    return json.commit.sha;
}

export async function deleteRepoFile(env, path, message) {
    const current = await githubRequest(env, path, { method: 'GET' });
    if (current.status === 404) {
        return { success: false, error: 'Content not found' };
    }
    if (!current.ok) {
        throw new Error(`GitHub GET failed: ${current.status}`);
    }

    const currentJson = await current.json();
    const res = await githubRequest(env, path, {
        method: 'DELETE',
        body: {
            message,
            sha: currentJson.sha
        }
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`GitHub DELETE failed: ${res.status} - ${text}`);
    }

    const json = await res.json();
    return { success: true, commit: json.commit.sha };
}
