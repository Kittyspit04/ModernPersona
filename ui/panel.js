/**
 * The main Modern Persona panel: gallery + editor with tabs.
 */
import { h, icon, button, iconButton, chip, toggle, segmented, field, input, textarea, select as selectEl, clear, stagger, flash, debounce, confirm, promptText, toastOk, toastWarn, toastErr, empty, motionEnabled, centerInStrip } from './dom.js';
import { aiReview, traitEditor, historyList } from './components.js';
import { openCreateWizard, openInterviewWizard, openRefineWizard, openImportWizard } from './wizards.js';
import * as personas from '../lib/personas.js';
import * as ai from '../lib/ai.js';
import { settings, setSetting, saveSettings, pushHistory, getHistory, TONES, DEFAULT_AI_SYSTEM_PROMPT } from '../lib/settings.js';
import { getTraits, compileTraits, CATEGORIES } from '../lib/traits.js';
import { currentAvatarId, events, powerUser, t, ctx } from '../lib/st.js';

const TABS = [
    { value: 'profile', label: t`Profile`, icon: 'id-card' },
    { value: 'traits', label: t`Traits`, icon: 'tags' },
    { value: 'ai', label: t`AI`, icon: 'wand-magic-sparkles' },
    { value: 'links', label: t`Links`, icon: 'link' },
    { value: 'settings', label: t`Settings`, icon: 'sliders' },
];

