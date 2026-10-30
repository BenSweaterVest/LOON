/**
 * A small, safe Markdown renderer. All raw HTML is escaped and every link or
 * image URL must pass isSafeUrl, so content authors cannot inject script.
 *
 * Supports: ATX headings, paragraphs, hard breaks (two spaces or backslash),
 * **bold**, *italic*, ~~strike~~, `code`, fenced code, links, images,
 * autolinks, bullet/numbered lists (nested by indentation), task items,
 * blockquotes, horizontal rules and GitHub-style tables.
 */

import { isSafeUrl } from './schema.js';

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function headingId(text) {
    return String(text).toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z0-9#]+;/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';
}

function inline(text, opts) {
    const placeholders = [];
    const keep = (html) => `\u0000${placeholders.push(html) - 1}\u0000`;

    let out = text
        .replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${escapeHtml(code)}</code>`))
        .replace(/\\([\\`*_{}[\]()#+\-.!~|>])/g, (_, ch) => keep(escapeHtml(ch)));

    out = out.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)/g, (match, alt, src, title) => {
        if (!isSafeUrl(src)) return keep(escapeHtml(match));
        const url = opts.resolveUrl(src);
        return keep(`<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}"${title ? ` title="${escapeHtml(title)}"` : ''} loading="lazy">`);
    });
    out = out.replace(/\[([^\]]+)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)/g, (match, label, href, title) => {
        if (!isSafeUrl(href)) return keep(escapeHtml(match));
        const url = opts.resolveUrl(href);
        const external = /^https?:/i.test(url);
        return keep(`<a href="${escapeHtml(url)}"${title ? ` title="${escapeHtml(title)}"` : ''}${external ? ' rel="noopener"' : ''}>${inline(label, opts)}</a>`);
    });
    out = out.replace(/<(https?:\/\/[^\s>]+)>/g, (_, url) => keep(`<a href="${escapeHtml(url)}" rel="noopener">${escapeHtml(url)}</a>`));

    out = escapeHtml(out)
        .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
        .replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>')
        .replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?!\*)/g, '$1<em>$2</em>')
        .replace(/(^|[^_\w])_(?=\S)([^_]*?\S)_(?![_\w])/g, '$1<em>$2</em>')
        .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
        .replace(opts.breaks ? /(?: {2,}|\\)?\n/g : /(?: {2,}|\\)\n/g, '<br>\n');

    return out.replace(/\u0000(\d+)\u0000/g, (_, i) => placeholders[Number(i)]);
}

const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line) {
    let row = line.trim();
    if (row.startsWith('|')) row = row.slice(1);
    if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
    return row.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function renderList(lines, start, opts) {
    const items = [];
    const first = LIST_ITEM.exec(lines[start]);
    const baseIndent = first[1].length;
    const ordered = /\d/.test(first[2]);
    const startNumber = ordered ? Number.parseInt(first[2], 10) : 1;
    let i = start;
    while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i]);
        if (!m || m[1].length < baseIndent) break;
        if (m[1].length > baseIndent) {
            const nested = renderList(lines, i, opts);
            if (items.length) items[items.length - 1].children += nested.html;
            i = nested.next;
            continue;
        }
        if (/\d/.test(m[2]) !== ordered) break;
        let text = m[3];
        i++;
        while (i < lines.length && lines[i].trim() && !LIST_ITEM.test(lines[i]) && /^\s+/.test(lines[i])) {
            text += `\n${lines[i].trim()}`;
            i++;
        }
        let task = '';
        const taskMatch = /^\[([ xX])\]\s+(.*)$/s.exec(text);
        if (taskMatch) {
            task = taskMatch[1] === ' ' ? '<span class="task" aria-label="Not done">☐</span> ' : '<span class="task done" aria-label="Done">☑</span> ';
            text = taskMatch[2];
        }
        items.push({ html: task + inline(text, opts), children: '' });
        if (i < lines.length && !lines[i].trim() && i + 1 < lines.length && LIST_ITEM.test(lines[i + 1]) && LIST_ITEM.exec(lines[i + 1])[1].length >= baseIndent) i++;
    }
    const tag = ordered ? 'ol' : 'ul';
    const startAttr = ordered && startNumber !== 1 ? ` start="${startNumber}"` : '';
    return { html: `<${tag}${startAttr}>${items.map((it) => `<li>${it.html}${it.children}</li>`).join('')}</${tag}>`, next: i };
}

