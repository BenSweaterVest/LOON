/**
 * Visual schema editor (editors and admins). Resolves with a validated
 * schema, or null when cancelled.
 */

import { h, mount, openDialog } from '../dom.js';
import { FIELD_TYPES, validateSchema } from '/assets/shared/schema.js';

function keyFromLabel(label) {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 40) || 'field';
}

export function editSchema(schema) {
    const fields = structuredClone(schema.fields || []);
    let jsonMode = false;
    const list = h('div');
    const json = h('textarea', { class: 'code', rows: 22, spellcheck: 'false', 'aria-label': 'Schema JSON' });
    const errors = h('div', { class: 'notice danger', hidden: true });

    function row(field, i) {
        const label = h('input', { type: 'text', value: field.label, 'aria-label': 'Label' });
        const key = h('input', { type: 'text', value: field.key, class: 'mono', 'aria-label': 'Key', title: 'Stored name; changing it disconnects existing content' });
        const type = h('select', { 'aria-label': 'Type' }, Object.entries(FIELD_TYPES).map(([t, info]) => h('option', { value: t, selected: t === field.type }, info.label)));
        const required = h('input', { type: 'checkbox', checked: !!field.required });
        const options = h('textarea', { rows: 2, placeholder: 'One choice per line', 'aria-label': 'Choices' });
        options.value = (field.options || []).join('\n');
        const sub = h('textarea', { class: 'code', rows: 5, 'aria-label': 'Group fields (JSON)' });
        sub.value = JSON.stringify(field.fields || [{ key: 'name', label: 'Name', type: 'text' }], null, 2);
        const help = h('input', { type: 'text', value: field.description || '', placeholder: 'Help text (optional)', 'aria-label': 'Help text' });
        const optionsBox = h('div', { class: 'field' }, h('label', null, 'Choices'), options);
        const subBox = h('div', { class: 'field' }, h('label', null, 'Fields in each entry (JSON)'), sub);
        const sync = () => {
            const wasNew = field.key === keyFromLabel(field.label) || !field.key;
            field.label = label.value;
            if (wasNew && document.activeElement === label) key.value = keyFromLabel(label.value);
            field.key = key.value.trim();
            field.type = type.value;
            field.required = required.checked || undefined;
            field.description = help.value.trim() || undefined;
            if (field.type === 'select') field.options = options.value.split('\n').map((o) => o.trim()).filter(Boolean);
            else delete field.options;
            if (field.type === 'repeater') {
                try { field.fields = JSON.parse(sub.value); sub.setCustomValidity(''); } catch { sub.setCustomValidity('Invalid JSON'); }
            } else delete field.fields;
            optionsBox.hidden = field.type !== 'select';
            subBox.hidden = field.type !== 'repeater';
        };
        for (const el of [label, key, type, required, options, sub, help]) el.addEventListener('input', sync);
        type.addEventListener('change', sync);
        sync();
        const move = (d) => {
            const j = i + d;
            if (j < 0 || j >= fields.length) return;
            [fields[i], fields[j]] = [fields[j], fields[i]];
            draw();
        };
        return h('div', { class: 'panel' },
            h('div', { class: 'grid-2' },
                h('div', { class: 'field' }, h('label', null, 'Label'), label),
                h('div', { class: 'field' }, h('label', null, 'Key'), key)),
            h('div', { class: 'grid-2' },
                h('div', { class: 'field' }, h('label', null, 'Type'), type),
                h('div', { class: 'field' }, h('label', null, 'Help text'), help)),
            optionsBox, subBox,
            h('div', { class: 'row' },
                h('label', { class: 'check' }, required, 'Required to publish'),
                h('span', { class: 'spacer' }),
                h('button', { type: 'button', class: 'small', disabled: i === 0, onClick: () => move(-1) }, '↑ Up'),
                h('button', { type: 'button', class: 'small', disabled: i === fields.length - 1, onClick: () => move(1) }, '↓ Down'),
                h('button', { type: 'button', class: 'small danger', onClick: () => { fields.splice(i, 1); draw(); } }, 'Remove')));
    }

    function draw() {
        if (jsonMode) {
            json.value = JSON.stringify({ fields }, null, 2);
            mount(list, json);
        } else {
            mount(list, fields.map(row), h('button', { type: 'button', onClick: () => {
                fields.push({ key: `field_${fields.length + 1}`, label: `Field ${fields.length + 1}`, type: 'text' });
                draw();
            } }, '+ Add field'));
        }
    }

    const toggle = h('button', { type: 'button', class: 'small', onClick: () => {
        if (jsonMode) {
            try {
                const parsed = JSON.parse(json.value);
                fields.splice(0, fields.length, ...(parsed.fields || []));
            } catch {
                errors.hidden = false;
                errors.textContent = 'The JSON is not valid.';
                return;
            }
        }
        errors.hidden = true;
        jsonMode = !jsonMode;
        toggle.textContent = jsonMode ? 'Edit visually' : 'Edit as JSON';
        draw();
    } }, 'Edit as JSON');

    draw();
    return openDialog({
        title: 'Page fields',
        wide: true,
        body: h('div', null,
            h('div', { class: 'notice warn' }, h('p', null, 'Changing a field key or type can hide existing content in that field. Content is kept in the page history.')),
            h('div', { class: 'row' }, toggle), errors, list),
        actions: [{ label: 'Cancel', value: null }, { label: 'Apply', value: 'apply', primary: true, submit: true }],
        onSubmit: () => {
            let candidate = { fields };
            if (jsonMode) candidate = JSON.parse(json.value);
            const result = validateSchema(candidate);
            if (result.errors.length) {
                errors.hidden = false;
                mount(errors, h('ul', null, result.errors.map((e) => h('li', null, e))));
                return false;
            }
            return result.schema;
        }
    });
}
