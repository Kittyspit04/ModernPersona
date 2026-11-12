/**
 * Multi-step wizards: Create, Interview, Refine, Import from character.
 */
import { h, icon, button, chip, field, input, textarea, select as selectEl, toggle, segmented, openSheet, clear, stagger, motionEnabled, toastOk, toastWarn, toastErr, flash, spinnerDots, wordReveal } from './dom.js';
import { traitEditor, avatarPicker, aiReview } from './components.js';
import * as personas from '../lib/personas.js';
import * as ai from '../lib/ai.js';
import { TONES, pushHistory } from '../lib/settings.js';
import { compileTraits, setTraits, getTraits } from '../lib/traits.js';
import { t } from '../lib/st.js';

const STYLE_OPTIONS = [
    { value: 'prose', label: t`Prose`, icon: 'align-left' },
    { value: 'list', label: t`Compact list`, icon: 'list' },
    { value: 'mixed', label: t`Mixed`, icon: 'table-columns' },
];
const LENGTH_OPTIONS = [
    { value: 'short', label: t`Short` },
    { value: 'medium', label: t`Medium` },
    { value: 'long', label: t`Long` },
];

function stepDots(count, active) {
    return h('div.mp-step-dots', null, Array.from({ length: count }, (_, i) => h('span', { class: i === active ? 'is-active' : i < active ? 'is-done' : '' })));
}

/* ------------------------------------------------------------------ */
/* Create wizard                                                       */
/* ------------------------------------------------------------------ */

/**
 * @param {{ onDone?: (avatarId: string) => void }} [opts]
 */
