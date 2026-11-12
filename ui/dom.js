/**
 * Tiny DOM toolkit. No templates, no innerHTML with user data.
 */
import { ctx, t } from '../lib/st.js';
import { settings } from '../lib/settings.js';

/**
 * Create an element.
 * @param {string} tag Tag name, optionally with `.class` and `#id` suffixes: 'div.card#main'
 * @param {Record<string, any>|null} [attrs]
 * @param {...(Node|string|number|null|undefined|false|Array)} children
 */
export function h(tag, attrs, ...children) {
    const [name, ...rest] = tag.split(/(?=[.#])/);
    const el = document.createElement(name || 'div');
    for (const part of rest) {
        if (part.startsWith('.')) el.classList.add(part.slice(1));
        else if (part.startsWith('#')) el.id = part.slice(1);
    }
    if (attrs) {
        for (const [key, value] of Object.entries(attrs)) {
            if (value === null || value === undefined || value === false) continue;
            if (key === 'class' || key === 'className') {
                for (const cls of String(value).split(/\s+/).filter(Boolean)) el.classList.add(cls);
            } else if (key === 'style' && typeof value === 'object') {
                Object.assign(el.style, value);
            } else if (key === 'dataset') {
                Object.assign(el.dataset, value);
            } else if (key.startsWith('on') && typeof value === 'function') {
                el.addEventListener(key.slice(2).toLowerCase(), value);
            } else if (key === 'text') {
                el.textContent = String(value);
            } else if (key === 'html') {
                el.innerHTML = String(value); // only used with trusted markup
            } else if (key in el && typeof value !== 'string' && key !== 'list') {
                el[key] = value;
            } else {
                el.setAttribute(key, value === true ? '' : String(value));
            }
        }
    }
    append(el, children);
    return el;
}

export function append(el, children) {
    for (const child of children.flat(Infinity)) {
        if (child === null || child === undefined || child === false || child === '') continue;
        el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
}

export function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
}

export function icon(name, extra = '') {
    const cls = name.startsWith('fa-') ? name : `fa-${name}`;
    return h('i', { class: `fa-solid ${cls} ${extra}`.trim(), 'aria-hidden': 'true' });
}

export function button({ label, icon: iconName, kind = 'ghost', title, onClick, small = false, disabled = false, className = '' }) {
    const el = h('button', {
        type: 'button',
        class: `mp-btn mp-btn-${kind} ${small ? 'mp-btn-sm' : ''} ${className}`,
        title: title ?? label,
        'aria-label': label,
        disabled,
        onClick: onClick ? (ev) => { ev.preventDefault(); ev.stopPropagation(); onClick(ev); } : null,
    }, iconName ? icon(iconName) : null, label ? h('span.mp-btn-label', null, label) : null);
    return el;
}

export function iconButton(opts) {
    return button({ ...opts, label: '', className: `mp-icon-btn ${opts.className ?? ''}`, title: opts.title ?? opts.label });
}

/** Animated toggle switch. */
export function toggle({ checked, label, hint, onChange }) {
    const input = h('input', { type: 'checkbox', checked: !!checked, onChange: () => onChange(input.checked) });
    return h('label.mp-toggle', null,
        h('span.mp-toggle-text', null, h('span.mp-toggle-label', null, label), hint ? h('span.mp-toggle-hint', null, hint) : null),
        h('span.mp-switch', null, input, h('span.mp-switch-track', null, h('span.mp-switch-thumb'))),
    );
}

/** Segmented control with a sliding indicator. */
export function segmented({ options, value, onChange, className = '' }) {
    const indicator = h('span.mp-seg-indicator');
    const root = h('div.mp-seg', { class: className, role: 'tablist' }, indicator);
    const buttons = options.map(opt => {
        const b = h('button.mp-seg-btn', {
            type: 'button',
            role: 'tab',
            dataset: { value: opt.value },
            'aria-selected': opt.value === value ? 'true' : 'false',
            title: opt.title ?? opt.label,
            onClick: () => select(opt.value, true),
        }, opt.icon ? icon(opt.icon) : null, opt.label ? h('span', null, opt.label) : null);
        root.append(b);
        return b;
    });
    function place() {
        const active = buttons.find(b => b.getAttribute('aria-selected') === 'true');
        if (!active) return;
        indicator.style.width = `${active.offsetWidth}px`;
        indicator.style.transform = `translateX(${active.offsetLeft}px)`;
    }
    function select(next, fire) {
        value = next;
        for (const b of buttons) b.setAttribute('aria-selected', b.dataset.value === String(next) ? 'true' : 'false');
        place();
        if (fire) onChange?.(next);
    }
    root.select = (v) => select(v, false);
    root.place = place;
    requestAnimationFrame(place);
    if ('ResizeObserver' in window) new ResizeObserver(place).observe(root);
    return root;
}

export function field({ label, hint, control, inline = false, className = '' }) {
    return h('div.mp-field', { class: `${inline ? 'mp-field-inline' : ''} ${className}` },
        label ? h('div.mp-field-head', null, h('span.mp-field-label', null, label), hint ? h('span.mp-field-hint', null, hint) : null) : null,
        control,
    );
}

export function input({ value = '', placeholder = '', onInput, onChange, type = 'text', className = '', maxLength } = {}) {
    return h('input.mp-input', {
        type, value, placeholder, class: className, maxlength: maxLength,
        onInput: onInput ? (ev) => onInput(ev.target.value, ev) : null,
        onChange: onChange ? (ev) => onChange(ev.target.value, ev) : null,
        autocomplete: 'off', spellcheck: 'true',
    });
}

export function textarea({ value = '', placeholder = '', rows = 6, onInput, onChange, className = '' } = {}) {
    const el = h('textarea.mp-textarea', {
        rows, placeholder, class: className,
        onInput: onInput ? (ev) => onInput(ev.target.value, ev) : null,
        onChange: onChange ? (ev) => onChange(ev.target.value, ev) : null,
    });
    el.value = value;
    return el;
}

export function select({ options, value, onChange, className = '' }) {
    const el = h('select.mp-select', { class: className, onChange: (ev) => onChange?.(ev.target.value) },
        options.map(opt => h('option', { value: String(opt.value), selected: String(opt.value) === String(value) }, opt.label)),
    );
    return el;
}

export function chip({ label, icon: iconName, active = false, onClick, onRemove, title, className = '' }) {
    return h('button.mp-chip', {
        type: 'button', class: `${active ? 'is-active' : ''} ${className}`, title: title ?? label,
        onClick: onClick ? (ev) => { ev.preventDefault(); onClick(ev); } : null,
    },
    iconName ? icon(iconName) : null,
    h('span.mp-chip-label', null, label),
    onRemove ? h('span.mp-chip-x', { role: 'button', 'aria-label': 'Remove', onClick: (ev) => { ev.stopPropagation(); ev.preventDefault(); onRemove(ev); } }, icon('xmark')) : null,
    );
}

export function empty({ icon: iconName = 'face-smile', title, hint, action }) {
    return h('div.mp-empty', null, h('div.mp-empty-icon', null, icon(iconName)), h('div.mp-empty-title', null, title), hint ? h('div.mp-empty-hint', null, hint) : null, action ?? null);
}

export function spinnerDots() {
    return h('span.mp-dots', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
}

export function debounce(fn, ms = 300) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

export function motionEnabled() {
    if (!settings().animations) return false;
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Word-by-word reveal of text into an element. */
export function wordReveal(el, text, { perWord = 28, max = 2600 } = {}) {
    clear(el);
    if (!motionEnabled() || !settings().ai.wordReveal) {
        el.textContent = text;
        return Promise.resolve();
    }
    const paragraphs = String(text).split(/\n/);
    let index = 0;
    for (const [pi, para] of paragraphs.entries()) {
        if (pi > 0) el.append(h('br'));
        const words = para.split(/(\s+)/);
        for (const word of words) {
            if (!word) continue;
            if (/^\s+$/.test(word)) { el.append(document.createTextNode(word)); continue; }
            const span = h('span.mp-word', { style: { animationDelay: `${Math.min(index * perWord, max)}ms` } }, word);
            el.append(span);
            index++;
        }
    }
    const total = Math.min(index * perWord, max) + 400;
    return new Promise(resolve => setTimeout(resolve, total));
}

/** Stagger children entrance animation. */
export function stagger(container, step = 40, max = 480) {
    if (!motionEnabled()) return;
    [...container.children].forEach((child, i) => {
        child.style.setProperty('--mp-delay', `${Math.min(i * step, max)}ms`);
        child.classList.add('mp-rise');
    });
}

/** Pulse a quick success highlight on an element. */
export function flash(el, cls = 'mp-flash') {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

/** Popup helpers restyled to match the panel. */
export async function confirm(title, text, { okLabel = 'Confirm', danger = false } = {}) {
    const c = ctx();
    const popup = new c.Popup(h('div.mp-popup-body', null, h('h3', null, title), text ? h('p', null, text) : null), c.POPUP_TYPE.CONFIRM, '', {
        okButton: okLabel, cancelButton: t`Cancel`,
    });
    popup.dlg?.classList?.add('mp-popup', danger ? 'mp-popup-danger' : 'mp-popup-neutral');
    const result = await popup.show();
    return result === c.POPUP_RESULT.AFFIRMATIVE;
}

export async function promptText(title, { value = '', placeholder = '', rows = 1, okLabel = 'Save' } = {}) {
    const c = ctx();
    const popup = new c.Popup(h('div.mp-popup-body', null, h('h3', null, title)), c.POPUP_TYPE.INPUT, value, {
        okButton: okLabel, cancelButton: t`Cancel`, rows, placeholder,
    });
    popup.dlg?.classList?.add('mp-popup');
    const result = await popup.show();
    if (result === null || result === false || result === undefined) return null;
    return typeof result === 'string' ? result : String(popup.value ?? '');
}

export function toastOk(message, title = '') {
    globalThis.toastr?.success(message, title);
}

export function toastWarn(message, title = '') {
    globalThis.toastr?.warning(message, title);
}

export function toastErr(message, title = '') {
    globalThis.toastr?.error(message, title);
}

/**
 * Full-screen sheet (used by wizards). Returns controls.
 * @param {{ title: string, subtitle?: string, onClose?: () => void, wide?: boolean }} opts
 */
export function openSheet({ title, subtitle, onClose, wide = false }) {
    const body = h('div.mp-sheet-body');
    const footer = h('div.mp-sheet-footer');
    const titleEl = h('div.mp-sheet-title', null, title);
    const subEl = h('div.mp-sheet-subtitle', null, subtitle ?? '');
    const progress = h('div.mp-sheet-progress', null, h('span'));
    const closeBtn = iconButton({ icon: 'xmark', label: t`Close`, onClick: () => close() });
    const panel = h('div.mp-sheet', { class: wide ? 'mp-sheet-wide' : '', role: 'dialog', 'aria-modal': 'true' },
        h('div.mp-sheet-head', null, h('div.mp-sheet-headtext', null, titleEl, subEl), closeBtn),
        progress,
        body,
        footer,
    );
    const backdrop = h('div.mp-sheet-backdrop', { onClick: (ev) => { if (ev.target === backdrop) close(); } }, panel);
    // Clicks inside the sheet must not reach SillyTavern's document handler, which would close the drawer behind it.
    backdrop.addEventListener('click', (ev) => ev.stopPropagation());
    const onKey = (ev) => { if (ev.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    document.body.append(backdrop);
    document.body.classList.add('mp-sheet-open');
    requestAnimationFrame(() => backdrop.classList.add('is-open'));

    let closed = false;
    function close() {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey);
        backdrop.classList.remove('is-open');
        backdrop.classList.add('is-closing');
        document.body.classList.remove('mp-sheet-open');
        setTimeout(() => backdrop.remove(), motionEnabled() ? 320 : 0);
        onClose?.();
    }
    function setProgress(fraction) {
        progress.firstElementChild.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
    }
    function setTitle(next, sub) {
        titleEl.textContent = next;
        if (sub !== undefined) subEl.textContent = sub;
    }
    /** Swap step content with a directional slide. */
    function setStep(node, direction = 1) {
        const old = body.firstElementChild;
        const incoming = h('div.mp-step', { class: motionEnabled() ? (direction >= 0 ? 'mp-step-in-right' : 'mp-step-in-left') : '' }, node);
        // Remove every previous step; the newest one slides out, older leftovers go immediately.
        const previous = [...body.children];
        for (const [i, el] of previous.entries()) {
            const isLast = i === previous.length - 1;
            if (!isLast || !motionEnabled()) { el.remove(); continue; }
            el.classList.add(direction >= 0 ? 'mp-step-out-left' : 'mp-step-out-right');
            const done = () => el.remove();
            el.addEventListener('animationend', (ev) => { if (ev.target === el) done(); });
            setTimeout(done, 400);
        }
        body.append(incoming);
        body.scrollTop = 0;
    }
    function setFooter(...nodes) {
        clear(footer);
        append(footer, nodes);
    }
    return { body, footer, close, setProgress, setTitle, setStep, setFooter, panel, get closed() { return closed; } };
}
