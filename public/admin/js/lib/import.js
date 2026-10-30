/**
 * Import documents into Markdown fields: .docx, .odt, .html, .md and .txt.
 * Uses the browser's DecompressionStream and DOMParser, no libraries.
 */

async function inflateRaw(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Read one file from a ZIP archive by name. */
export async function readZipEntry(buffer, wanted) {
    const view = new DataView(buffer);
    let eocd = -1;
    for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
        if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a valid document (zip directory missing)');
    const count = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();
    for (let n = 0; n < count; n++) {
        if (view.getUint32(offset, true) !== 0x02014b50) break;
        const method = view.getUint16(offset + 10, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const localOffset = view.getUint32(offset + 42, true);
        const name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLength));
        if (name === wanted) {
            const localName = view.getUint16(localOffset + 26, true);
            const localExtra = view.getUint16(localOffset + 28, true);
            const start = localOffset + 30 + localName + localExtra;
            const data = new Uint8Array(buffer, start, compressedSize);
            if (method === 0) return decoder.decode(data);
            if (method === 8) return decoder.decode(await inflateRaw(data));
            throw new Error('Unsupported compression in document');
        }
        offset += 46 + nameLength + extraLength + commentLength;
    }
    throw new Error(`Document is missing ${wanted}`);
}

function wrapInline(text, bold, italic) {
    if (!text.trim()) return text;
    const lead = text.match(/^\s*/)[0];
    const trail = text.match(/\s*$/)[0];
    let core = text.trim().replace(/([*_`\\])/g, '\\$1');
    if (italic) core = `*${core}*`;
    if (bold) core = `**${core}**`;
    return lead + core + trail;
}

function docxToMarkdown(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const out = [];
    for (const p of doc.getElementsByTagNameNS(W, 'p')) {
        const style = p.getElementsByTagNameNS(W, 'pStyle')[0]?.getAttributeNS(W, 'val') || '';
        const isList = p.getElementsByTagNameNS(W, 'numPr').length > 0;
        const level = Number(p.getElementsByTagNameNS(W, 'ilvl')[0]?.getAttributeNS(W, 'val') || 0);
        let text = '';
        for (const run of p.getElementsByTagNameNS(W, 'r')) {
            const props = run.getElementsByTagNameNS(W, 'rPr')[0];
            const bold = !!props?.getElementsByTagNameNS(W, 'b').length;
            const italic = !!props?.getElementsByTagNameNS(W, 'i').length;
            let runText = '';
            for (const node of run.childNodes) {
                if (node.localName === 't') runText += node.textContent;
                else if (node.localName === 'tab') runText += ' ';
                else if (node.localName === 'br') runText += '\n';
            }
            text += wrapInline(runText, bold, italic);
        }
        const heading = /^(Heading|heading)(\d)$/.exec(style) || (/^Title$/.test(style) ? [0, 0, '1'] : null);
        if (!text.trim()) { out.push(''); continue; }
        if (heading) out.push(`${'#'.repeat(Math.min(6, Number(heading[2])))} ${text.trim()}`);
        else if (isList || /List/.test(style)) out.push(`${'  '.repeat(level)}- ${text.trim()}`);
        else out.push(text.trim());
    }
    return tidy(out);
}

function odtToMarkdown(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const out = [];
    const walk = (node, depth) => {
        for (const child of node.children) {
            if (child.localName === 'h') {
                const level = Number(child.getAttribute('text:outline-level') || 1);
                out.push(`${'#'.repeat(Math.min(6, level))} ${child.textContent.trim()}`);
            } else if (child.localName === 'p') {
                out.push(child.textContent.trim());
            } else if (child.localName === 'list') {
                for (const item of child.children) {
                    const text = [...item.children].filter((c) => c.localName === 'p').map((c) => c.textContent.trim()).join(' ');
                    if (text) out.push(`${'  '.repeat(depth)}- ${text}`);
                    for (const nested of [...item.children].filter((c) => c.localName === 'list')) walk({ children: [nested] }, depth + 1);
                }
            } else if (child.children?.length) {
                walk(child, depth);
            }
        }
    };
    const body = doc.getElementsByTagName('office:text')[0] || doc.documentElement;
    walk(body, 0);
    return tidy(out);
}

export function htmlToMarkdown(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const inline = (node) => [...node.childNodes].map((child) => {
        if (child.nodeType === Node.TEXT_NODE) return child.textContent.replace(/\s+/g, ' ');
        const tag = child.localName;
        const inner = inline(child);
        if (tag === 'strong' || tag === 'b') return wrapInline(inner, true, false);
        if (tag === 'em' || tag === 'i') return wrapInline(inner, false, true);
        if (tag === 'br') return '\n';
        if (tag === 'code') return `\`${child.textContent}\``;
        if (tag === 'a' && /^(https?:|mailto:|\/)/.test(child.getAttribute('href') || '')) return `[${inner.trim()}](${child.getAttribute('href')})`;
        return inner;
    }).join('');
    const out = [];
    const block = (node, depth = 0) => {
        for (const child of node.children) {
            const tag = child.localName;
            if (/^h[1-6]$/.test(tag)) out.push(`${'#'.repeat(Number(tag[1]))} ${inline(child).trim()}`, '');
            else if (tag === 'p') out.push(inline(child).trim(), '');
            else if (tag === 'ul' || tag === 'ol') {
                [...child.children].forEach((li, i) => {
                    out.push(`${'  '.repeat(depth)}${tag === 'ol' ? `${i + 1}.` : '-'} ${inline(li).trim()}`);
                    for (const nested of li.querySelectorAll(':scope > ul, :scope > ol')) block({ children: [nested] }, depth + 1);
                });
                if (!depth) out.push('');
            } else if (tag === 'blockquote') out.push(`> ${inline(child).trim()}`, '');
            else if (tag === 'pre') out.push('```', child.textContent, '```', '');
            else if (tag === 'hr') out.push('---', '');
            else if (child.children.length) block(child, depth);
            else if (child.textContent.trim()) out.push(inline(child).trim(), '');
        }
    };
    block(doc.body);
    return tidy(out);
}

function tidy(lines) {
    const out = [];
    for (const line of lines) {
        const prev = out[out.length - 1];
        const isList = /^\s*([-*]|\d+\.)\s/.test(line);
        const prevList = prev !== undefined && /^\s*([-*]|\d+\.)\s/.test(prev);
        if (line === '' && prev === '') continue;
        if (line !== '' && prev !== undefined && prev !== '' && !(isList && prevList)) out.push('');
        out.push(line);
    }
    return out.join('\n').trim();
}

export const IMPORT_ACCEPT = '.docx,.odt,.html,.htm,.md,.markdown,.txt';

export async function importDocument(file) {
    const name = file.name.toLowerCase();
    if (file.size > 20 * 1024 * 1024) throw new Error('Documents must be under 20 MB');
    if (name.endsWith('.docx')) return docxToMarkdown(await readZipEntry(await file.arrayBuffer(), 'word/document.xml'));
    if (name.endsWith('.odt')) return odtToMarkdown(await readZipEntry(await file.arrayBuffer(), 'content.xml'));
    if (name.endsWith('.html') || name.endsWith('.htm')) return htmlToMarkdown(await file.text());
    if (name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt')) return (await file.text()).trim();
    throw new Error('Supported formats: Word (.docx), OpenDocument (.odt), HTML, Markdown and plain text');
}