export function openCreateWizard({ onDone } = {}) {
    const state = {
        name: '', title: '', avatar: null, traits: [], description: '', notes: '',
        style: 'prose', length: 'medium',
        position: 0, depth: 2, role: 0, lorebook: '',
        makeDefault: false, lockChat: false,
    };
    const steps = [basicsStep, traitsStep, descriptionStep, placementStep, reviewStep];
    const titles = [t`Who are you?`, t`Traits`, t`Description`, t`Placement`, t`Review`];
    let index = 0;
    let dir = 1;
    const sheet = openSheet({ title: t`New persona`, subtitle: titles[0], wide: true });

    function go(next) {
        dir = next > index ? 1 : -1;
        index = Math.max(0, Math.min(steps.length - 1, next));
        render();
    }
    function render() {
        sheet.setTitle(t`New persona`, titles[index]);
        sheet.setProgress((index + 1) / steps.length);
        const content = steps[index]();
        sheet.setStep(h('div', null, stepDots(steps.length, index), content), dir);
        const back = button({ label: t`Back`, icon: 'arrow-left', kind: 'ghost', onClick: () => go(index - 1), disabled: index === 0 });
        const isLast = index === steps.length - 1;
        const next = button({
            label: isLast ? t`Create persona` : t`Continue`, icon: isLast ? 'check' : 'arrow-right', kind: 'primary', className: isLast ? 'mp-btn-glow' : '',
            onClick: async () => {
                if (index === 0 && !state.name.trim()) { toastWarn(t`Give your persona a name first`); flash(sheet.panel.querySelector('.mp-input'), 'mp-shake'); return; }
                if (isLast) await finish(next);
                else go(index + 1);
            },
        });
        sheet.setFooter(back, h('span.mp-flex1'), next);
    }

    async function finish(btn) {
        btn.disabled = true;
        btn.classList.add('is-loading');
        try {
            const id = await personas.create({
                name: state.name, title: state.title, description: state.description,
                position: state.position, depth: state.depth, role: state.role, lorebook: state.lorebook,
                avatar: state.avatar, crop: true, select: true, makeDefault: state.makeDefault, lockChat: state.lockChat,
            });
            if (state.traits.length) setTraits(id, state.traits.map(x => ({ ...x })));
            if (state.description) pushHistory(id, state.description, t`Created`);
            toastOk(t`${state.name} is ready`, t`Persona created`);
            sheet.close();
            onDone?.(id);
        } catch (err) {
            console.error(err);
            toastErr(err?.message ?? String(err));
            btn.disabled = false;
            btn.classList.remove('is-loading');
        }
    }

    function basicsStep() {
        const picker = avatarPicker({ previewUrl: state.avatar ? URL.createObjectURL(state.avatar) : '', onPick: (file) => { state.avatar = file; } });
        const nameInput = input({ value: state.name, placeholder: t`Name, e.g. Mara Voss`, onInput: (v) => { state.name = v; } });
        const titleInput = input({ value: state.title, placeholder: t`Optional tagline, e.g. Wandering cartographer`, onInput: (v) => { state.title = v; } });
        setTimeout(() => nameInput.focus(), motionEnabled() ? 350 : 0);
        return h('div.mp-wiz-basics', null,
            h('div.mp-wiz-hero', null, picker),
            field({ label: t`Name`, hint: t`Shown as your name in chat`, control: nameInput }),
            field({ label: t`Title`, hint: t`Display only, never sent to the model`, control: titleInput }),
            h('div.mp-hint-card', null, icon('lightbulb'), h('span', null, t`You can skip everything except the name. Traits and the description can be added later, with or without AI help.`)),
        );
    }

    function traitsStep() {
        const editor = traitEditor({ avatarId: null, draft: state.traits });
        const suggestWrap = h('div');
        const suggestBtn = button({
            label: t`Suggest traits with AI`, icon: 'wand-magic-sparkles', kind: 'accent', onClick: () => {
                aiReview({
                    container: suggestWrap, title: t`Trait ideas`, allowRetry: true,
                    job: async () => {
                        const found = await ai.suggestTraits({ name: state.name, description: state.description, traits: state.traits, count: 8 });
                        if (!found.length) throw new Error(t`No usable suggestions came back. Try again.`);
                        suggestWrap._found = found;
                        return found.map(x => `• ${x.text}  (${x.category})`).join('\n');
                    },
                    onApply: () => { const n = editor.addMany(suggestWrap._found ?? []); toastOk(t`Added ${n} traits`); },
                });
            },
        });
        return h('div', null,
            h('p.mp-lead', null, t`Pick a category, type a trait and press Enter. Traits power the AI tools and can be compiled into a description.`),
            editor,
            h('div.mp-row-end', null, suggestBtn),
            suggestWrap,
        );
    }

    function descriptionStep() {
        const area = textarea({ value: state.description, rows: 9, placeholder: t`Describe your persona, or generate a draft below…`, onInput: (v) => { state.description = v; updateCount(); } });
        const count = h('span.mp-counter');
        function updateCount() { count.textContent = `${state.description.trim() ? state.description.trim().split(/\s+/).length : 0} ${t`words`}`; }
        updateCount();
        const notes = textarea({ value: state.notes, rows: 2, placeholder: t`Anything the AI should know (setting, vibe, things to avoid)…`, onInput: (v) => { state.notes = v; } });
        const styleSeg = segmented({ options: STYLE_OPTIONS, value: state.style, onChange: (v) => { state.style = v; } });
        const lengthSeg = segmented({ options: LENGTH_OPTIONS, value: state.length, onChange: (v) => { state.length = v; } });
        const reviewWrap = h('div');
        const genBtn = button({
            label: t`Generate with AI`, icon: 'wand-magic-sparkles', kind: 'accent', className: 'mp-btn-glow', onClick: () => {
                aiReview({
                    container: reviewWrap, title: t`Draft description`, before: state.description,
                    job: () => ai.fromTraits({ name: state.name, title: state.title, traits: state.traits, notes: state.notes, style: state.style, length: state.length }),
                    onApply: (text) => { state.description = text; area.value = text; updateCount(); flash(area, 'mp-flash-ok'); },
                    onAppend: (text) => { state.description = (state.description.trim() ? state.description.trim() + '\n\n' : '') + text; area.value = state.description; updateCount(); },
                });
            },
        });
        const compileBtn = button({
            label: t`Compile from traits`, icon: 'list-check', kind: 'ghost', title: t`Builds a compact list from your traits, no AI`, onClick: () => {
                if (!state.traits.length) { toastWarn(t`Add some traits first`); return; }
                state.description = compileTraits(state.name, state.traits, { title: state.title });
                area.value = state.description;
                updateCount();
                flash(area, 'mp-flash-ok');
            },
        });
        return h('div', null,
            field({ label: t`Description`, hint: count, control: area }),
            h('div.mp-ai-panel', null,
                h('div.mp-ai-panel-head', null, icon('wand-sparkles'), h('span', null, t`AI draft`)),
                h('div.mp-grid2', null, field({ label: t`Style`, control: styleSeg }), field({ label: t`Length`, control: lengthSeg })),
                field({ label: t`Notes for the AI`, control: notes }),
                h('div.mp-row-end', null, compileBtn, genBtn),
            ),
            reviewWrap,
        );
    }

    function placementStep() {
        const depthWrap = h('div.mp-grid2', { style: { display: state.position === 4 ? '' : 'none' } },
            field({ label: t`Depth`, control: input({ type: 'number', value: String(state.depth), onInput: (v) => { state.depth = Number(v) || 0; } }) }),
            field({ label: t`Role`, control: selectEl({ options: personas.ROLE_OPTIONS, value: state.role, onChange: (v) => { state.role = Number(v); } }) }),
        );
        const posSel = selectEl({ options: personas.POSITION_OPTIONS, value: state.position, onChange: (v) => { state.position = Number(v); depthWrap.style.display = state.position === 4 ? '' : 'none'; } });
        const books = personas.lorebookNames();
        const loreSel = selectEl({ options: [{ value: '', label: t`None` }, ...books.map(b => ({ value: b, label: b }))], value: state.lorebook, onChange: (v) => { state.lorebook = v; } });
        return h('div', null,
            h('p.mp-lead', null, t`Where should the description go in the prompt, and what should happen when the persona is created?`),
            field({ label: t`Position`, control: posSel }),
            depthWrap,
            field({ label: t`Lorebook`, hint: t`Optional world info attached to this persona`, control: loreSel }),
            h('div.mp-toggle-stack', null,
                toggle({ label: t`Make this my default persona`, hint: t`Used for new chats and unlocked chats`, checked: state.makeDefault, onChange: (v) => { state.makeDefault = v; } }),
                toggle({ label: t`Lock to the current chat`, hint: t`Only applies if a chat is open`, checked: state.lockChat, onChange: (v) => { state.lockChat = v; } }),
            ),
        );
    }

    function reviewStep() {
        const preview = h('div.mp-review-card', null,
            h('div.mp-review-top', null,
                h('img.mp-review-avatar', { src: state.avatar ? URL.createObjectURL(state.avatar) : 'img/user-default.png', alt: '' }),
                h('div', null, h('div.mp-review-name', null, state.name || '—'), state.title ? h('div.mp-review-title', null, state.title) : null),
            ),
            state.traits.length ? h('div.mp-review-chips', null, state.traits.slice(0, 12).map(x => chip({ label: x.text, className: 'mp-chip-static' })), state.traits.length > 12 ? h('span.mp-muted', null, `+${state.traits.length - 12}`) : null) : null,
            h('div.mp-review-desc', null, state.description || h('span.mp-muted', null, t`No description yet. You can add one later.`)),
            h('div.mp-review-meta', null,
                h('span', null, icon('location-dot'), personas.POSITION_OPTIONS.find(x => x.value === state.position)?.label),
                state.lorebook ? h('span', null, icon('book'), state.lorebook) : null,
                state.makeDefault ? h('span', null, icon('crown'), t`Default`) : null,
                state.lockChat ? h('span', null, icon('lock'), t`Chat lock`) : null,
            ),
        );
        requestAnimationFrame(() => { const chips = preview.querySelector('.mp-review-chips'); if (chips) stagger(chips, 25, 300); });
        return h('div', null, h('p.mp-lead', null, t`Looks good? The avatar crop dialog opens after you confirm.`), preview);
    }

    render();
    return sheet;
}

