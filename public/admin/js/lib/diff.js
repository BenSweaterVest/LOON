/**
 * Line-based diff (LCS) for comparing revisions.
 */

export function diffLines(before, after) {
    const a = String(before ?? '').split('\n');
    const b = String(after ?? '').split('\n');
    if (a.length * b.length > 250000) {
        return [...a.map((text) => ({ type: 'del', text })), ...b.map((text) => ({ type: 'add', text }))];
    }
    const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const out = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { out.push({ type: 'ctx', text: a[i] }); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ type: 'del', text: a[i++] });
        else out.push({ type: 'add', text: b[j++] });
    }
    while (i < a.length) out.push({ type: 'del', text: a[i++] });
    while (j < b.length) out.push({ type: 'add', text: b[j++] });
    return out;
}

function asText(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2);
}

/**
 * Field-by-field changes between two content objects.
 * Returns [{ key, label, lines }] for changed fields only.
 */
export function diffContent(schema, before, after) {
    const labels = new Map((schema?.fields || []).map((f) => [f.key, f.label]));
    const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
    return keys
        .filter((key) => asText(before?.[key]) !== asText(after?.[key]))
        .map((key) => ({ key, label: labels.get(key) || key, lines: diffLines(asText(before?.[key]), asText(after?.[key])) }));
}