export function createPanel(root, { onToggleReplace } = {}) {
    const state = {
        ids: [],
        query: '',
        sort: powerUser().persona_sort_order === 'desc' ? 'desc' : 'asc',
        tab: settings().lastTab || 'profile',
        selectedId: currentAvatarId(),
        suppressRefresh: 0,
        renderedFor: null,
    };

    const gallery = h('div.mp-gallery');
    const editor = h('div.mp-editor');
    const topbar = h('div.mp-topbar');
    const app = h('div.mp-app', null, topbar, h('div.mp-layout', null, gallery, editor));
    root.append(app);

    /* ---------------------------------------------------------------- */
    /* Top bar                                                          */
    /* ---------------------------------------------------------------- */
    function renderTopbar() {
        clear(topbar);
        const search = input({
            value: state.query, placeholder: t`Search personas…`, className: 'mp-search',
            onInput: debounce((v) => { state.query = v; renderGallery(); }, 120),
        });
        const sortBtn = iconButton({
            icon: state.sort === 'asc' ? 'arrow-down-a-z' : 'arrow-up-z-a', label: t`Sort`,
            onClick: () => { state.sort = state.sort === 'asc' ? 'desc' : 'asc'; powerUser().persona_sort_order = state.sort; saveSettings(); renderTopbar(); renderGallery(); },
        });
        const newBtn = button({ label: t`New`, icon: 'plus', kind: 'primary', className: 'mp-new-btn', onClick: (ev) => openNewMenu(ev.currentTarget) });
        topbar.append(
            h('div.mp-brand', null, h('span.mp-brand-icon', null, icon('circle-user')), h('span.mp-brand-text', null, t`Personas`)),
            h('div.mp-topbar-tools', null, h('div.mp-search-wrap', null, icon('magnifying-glass'), search), sortBtn, newBtn),
        );
    }

    function popMenu(anchor, items) {
        document.querySelectorAll('.mp-menu').forEach(m => m.remove());
        const menu = h('div.mp-menu', { role: 'menu' });
        for (const item of items) {
            if (item === '-') { menu.append(h('div.mp-menu-sep')); continue; }
            menu.append(h('button.mp-menu-item', { type: 'button', class: item.danger ? 'is-danger' : '', onClick: () => { menu.remove(); item.onClick(); } },
                icon(item.icon), h('span', null, h('span.mp-menu-label', null, item.label), item.hint ? h('span.mp-menu-hint', null, item.hint) : null)));
        }
        const rect = anchor.getBoundingClientRect();
        document.body.append(menu);
        const width = menu.offsetWidth || 260;
        const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width));
        const top = rect.bottom + 6;
        menu.style.left = `${left}px`;
        menu.style.top = `${Math.min(top, window.innerHeight - menu.offsetHeight - 8)}px`;
        requestAnimationFrame(() => menu.classList.add('is-open'));
        const off = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', off, true); } };
        setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
        menu.addEventListener('click', ev => ev.stopPropagation());
        return menu;
    }

    function openNewMenu(anchor) {
        popMenu(anchor, [
            { icon: 'wand-magic-sparkles', label: t`Guided wizard`, hint: t`Name, avatar, traits, description, placement`, onClick: () => openCreateWizard({ onDone: (id) => { state.selectedId = id; refresh(); } }) },
            { icon: 'comments', label: t`Interview me`, hint: t`Answer questions, the AI writes the profile`, onClick: startInterviewCreate },
            { icon: 'bolt', label: t`Quick create`, hint: t`Just a name, fill the rest later`, onClick: quickCreate },
            { icon: 'file-import', label: t`From character card`, hint: t`Convert a character into a persona`, onClick: () => openImportWizard({ onDone: () => refresh() }) },
            '-',
            { icon: 'file-export', label: t`Backup all personas`, onClick: () => personas.backup() },
            { icon: 'file-arrow-up', label: t`Restore from backup`, onClick: () => personas.restore() },
        ]);
    }

    async function quickCreate() {
        const name = await promptText(t`Name your persona`, { placeholder: t`e.g. Mara Voss`, okLabel: t`Create` });
        if (!name?.trim()) return;
        try {
            const id = await personas.create({ name: name.trim(), avatar: null, select: true });
            state.selectedId = id;
            toastOk(t`${name.trim()} is ready`, t`Persona created`);
            await refresh();
        } catch (err) { toastErr(err?.message ?? String(err)); }
    }

    async function startInterviewCreate() {
        const name = await promptText(t`What is your persona's name?`, { placeholder: t`e.g. Mara Voss`, okLabel: t`Start interview` });
        if (!name?.trim()) return;
        openInterviewWizard({
            name: name.trim(),
            onResult: async (description) => {
                try {
                    const id = await personas.create({ name: name.trim(), description, avatar: null, select: true });
                    pushHistory(id, description, t`Interview`);
                    state.selectedId = id;
                    toastOk(t`${name.trim()} is ready`, t`Persona created`);
                    await refresh();
                } catch (err) { toastErr(err?.message ?? String(err)); }
            },
        });
    }

    /* ---------------------------------------------------------------- */
    /* Gallery                                                          */
    /* ---------------------------------------------------------------- */
    function filteredIds() {
        const q = state.query.trim().toLowerCase();
        const views = state.ids.map(personas.viewOf);
        const list = views.filter(v => !q || v.name.toLowerCase().includes(q) || v.title.toLowerCase().includes(q) || v.description.toLowerCase().includes(q));
        list.sort((a, b) => state.sort === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name));
        // Keep the active persona first on mobile strips for quick access
        return list;
    }

    function renderGallery() {
        clear(gallery);
        const list = filteredIds();
        const count = h('div.mp-gallery-count', null, `${list.length} ${list.length === 1 ? t`persona` : t`personas`}`);
        gallery.append(count);
        if (!list.length) {
            gallery.append(empty({ icon: 'user-plus', title: state.query ? t`No matches` : t`No personas yet`, hint: state.query ? t`Try another search.` : t`Create your first persona with the New button.` }));
            return;
        }
        const scroller = h('div.mp-gallery-list');
        for (const v of list) {
            const card = h('button.mp-card', {
                type: 'button', dataset: { id: v.id }, class: `${v.isCurrent ? 'is-active' : ''} ${v.id === state.selectedId ? 'is-selected' : ''}`,
                title: v.name,
                onClick: async () => {
                    state.selectedId = v.id;
                    highlightCard(v.id);
                    renderEditor();
                    await personas.select(v.id);
                },
            },
            h('span.mp-card-avatar', null, h('img', { src: personas.thumbUrl(v.id), alt: '', loading: 'lazy' }), v.isDefault ? h('span.mp-badge.mp-badge-crown', { title: t`Default persona` }, icon('crown')) : null),
            h('span.mp-card-body', null,
                h('span.mp-card-name', null, v.name),
                h('span.mp-card-sub', null, v.title || (v.description ? v.description.replace(/\s+/g, ' ').slice(0, 70) : t`No description`)),
                h('span.mp-card-flags', null,
                    v.lockedChat ? h('span.mp-flag', { title: t`Locked to this chat` }, icon('lock'), t`Chat`) : null,
                    v.lockedChar ? h('span.mp-flag', { title: t`Linked to this character` }, icon('user'), t`Char`) : null,
                ),
            ),
            );
            scroller.append(card);
        }
        gallery.append(scroller);
        stagger(scroller, 28, 420);
        requestAnimationFrame(() => centerInStrip(scroller, scroller.querySelector('.mp-card.is-selected')));
    }

    function highlightCard(id) {
        gallery.querySelectorAll('.mp-card').forEach(c => c.classList.toggle('is-selected', c.dataset.id === id));
    }

    /* ---------------------------------------------------------------- */
    /* Editor                                                           */
    /* ---------------------------------------------------------------- */
    let tabs;
    let tabPanel;

    function renderEditor() {
        clear(editor);
        const id = state.selectedId;
        if (!id || !state.ids.includes(id)) {
            editor.append(empty({ icon: 'face-smile', title: t`Pick a persona`, hint: t`Select one from the list or create a new one.`, action: button({ label: t`New persona`, icon: 'plus', kind: 'primary', onClick: (ev) => openNewMenu(ev.currentTarget) }) }));
            return;
        }
        const v = personas.viewOf(id);
        editor.append(renderHero(v));
        tabs = segmented({ options: TABS, value: state.tab, className: 'mp-tabs', onChange: (v2) => { state.tab = v2; setSetting('lastTab', v2); renderTab(); } });
        tabPanel = h('div.mp-tabpanel');
        editor.append(tabs, tabPanel);
        renderTab();
        state.renderedFor = id;
    }

    function renderHero(v) {
        const fileInput = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
        fileInput.addEventListener('change', async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            const ok = await personas.uploadAvatar(file, v.id, { crop: true });
            if (ok) { toastOk(t`Avatar updated`); await refresh(true); }
        });
        const avatar = h('button.mp-hero-avatar', { type: 'button', title: t`Change avatar`, onClick: () => fileInput.click() },
            h('img', { src: personas.thumbUrl(v.id, true), alt: '' }),
            h('span.mp-hero-avatar-edit', null, icon('camera')),
        );
        const nameEl = h('input.mp-hero-name', { value: v.name, placeholder: t`Name`, title: t`Tap to rename`, spellcheck: 'false' });
        const commitName = async () => {
            const next = nameEl.value.trim();
            if (!next) { nameEl.value = v.name; return; }
            if (next !== v.name) { await personas.rename(v.id, next); flash(nameEl, 'mp-flash-ok'); await refresh(true); }
        };
        nameEl.addEventListener('change', commitName);
        nameEl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); nameEl.blur(); } });

        const titleEl = h('input.mp-hero-title', { value: v.title, placeholder: t`Add a title…`, title: t`Display-only tagline` });
        titleEl.addEventListener('change', async () => { await personas.setTitle(v.id, titleEl.value); flash(titleEl, 'mp-flash-ok'); renderGallery(); });

        const badges = h('div.mp-hero-badges', null,
            v.isCurrent ? h('span.mp-pill.is-active', null, icon('circle-dot'), t`Active`) : h('button.mp-pill.mp-pill-btn', { type: 'button', onClick: () => personas.select(v.id) }, icon('hand-pointer'), t`Use this persona`),
            v.isDefault ? h('span.mp-pill', null, icon('crown'), t`Default`) : null,
            v.lockedChat ? h('span.mp-pill', null, icon('lock'), t`Chat`) : null,
            v.lockedChar ? h('span.mp-pill', null, icon('user-lock'), t`Character`) : null,
        );

        const moreBtn = iconButton({
            icon: 'ellipsis', label: t`More`, onClick: (ev) => popMenu(ev.currentTarget, [
                { icon: 'clone', label: t`Duplicate`, onClick: async () => { const nid = await personas.duplicate(v.id); if (nid) { state.selectedId = nid; toastOk(t`Duplicated`); await refresh(); } } },
                { icon: 'image', label: t`Change avatar`, onClick: () => fileInput.click() },
                { icon: 'comments', label: t`Interview to rewrite`, hint: t`Answer questions, replace the description`, onClick: () => openInterviewWizard({ avatarId: v.id, name: v.name, onResult: async (text) => { pushHistory(v.id, v.description, t`Before interview`); await personas.setDescription(v.id, text); toastOk(t`Description updated`); await refresh(true); } }) },
                '-',
                { icon: 'trash', label: t`Delete persona`, danger: true, onClick: async () => {
                    const ok = await confirm(t`Delete ${v.name}?`, t`The avatar and all persona data are removed. This cannot be undone.`, { okLabel: t`Delete`, danger: true });
                    if (!ok) return;
                    const done = await personas.remove(v.id);
                    if (done) { toastOk(t`Persona deleted`); state.selectedId = currentAvatarId(); await refresh(); }
                } },
            ]),
        });

        const actions = h('div.mp-hero-actions', null,
            iconButton({ icon: 'crown', label: v.isDefault ? t`Remove default` : t`Make default`, className: v.isDefault ? 'is-on' : '', onClick: async (ev) => { await personas.toggleDefault(v.id); flash(ev.currentTarget, 'mp-flash-pop'); await refresh(true); } }),
            iconButton({ icon: v.lockedChat ? 'lock' : 'lock-open', label: v.lockedChat ? t`Unlock from chat` : t`Lock to this chat`, className: v.lockedChat ? 'is-on' : '', onClick: async (ev) => { if (!v.isCurrent) await personas.select(v.id); await personas.toggleLock('chat'); flash(ev.currentTarget, 'mp-flash-pop'); await refresh(true); } }),
            iconButton({ icon: 'user-lock', label: v.lockedChar ? t`Unlink from character` : t`Link to this character`, className: v.lockedChar ? 'is-on' : '', onClick: async (ev) => { if (!v.isCurrent) await personas.select(v.id); await personas.toggleLock('character'); flash(ev.currentTarget, 'mp-flash-pop'); await refresh(true); } }),
            moreBtn,
        );

        return h('div.mp-hero', { class: v.isCurrent ? 'is-active' : '' },
            h('div.mp-hero-glow'),
            avatar, fileInput,
            h('div.mp-hero-main', null, nameEl, titleEl, badges),
            actions,
        );
    }

    function renderTab() {
        if (!tabPanel) return;
        clear(tabPanel);
        const id = state.selectedId;
        const v = personas.viewOf(id);
        const panel = h('div.mp-tabcontent', { class: motionEnabled() ? 'mp-fade-in' : '' });
        switch (state.tab) {
            case 'traits': panel.append(renderTraitsTab(v)); break;
            case 'ai': panel.append(renderAiTab(v)); break;
            case 'links': panel.append(renderLinksTab(v)); break;
            case 'settings': panel.append(renderSettingsTab()); break;
            default: panel.append(renderProfileTab(v));
        }
        tabPanel.append(panel);
    }

    /* ----------------------------- Profile ----------------------------- */
    function renderProfileTab(v) {
        const tokens = h('span.mp-counter', null, '…');
        const words = h('span.mp-counter');
        const updateCounts = debounce(async (text) => {
            words.textContent = `${text.trim() ? text.trim().split(/\s+/).length : 0} ${t`words`}`;
            tokens.textContent = `${await personas.tokenCount(text)} ${t`tokens`}`;
        }, 250);
        const area = textarea({
            value: v.description, rows: 10, placeholder: t`Describe your persona. Example: [{{user}} is a 28-year-old field medic with a dry wit and a limp from an old injury.]`,
            className: 'mp-description',
            onInput: (text) => { updateCounts(text); saveDescription(text); },
        });
        const saveDescription = debounce(async (text) => { state.suppressRefresh++; await personas.setDescription(v.id, text); setTimeout(() => state.suppressRefresh--, 50); }, 400);
        updateCounts(v.description);

        const reviewWrap = h('div');
        const quickPolish = button({
            label: t`Polish`, icon: 'wand-magic-sparkles', kind: 'accent', small: true, title: t`Fix grammar and sharpen wording, keep every fact`, onClick: () => {
                if (!area.value.trim()) { toastWarn(t`Write a draft first, then polish it.`); flash(area, 'mp-shake'); return; }
                aiReview({ container: reviewWrap, title: t`Polished description`, before: area.value, job: () => ai.enhance({ name: v.name, description: area.value }), onApply: (text) => applyDescription(v, area, text, t`Before polish`, updateCounts), onAppend: (text) => appendDescription(v, area, text, updateCounts) });
            },
        });
        const adjust = button({ label: t`Adjust…`, icon: 'sliders', kind: 'ghost', small: true, onClick: () => openRefineWizard({ avatarId: v.id, name: v.name, description: area.value, traits: getTraits(v.id), onApply: (text) => applyDescription(v, area, text, null, updateCounts) }) });
        const undo = button({
            label: t`History`, icon: 'clock-rotate-left', kind: 'ghost', small: true, onClick: () => {
                const existing = reviewWrap.querySelector('.mp-history-card');
                if (existing) { existing.remove(); return; }
                const card = h('div.mp-ai-card.mp-history-card.is-done', null, h('div.mp-ai-head', null, h('span.mp-ai-title', null, icon('clock-rotate-left'), t`Earlier versions`), iconButton({ icon: 'xmark', label: t`Close`, onClick: () => card.remove() })),
                    historyList({ entries: getHistory(v.id), onRestore: async (entry) => { await applyDescription(v, area, entry.description, t`Before restore`, updateCounts); card.remove(); } }));
                reviewWrap.prepend(card);
            },
        });
        const expandBtn = iconButton({ icon: 'maximize', label: t`Expand editor`, onClick: () => { area.classList.toggle('is-tall'); } });

        const depthWrap = h('div.mp-grid2', { style: { display: v.position === 4 ? '' : 'none' } },
            field({ label: t`Depth`, control: input({ type: 'number', value: String(v.depth), onChange: (val) => personas.setPlacement(v.id, { depth: Number(val) }) }) }),
            field({ label: t`Role`, control: selectEl({ options: personas.ROLE_OPTIONS, value: v.role, onChange: (val) => personas.setPlacement(v.id, { role: Number(val) }) }) }),
        );
        const posSel = selectEl({ options: personas.POSITION_OPTIONS, value: v.position, onChange: async (val) => { await personas.setPlacement(v.id, { position: Number(val) }); depthWrap.style.display = Number(val) === 4 ? '' : 'none'; } });
        const books = personas.lorebookNames();
        const loreSel = selectEl({ options: [{ value: '', label: t`None` }, ...books.map(b => ({ value: b, label: b }))], value: v.lorebook, onChange: (val) => personas.setLorebook(v.id, val) });

        return h('div', null,
            h('div.mp-section', null,
                h('div.mp-section-head', null, h('span.mp-section-title', null, icon('align-left'), t`Description`), h('span.mp-counters', null, words, tokens), expandBtn),
                area,
                h('div.mp-toolbar', null, quickPolish, adjust, undo),
                reviewWrap,
            ),
            h('div.mp-section', null,
                h('div.mp-section-head', null, h('span.mp-section-title', null, icon('location-dot'), t`Prompt placement`)),
                field({ label: t`Position`, hint: t`Where the description is injected`, control: posSel }),
                depthWrap,
                field({ label: t`Lorebook`, hint: t`World info tied to this persona`, control: loreSel }),
            ),
        );
    }

    async function applyDescription(v, area, text, historyLabel, updateCounts) {
        if (historyLabel) pushHistory(v.id, area.value, historyLabel);
        else pushHistory(v.id, area.value, t`Before edit`);
        area.value = text;
        updateCounts?.(text);
        state.suppressRefresh++;
        await personas.setDescription(v.id, text);
        setTimeout(() => state.suppressRefresh--, 50);
        flash(area, 'mp-flash-ok');
        renderGallery();
    }

    async function appendDescription(v, area, text, updateCounts) {
        const next = (area.value.trim() ? area.value.trim() + '\n\n' : '') + text;
        await applyDescription(v, area, next, t`Before append`, updateCounts);
    }

    /* ------------------------------ Traits ----------------------------- */
    function renderTraitsTab(v) {
        const reviewWrap = h('div');
        const editorEl = traitEditor({ avatarId: v.id, onChange: () => { /* persisted */ } });
        const suggest = button({
            label: t`Suggest traits`, icon: 'wand-magic-sparkles', kind: 'accent', small: true, onClick: () => aiReview({
                container: reviewWrap, title: t`Trait ideas`,
                job: async () => { const found = await ai.suggestTraits({ name: v.name, description: v.description, traits: getTraits(v.id) }); if (!found.length) throw new Error(t`No usable suggestions came back. Try again.`); reviewWrap._found = found; return found.map(x => `• ${x.text}  (${CATEGORIES.find(c => c.id === x.category)?.label ?? x.category})`).join('\n'); },
                onApply: () => { const n = editorEl.addMany(reviewWrap._found ?? []); toastOk(t`Added ${n} traits`); },
            }),
        });
        const extract = button({
            label: t`Extract from description`, icon: 'file-import', kind: 'ghost', small: true, title: t`Turn the current description into traits`, onClick: () => {
                if (!v.description.trim()) { toastWarn(t`There is no description to extract from.`); return; }
                aiReview({
                    container: reviewWrap, title: t`Extracted traits`,
                    job: async () => { const found = await ai.extractTraits({ name: v.name, description: v.description }); if (!found.length) throw new Error(t`Nothing could be extracted.`); reviewWrap._found = found; return found.map(x => `• ${x.text}  (${CATEGORIES.find(c => c.id === x.category)?.label ?? x.category})`).join('\n'); },
                    onApply: () => { const n = editorEl.addMany(reviewWrap._found ?? []); toastOk(t`Added ${n} traits`); },
                });
            },
        });
        const compile = button({
            label: t`Write into description`, icon: 'arrow-right-to-bracket', kind: 'ghost', small: true, onClick: (ev) => popMenu(ev.currentTarget, [
                { icon: 'list', label: t`Compact list (no AI)`, hint: t`Replaces the description`, onClick: async () => { const traits = getTraits(v.id); if (!traits.length) { toastWarn(t`Add traits first`); return; } pushHistory(v.id, v.description, t`Before compile`); await personas.setDescription(v.id, compileTraits(v.name, traits, { title: v.title })); toastOk(t`Description replaced`); await refresh(true); } },
                { icon: 'plus', label: t`Append compact list`, onClick: async () => { const traits = getTraits(v.id); if (!traits.length) { toastWarn(t`Add traits first`); return; } pushHistory(v.id, v.description, t`Before append`); await personas.setDescription(v.id, (v.description.trim() ? v.description.trim() + '\n\n' : '') + compileTraits(v.name, traits, { title: v.title })); toastOk(t`Traits appended`); await refresh(true); } },
                { icon: 'wand-magic-sparkles', label: t`Prose with AI`, hint: t`Generates a fresh description from traits`, onClick: () => aiReview({ container: reviewWrap, title: t`Description from traits`, before: v.description, job: () => ai.fromTraits({ name: v.name, title: v.title, traits: getTraits(v.id), style: 'prose', length: 'medium' }), onApply: async (text) => { pushHistory(v.id, v.description, t`Before generate`); await personas.setDescription(v.id, text); toastOk(t`Description replaced`); await refresh(true); }, onAppend: async (text) => { pushHistory(v.id, v.description, t`Before append`); await personas.setDescription(v.id, (v.description.trim() ? v.description.trim() + '\n\n' : '') + text); await refresh(true); } }) },
            ]),
        });
        return h('div', null,
            h('div.mp-section', null,
                h('div.mp-section-head', null, h('span.mp-section-title', null, icon('tags'), t`Traits`)),
                h('p.mp-lead', null, t`Small facts, grouped by category. Tap a trait to edit it, long-press or right-click to move it. Traits are saved per persona and feed the AI tools.`),
                editorEl,
                h('div.mp-toolbar', null, suggest, extract, compile),
                reviewWrap,
            ),
        );
    }

    /* -------------------------------- AI ------------------------------- */
    function renderAiTab(v) {
        const reviewWrap = h('div');
        const busyHint = h('div.mp-ai-hint', null, icon('plug'), h('span', null, t`Uses the API and model you are currently connected to.`));
        const apply = async (text, label) => { pushHistory(v.id, v.description, label); await personas.setDescription(v.id, text); toastOk(t`Description updated`); await refresh(true); };
        const appendFn = async (text) => { pushHistory(v.id, v.description, t`Before append`); await personas.setDescription(v.id, (v.description.trim() ? v.description.trim() + '\n\n' : '') + text); await refresh(true); };
        const needDesc = () => { if (!v.description.trim()) { toastWarn(t`This persona has no description yet. Generate one first.`); return false; } return true; };
        const tools = [
            { icon: 'wand-magic-sparkles', label: t`Polish`, hint: t`Grammar, clarity, same facts`, run: () => needDesc() && aiReview({ container: reviewWrap, title: t`Polished`, before: v.description, job: () => ai.enhance({ name: v.name, description: v.description }), onApply: (x) => apply(x, t`Before polish`) }) },
            { icon: 'maximize', label: t`Add detail`, hint: t`Richer, roughly 2× longer`, run: () => needDesc() && aiReview({ container: reviewWrap, title: t`Expanded`, before: v.description, job: () => ai.expand({ name: v.name, description: v.description, traits: getTraits(v.id) }), onApply: (x) => apply(x, t`Before expand`) }) },
            { icon: 'minimize', label: t`Shorten`, hint: t`Fewer tokens, same facts`, run: () => needDesc() && aiReview({ container: reviewWrap, title: t`Condensed`, before: v.description, job: () => ai.condense({ name: v.name, description: v.description }), onApply: (x) => apply(x, t`Before condense`) }) },
            { icon: 'feather-pointed', label: t`Generate`, hint: t`New description from traits`, run: () => aiReview({ container: reviewWrap, title: t`Generated`, before: v.description, job: () => ai.fromTraits({ name: v.name, title: v.title, traits: getTraits(v.id) }), onApply: (x) => apply(x, t`Before generate`), onAppend: appendFn }) },
            { icon: 'comments', label: t`Interview`, hint: t`Answer questions, get a profile`, run: () => openInterviewWizard({ avatarId: v.id, name: v.name, onResult: (x) => apply(x, t`Before interview`) }) },
            { icon: 'sliders', label: t`Adjust…`, hint: t`Tone, point of view, custom`, run: () => openRefineWizard({ avatarId: v.id, name: v.name, description: v.description, traits: getTraits(v.id), onApply: (x) => apply(x, null) }) },
            { icon: 'heading', label: t`Suggest title`, hint: t`A short tagline`, run: () => aiReview({ container: reviewWrap, title: t`Title idea`, job: () => ai.suggestTitle({ name: v.name, description: v.description, traits: getTraits(v.id) }), onApply: async (x) => { await personas.setTitle(v.id, x.replace(/^["']|["']$/g, '')); toastOk(t`Title set`); await refresh(true); } }) },
        ];
        const grid = h('div.mp-tool-grid');
        for (const tool of tools) {
            grid.append(h('button.mp-tool', { type: 'button', onClick: tool.run }, h('span.mp-tool-icon', null, icon(tool.icon)), h('span.mp-tool-label', null, tool.label), h('span.mp-tool-hint', null, tool.hint)));
        }
        requestAnimationFrame(() => stagger(grid, 30, 300));

        const toneRow = h('div.mp-tone-row');
        for (const tone of TONES) {
            toneRow.append(chip({ label: tone.label, title: tone.hint, onClick: () => needDesc() && aiReview({ container: reviewWrap, title: `${tone.label} ${t`rewrite`}`, before: v.description, job: () => ai.retone({ name: v.name, description: v.description, tone: tone.id }), onApply: (x) => apply(x, t`Before tone change`) }) }));
        }
        const customInput = textarea({ rows: 2, placeholder: t`e.g. Give him a younger sister he looks after, and make him sound more tired.` });
        const customBtn = button({ label: t`Apply instruction`, icon: 'wand-magic-sparkles', kind: 'accent', small: true, onClick: () => { const instruction = customInput.value.trim(); if (!instruction) { flash(customInput, 'mp-shake'); return; } if (!needDesc()) return; aiReview({ container: reviewWrap, title: t`Custom edit`, before: v.description, job: () => ai.custom({ name: v.name, description: v.description, instruction, traits: getTraits(v.id) }), onApply: (x) => apply(x, t`Before custom edit`) }); } });

        return h('div', null,
            h('div.mp-section', null,
                h('div.mp-section-head', null, h('span.mp-section-title', null, icon('wand-magic-sparkles'), t`AI Studio`)),
                busyHint, grid,
            ),
            h('div.mp-section', null,
                h('div.mp-section-head', null, h('span.mp-section-title', null, icon('palette'), t`Change the tone`)),
                toneRow,
            ),
            h('div.mp-section', null,
                h('div.mp-section-head', null, h('span.mp-section-title', null, icon('pen-to-square'), t`Custom instruction`)),
                customInput, h('div.mp-toolbar', null, customBtn),
            ),
            reviewWrap,
        );
    }

    /* ------------------------------- Links ----------------------------- */
    function renderLinksTab(v) {
        const pu = powerUser();
        const c = ctx();
        const connList = h('div.mp-conn-list');
        if (!v.connections.length) connList.append(h('div.mp-muted', null, t`Not linked to any character yet. Open a chat and tap “Link to this character”.`));
        for (const conn of v.connections) {
            let name = conn.id, thumb = '';
            if (conn.type === 'character') {
                const ch = c.characters?.find(x => x.avatar === conn.id);
                if (ch) { name = ch.name; thumb = c.getThumbnailUrl('avatar', ch.avatar); }
            } else if (conn.type === 'group') {
                const g = c.groups?.find(x => x.id === conn.id);
                if (g) name = g.name;
            }
            connList.append(h('div.mp-conn', null,
                thumb ? h('img', { src: thumb, alt: '' }) : h('span.mp-conn-icon', null, icon(conn.type === 'group' ? 'users' : 'user')),
                h('span.mp-conn-name', null, name),
                iconButton({ icon: 'link-slash', label: t`Unlink`, onClick: async () => {
                    const d = pu.persona_descriptions[v.id];
                    d.connections = (d.connections ?? []).filter(x => !(x.type === conn.type && x.id === conn.id));
                    saveSettings();
                    await personas.refreshNative(v.id);
                    await refresh(true);
                } }),
            ));
        }
        stagger(connList, 40);
        const nativeToggle = (id, key) => toggle({
            label: { persona_show_notifications: t`Show notifications when switching personas`, persona_allow_multi_connections: t`Allow several personas per character`, persona_auto_lock: t`Auto-lock the chosen persona to the chat` }[key],
            hint: { persona_show_notifications: '', persona_allow_multi_connections: t`A picker appears when more than one matches`, persona_auto_lock: t`Selecting a persona locks it to the open chat` }[key],
            checked: !!pu[key],
            onChange: (val) => { pu[key] = val; const el = document.getElementById(id); if (el instanceof HTMLInputElement) el.checked = val; saveSettings(); },
        });
        return h('div', null,
            h('div.mp-section', null,
                h('div.mp-section-head', null, h('span.mp-section-title', null, icon('link'), t`Where this persona is used`)),
                h('div.mp-link-grid', null,
                    linkCard({ icon: 'crown', title: t`Default`, hint: t`New and unlocked chats`, on: v.isDefault, onClick: async () => { await personas.toggleDefault(v.id); await refresh(true); } }),
                    linkCard({ icon: 'comments', title: t`This chat`, hint: v.lockedChat ? t`Locked` : t`Not locked`, on: v.lockedChat, onClick: async () => { if (!v.isCurrent) await personas.select(v.id); await personas.toggleLock('chat'); await refresh(true); } }),
                    linkCard({ icon: 'user', title: t`This character`, hint: v.lockedChar ? t`Linked` : t`Not linked`, on: v.lockedChar, onClick: async () => { if (!v.isCurrent) await personas.select(v.id); await personas.toggleLock('character'); await refresh(true); } }),
                ),
            ),
            h('div.mp-section', null,
                h('div.mp-section-head', null, h('span.mp-section-title', null, icon('people-arrows'), t`Linked characters`)),
                connList,
            ),
            h('div.mp-section', null,
                h('div.mp-section-head', null, h('span.mp-section-title', null, icon('gear'), t`Behaviour`)),
                h('div.mp-toggle-stack', null,
                    nativeToggle('persona_show_notifications', 'persona_show_notifications'),
                    nativeToggle('persona_allow_multi_connections', 'persona_allow_multi_connections'),
                    nativeToggle('persona_auto_lock', 'persona_auto_lock'),
                ),
            ),
        );
    }

    function linkCard({ icon: iconName, title, hint, on, onClick }) {
        return h('button.mp-linkcard', { type: 'button', class: on ? 'is-on' : '', onClick }, h('span.mp-linkcard-icon', null, icon(iconName)), h('span.mp-linkcard-title', null, title), h('span.mp-linkcard-hint', null, hint), h('span.mp-linkcard-check', null, icon('check')));
    }

    /* ------------------------------ Settings --------------------------- */
    function renderSettingsTab() {
        const s = settings();
        const sys = textarea({ value: s.ai.systemPrompt, rows: 6, onChange: (val) => setSetting('ai.systemPrompt', val || DEFAULT_AI_SYSTEM_PROMPT) });
        const iconOptions = ['fa-circle-user', 'fa-user-astronaut', 'fa-id-badge', 'fa-face-smile', 'fa-masks-theater', 'fa-user-pen', 'fa-star'];
        const iconRow = h('div.mp-icon-row');
        for (const name of iconOptions) {
            iconRow.append(h('button.mp-icon-choice', { type: 'button', class: s.icon === name ? 'is-active' : '', title: name, onClick: () => { setSetting('icon', name); applyIcon(name); renderTab(); } }, icon(name)));
        }
        return h('div', null,
            h('div.mp-section', null,
                h('div.mp-section-head', null, h('span.mp-section-title', null, icon('sliders'), t`Appearance`)),
                h('div.mp-toggle-stack', null,
                    toggle({ label: t`Replace the built-in persona panel`, hint: t`Hides the stock top-bar button and uses this one`, checked: s.replaceNative, onChange: (val) => { setSetting('replaceNative', val); onToggleReplace?.(val); } }),
                    toggle({ label: t`Animations`, hint: t`Springy transitions and reveals`, checked: s.animations, onChange: (val) => { setSetting('animations', val); document.body.classList.toggle('mp-no-motion', !val); } }),
                    toggle({ label: t`Word-by-word reveal for AI results`, checked: s.ai.wordReveal, onChange: (val) => setSetting('ai.wordReveal', val) }),
                ),
                field({ label: t`Top bar icon`, control: iconRow }),
            ),
            h('div.mp-section', null,
                h('div.mp-section-head', null, h('span.mp-section-title', null, icon('robot'), t`AI`)),
                h('div.mp-toggle-stack', null,
                    toggle({ label: t`Give the AI the current character for context`, hint: t`Name and a short excerpt of the open character card`, checked: s.ai.includeCharacter, onChange: (val) => setSetting('ai.includeCharacter', val) }),
                ),
                h('div.mp-grid2', null,
                    field({ label: t`Max response tokens`, control: input({ type: 'number', value: String(s.ai.responseLength), onChange: (val) => setSetting('ai.responseLength', Math.max(100, Number(val) || 450)) }) }),
                    field({ label: t`Output language`, hint: t`Blank = same as the source`, control: input({ value: s.ai.language, placeholder: t`e.g. German`, onChange: (val) => setSetting('ai.language', val.trim()) }) }),
                ),
                field({ label: t`System prompt`, hint: t`Sent with every AI tool`, control: sys }),
                h('div.mp-toolbar', null, button({ label: t`Reset prompt`, icon: 'rotate-left', kind: 'ghost', small: true, onClick: () => { sys.value = DEFAULT_AI_SYSTEM_PROMPT; setSetting('ai.systemPrompt', DEFAULT_AI_SYSTEM_PROMPT); flash(sys, 'mp-flash-ok'); } })),
            ),
            h('div.mp-section', null,
                h('div.mp-section-head', null, h('span.mp-section-title', null, icon('box-archive'), t`Data`)),
                h('div.mp-toolbar', null,
                    button({ label: t`Backup personas`, icon: 'file-export', kind: 'ghost', small: true, onClick: () => personas.backup() }),
                    button({ label: t`Restore`, icon: 'file-import', kind: 'ghost', small: true, onClick: () => personas.restore() }),
                ),
                h('p.mp-muted', null, t`Traits and version history live in your SillyTavern settings and travel with your user account.`),
            ),
            h('div.mp-about', null, icon('circle-user'), h('span', null, 'Modern Persona'), h('a', { href: 'https://github.com/Kittyspit04/ModernPersona', target: '_blank', rel: 'noopener' }, 'GitHub')),
        );
    }

    function applyIcon(name) {
        const el = document.querySelector('#modern-persona-button .drawer-icon');
        if (!el) return;
        [...el.classList].filter(c => c.startsWith('fa-') && !['fa-solid', 'fa-fw'].includes(c)).forEach(c => el.classList.remove(c));
        el.classList.add(name);
    }

    /* ---------------------------------------------------------------- */
    /* Refresh + events                                                 */
    /* ---------------------------------------------------------------- */
    let refreshing = null;
    async function refresh(keepTab = false) {
        if (refreshing) return refreshing;
        refreshing = (async () => {
            try {
                state.ids = await personas.listPersonaIds();
                if (!state.selectedId || !state.ids.includes(state.selectedId)) state.selectedId = currentAvatarId() || state.ids[0] || null;
                renderGallery();
                if (!keepTab) state.tab = state.tab || 'profile';
                renderEditor();
            } finally {
                refreshing = null;
            }
        })();
        return refreshing;
    }

    const softRefresh = debounce(() => { if (state.suppressRefresh > 0) return; refresh(true); }, 150);

    function bindEvents() {
        const { source, types } = events();
        const follow = () => { state.selectedId = currentAvatarId(); softRefresh(); };
        source.on(types.PERSONA_CHANGED, follow);
        source.on(types.CHAT_CHANGED, follow);
        source.on(types.PERSONA_CREATED, softRefresh);
        source.on(types.PERSONA_RENAMED, softRefresh);
        source.on(types.PERSONA_DELETED, () => { state.selectedId = currentAvatarId(); softRefresh(); });
        source.on(types.PERSONA_UPDATED, () => { if (state.suppressRefresh > 0) return; softRefresh(); });
        if (types.WORLDINFO_UPDATED) source.on(types.WORLDINFO_UPDATED, softRefresh);
    }

    renderTopbar();
    bindEvents();

    return {
        refresh,
        open: () => { state.selectedId = currentAvatarId(); return refresh(true); },
        setTab: (tab) => { state.tab = tab; renderTab(); tabs?.select(tab); },
        applyIcon,
        openCreate: () => openCreateWizard({ onDone: (id) => { state.selectedId = id; refresh(); } }),
    };
}