/* ------------------------------------------------------------------ */
/* Interview wizard                                                    */
/* ------------------------------------------------------------------ */

const INTERVIEW_QUESTIONS = [
    { key: 'look', question: t`What do people notice first when they see you?` , placeholder: t`Height, hair, eyes, clothes, a scar…` },
    { key: 'identity', question: t`Who are you in this world? Age, job, where you come from.`, placeholder: t`A 24-year-old courier from the lower city…` },
    { key: 'personality', question: t`Describe your temperament in a few words, including one flaw.`, placeholder: t`Dry humour, loyal, terrible at asking for help…` },
    { key: 'voice', question: t`How do you talk? Accent, habits, favourite phrases.`, placeholder: t`Quiet, clipped sentences, swears when nervous…` },
    { key: 'past', question: t`What happened in your past that still shapes you?`, placeholder: t`Left home at sixteen after…` },
    { key: 'want', question: t`What do you want most right now, and what are you afraid of?`, placeholder: t`To find my brother; being forgotten…` },
    { key: 'quirk', question: t`One quirk or habit that makes you unmistakably you.`, placeholder: t`Taps a coin on the table when thinking…` },
];

/**
 * @param {{ avatarId?: string|null, name?: string, onResult: (description: string) => Promise<void>|void }} opts
 */