/**
 * Render Markdown to HTML.
 *   options.resolveUrl(url) maps URLs (e.g. /media/... to a preview source).
 *   options.minLevel is the smallest heading level emitted (2 turns # into h2).
 *   options.breaks turns every single newline into a line break (default true).
 * Returns { html, headings: [{ level, text, id }] }.
 */
export function renderMarkdown(source, options = {}) {
    const opts = { resolveUrl: (u) => u, minLevel: 1, breaks: true, ...options };
    const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    const headings = [];
    const usedIds = new Map();
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) { i++; continue; }

        const fence = /^\s*(```|~~~)\s*([\w-]*)\s*$/.exec(line);
        if (fence) {
            const body = [];
            i++;
            while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
            i++;
            const lang = fence[2] ? ` class="language-${escapeHtml(fence[2])}"` : '';
            out.push(`<pre><code${lang}>${escapeHtml(body.join('\n'))}</code></pre>`);
            continue;
        }

        const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
        if (heading) {
            const level = Math.min(6, Math.max(opts.minLevel, heading[1].length));
            const html = inline(heading[2], opts);
            let id = headingId(heading[2]);
            const count = usedIds.get(id) || 0;
            usedIds.set(id, count + 1);
            if (count) id = `${id}-${count + 1}`;
            headings.push({ level, text: heading[2].replace(/[*_`~]/g, ''), id });
            out.push(`<h${level} id="${id}">${html}</h${level}>`);
            i++;
            continue;
        }

        if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
            out.push('<hr>');
            i++;
            continue;
        }

        if (/^\s*>/.test(line)) {
            const body = [];
            while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
            out.push(`<blockquote>${renderMarkdown(body.join('\n'), opts).html}</blockquote>`);
            continue;
        }

        if (LIST_ITEM.test(line)) {
            const list = renderList(lines, i, opts);
            out.push(list.html);
            i = list.next;
            continue;
        }

        if (line.includes('|') && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
            const header = splitRow(line);
            const aligns = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''));
            i += 2;
            const rows = [];
            while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
            const cell = (tag, text, idx) => `<${tag}${aligns[idx] ? ` class="align-${aligns[idx]}"` : ''}>${inline(text, opts)}</${tag}>`;
            out.push(
                `<div class="table-wrap"><table><thead><tr>${header.map((h, idx) => cell('th', h, idx)).join('')}</tr></thead>` +
                `<tbody>${rows.map((r) => `<tr>${header.map((_, idx) => cell('td', r[idx] ?? '', idx)).join('')}</tr>`).join('')}</tbody></table></div>`
            );
            continue;
        }

        const para = [];
        while (
            i < lines.length && lines[i].trim() &&
            !/^(#{1,6})\s/.test(lines[i]) && !/^\s*(```|~~~)/.test(lines[i]) && !/^\s*>/.test(lines[i]) &&
            !LIST_ITEM.test(lines[i]) && !/^\s*([-*_])(\s*\1){2,}\s*$/.test(lines[i])
        ) {
            para.push(lines[i++]);
        }
        out.push(`<p>${inline(para.join('\n'), opts)}</p>`);
    }
    return { html: out.join('\n'), headings };
}

/**
 * Plain text from Markdown, for meta descriptions and excerpts.
 */
export function markdownToText(source, maxLength = 160) {
    const text = String(source ?? '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[#>*_`~|-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 1).replace(/\s+\S*$/, '')}…` : text;
}