export function openInterviewWizard({ avatarId = null, name = '', onResult }) {
    const answers = INTERVIEW_QUESTIONS.map(q => ({ ...q, answer: '' }));
    const extra = [];
    let index = 0;
    let dir = 1;
    let style = 'prose';
    let length = 'medium';
    const sheet = openSheet({ title: t`Interview`, subtitle: t`Answer in your own words. Skip anything you like.` });
    const total = () => answers.length + extra.length + 1;

    function all() { return [...answers, ...extra]; }
    function render() {
        const list = all();
        sheet.setProgress((index + 1) / total());
        if (index < list.length) {
            const q = list[index];
            const area = textarea({ value: q.answer, rows: 4, placeholder: q.placeholder ?? '', onInput: (v) => { q.answer = v; } });
            setTimeout(() => area.focus(), motionEnabled() ? 350 : 0);
            sheet.setTitle(t`Interview`, `${t`Question`} ${index + 1} / ${list.length}`);
            sheet.setStep(h('div.mp-interview', null,
                h('div.mp-interview-q', null, h('span.mp-interview-num', null, String(index + 1)), h('span', null, q.question)),
                area,
            ), dir);
            const back = button({ label: t`Back`, icon: 'arrow-left', kind: 'ghost', disabled: index === 0, onClick: () => { dir = -1; index--; render(); } });
            const skip = button({ label: t`Skip`, icon: 'forward', kind: 'ghost', onClick: () => { dir = 1; index++; render(); } });
            const next = button({ label: index === list.length - 1 ? t`Finish` : t`Next`, icon: 'arrow-right', kind: 'primary', onClick: () => { dir = 1; index++; render(); } });
            const more = (index === list.length - 1 && extra.length < 6) ? button({
                label: t`Ask me more`, icon: 'comments', kind: 'accent', title: t`The AI asks follow-up questions based on your answers`, onClick: async (ev) => {
                    const btn = ev.currentTarget;
                    btn.disabled = true; btn.classList.add('is-loading');
                    try {
                        const qs = await ai.followUpQuestions({ name, answers: all(), count: 3 });
                        if (!qs.length) { toastWarn(t`No follow-up questions came back`); return; }
                        for (const q of qs) extra.push({ key: `extra-${extra.length}`, question: q, answer: '' });
                        dir = 1; index++; render();
                    } catch (err) { toastErr(err?.message ?? String(err)); }
                    finally { btn.disabled = false; btn.classList.remove('is-loading'); }
                },
            }) : null;
            sheet.setFooter(back, skip, h('span.mp-flex1'), more, next);
        } else {
            sheet.setTitle(t`Interview`, t`Compose the description`);
            const reviewWrap = h('div');
            const answered = list.filter(a => a.answer.trim()).length;
            const styleSeg = segmented({ options: STYLE_OPTIONS.filter(x => x.value !== 'mixed'), value: style, onChange: (v) => { style = v; } });
            const lengthSeg = segmented({ options: LENGTH_OPTIONS, value: length, onChange: (v) => { length = v; } });
            const gen = () => aiReview({
                container: reviewWrap, title: t`Your persona`,
                job: () => ai.fromInterview({ name, answers: list, style, length }),
                onApply: async (text) => { await onResult(text); sheet.close(); },
            });
            sheet.setStep(h('div', null,
                h('p.mp-lead', null, `${answered} ${t`of`} ${list.length} ${t`questions answered.`} ${t`Pick a style and let the AI write the description.`}`),
                h('div.mp-grid2', null, field({ label: t`Style`, control: styleSeg }), field({ label: t`Length`, control: lengthSeg })),
                h('div.mp-row-end', null, button({ label: t`Write it`, icon: 'wand-magic-sparkles', kind: 'accent', className: 'mp-btn-glow', onClick: gen })),
                reviewWrap,
            ), dir);
            sheet.setFooter(button({ label: t`Back`, icon: 'arrow-left', kind: 'ghost', onClick: () => { dir = -1; index--; render(); } }), h('span.mp-flex1'));
        }
    }
    render();
    return sheet;
}

/* ------------------------------------------------------------------ */
/* Refine wizard                                                       */
/* ------------------------------------------------------------------ */

const GOALS = [
    { id: 'enhance', label: t`Polish`, icon: 'wand-magic-sparkles', hint: t`Fix grammar, sharpen wording, keep every fact` },
    { id: 'expand', label: t`Add detail`, icon: 'maximize', hint: t`Roughly double the length with concrete specifics` },
    { id: 'condense', label: t`Shorten`, icon: 'minimize', hint: t`Fewer tokens, same facts` },
    { id: 'tone', label: t`Change tone`, icon: 'palette', hint: t`Rewrite in a different style` },
    { id: 'pov', label: t`Point of view`, icon: 'user-pen', hint: t`First, second or third person` },
    { id: 'custom', label: t`Custom`, icon: 'pen-to-square', hint: t`Tell the AI exactly what to change` },
];

/**
 * @param {{ avatarId: string, name: string, description: string, traits: Array, onApply: (text: string) => Promise<void>|void }} opts
 */
export function openRefineWizard({ avatarId, name, description, traits, onApply }) {
    let goal = 'enhance';
    let tone = 'vivid';
    let pov = 'third';
    let focus = '';
    let instruction = '';
    let target = 120;
    let index = 0;
    let dir = 1;
    const sheet = openSheet({ title: t`Adjust persona`, subtitle: t`What should change?` });

    if (!description.trim()) {
        sheet.setStep(h('div', null, h('p.mp-lead', null, t`This persona has no description yet. Use the Interview or Generate tools first.`)));
        sheet.setFooter(h('span.mp-flex1'), button({ label: t`Close`, kind: 'primary', onClick: () => sheet.close() }));
        return sheet;
    }

    function render() {
        sheet.setProgress((index + 1) / 3);
        if (index === 0) {
            sheet.setTitle(t`Adjust persona`, t`What should change?`);
            const grid = h('div.mp-goal-grid');
            for (const g of GOALS) {
                grid.append(h('button.mp-goal', { type: 'button', class: g.id === goal ? 'is-active' : '', onClick: () => { goal = g.id; render(); } },
                    h('span.mp-goal-icon', null, icon(g.icon)), h('span.mp-goal-label', null, g.label), h('span.mp-goal-hint', null, g.hint)));
            }
            sheet.setStep(h('div', null, stepDots(3, 0), grid), dir);
            requestAnimationFrame(() => stagger(grid, 35, 260));
            sheet.setFooter(h('span.mp-flex1'), button({ label: t`Continue`, icon: 'arrow-right', kind: 'primary', onClick: () => { dir = 1; index = 1; render(); } }));
        } else if (index === 1) {
            sheet.setTitle(t`Adjust persona`, GOALS.find(g => g.id === goal)?.label ?? '');
            let content;
            if (goal === 'tone') {
                const row = h('div.mp-tone-grid');
                for (const tn of TONES) row.append(h('button.mp-goal.mp-goal-sm', { type: 'button', class: tn.id === tone ? 'is-active' : '', onClick: () => { tone = tn.id; render(); } }, h('span.mp-goal-label', null, tn.label), h('span.mp-goal-hint', null, tn.hint)));
                content = h('div', null, h('p.mp-lead', null, t`Pick a tone.`), row);
            } else if (goal === 'pov') {
                content = h('div', null, h('p.mp-lead', null, t`Rewrite the description in…`), segmented({ options: [{ value: 'first', label: t`First person` }, { value: 'second', label: t`Second person` }, { value: 'third', label: t`Third person` }], value: pov, onChange: (v) => { pov = v; } }));
            } else if (goal === 'custom') {
                content = h('div', null, field({ label: t`Instruction`, hint: t`Be specific`, control: textarea({ value: instruction, rows: 4, placeholder: t`e.g. Make her ten years older and give her a limp from an old injury`, onInput: (v) => { instruction = v; } }) }));
            } else if (goal === 'expand') {
                content = h('div', null, field({ label: t`Focus (optional)`, hint: t`What to expand on`, control: input({ value: focus, placeholder: t`e.g. appearance and voice`, onInput: (v) => { focus = v; } }) }));
            } else if (goal === 'condense') {
                content = h('div', null, field({ label: t`Target length`, control: segmented({ options: [{ value: 60, label: '~60 words' }, { value: 120, label: '~120 words' }, { value: 200, label: '~200 words' }], value: target, onChange: (v) => { target = Number(v); } }) }));
            } else {
                content = h('div', null, h('p.mp-lead', null, t`Polish keeps every fact and roughly the same length. Nothing to configure.`));
            }
            sheet.setStep(h('div', null, stepDots(3, 1), content), dir);
            sheet.setFooter(
                button({ label: t`Back`, icon: 'arrow-left', kind: 'ghost', onClick: () => { dir = -1; index = 0; render(); } }),
                h('span.mp-flex1'),
                button({ label: t`Run`, icon: 'wand-magic-sparkles', kind: 'accent', className: 'mp-btn-glow', onClick: () => { if (goal === 'custom' && !instruction.trim()) { toastWarn(t`Write an instruction first`); return; } dir = 1; index = 2; render(); } }),
            );
        } else {
            sheet.setTitle(t`Adjust persona`, t`Review`);
            const wrap = h('div');
            sheet.setStep(h('div', null, stepDots(3, 2), wrap), dir);
            const job = () => {
                const base = { name, description, traits };
                switch (goal) {
                    case 'expand': return ai.expand({ ...base, focus });
                    case 'condense': return ai.condense({ ...base, target });
                    case 'tone': return ai.retone({ ...base, tone });
                    case 'pov': return ai.convertPov({ ...base, pov });
                    case 'custom': return ai.custom({ ...base, instruction });
                    default: return ai.enhance(base);
                }
            };
            aiReview({
                container: wrap, title: GOALS.find(g => g.id === goal)?.label ?? t`Result`, before: description,
                job,
                onApply: async (text) => { pushHistory(avatarId, description, t`Before: ${GOALS.find(g => g.id === goal)?.label ?? ''}`); await onApply(text); sheet.close(); },
            });
            sheet.setFooter(button({ label: t`Back`, icon: 'arrow-left', kind: 'ghost', onClick: () => { dir = -1; index = 1; render(); } }), h('span.mp-flex1'));
        }
    }
    render();
    return sheet;
}

/* ------------------------------------------------------------------ */
/* Import from character                                               */
/* ------------------------------------------------------------------ */

export function openImportWizard({ onDone }) {
    const sheet = openSheet({ title: t`Import from character`, subtitle: t`Turn a character card into a persona` });
    const list = personas.characterList();
    const search = input({ placeholder: t`Search characters…`, onInput: (v) => renderList(v) });
    const grid = h('div.mp-char-grid');
    function renderList(filter = '') {
        clear(grid);
        const q = filter.trim().toLowerCase();
        const items = list.filter(c => !q || c.name.toLowerCase().includes(q)).slice(0, 60);
        if (!items.length) grid.append(h('div.mp-muted', null, t`No characters match.`));
        for (const c of items) {
            grid.append(h('button.mp-char-card', {
                type: 'button', onClick: async (ev) => {
                    ev.currentTarget.classList.add('is-loading');
                    try {
                        const ok = await personas.fromCharacter(c.index);
                        if (ok) { toastOk(t`${c.name} imported`); sheet.close(); onDone?.(); }
                    } catch (err) { toastErr(err?.message ?? String(err)); }
                    finally { ev.currentTarget?.classList?.remove('is-loading'); }
                },
            }, h('img', { src: c.thumb, alt: '', loading: 'lazy' }), h('span.mp-char-name', null, c.name), h('span.mp-char-desc', null, c.description.slice(0, 90))));
        }
        stagger(grid, 25, 300);
    }
    renderList();
    sheet.setStep(h('div', null, h('p.mp-lead', null, t`The character's name, avatar and description are copied. {{char}} and {{user}} macros are swapped so the text reads as your persona.`), search, grid));
    sheet.setFooter(h('span.mp-flex1'), button({ label: t`Close`, kind: 'ghost', onClick: () => sheet.close() }));
    return sheet;
}

export { getTraits, spinnerDots, wordReveal };
