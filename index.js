/**
 * Modern Persona — a sleek persona creator for SillyTavern.
 *
 * Replaces (or sits next to) the stock Persona Management drawer with a
 * modern panel: gallery, inline editor, trait management, AI enhancement
 * tools and step-by-step wizards.
 */
import { st, events, t, ctx } from './lib/st.js';
import { settings, setSetting } from './lib/settings.js';
import { createPanel } from './ui/panel.js';
import { h, icon, button } from './ui/dom.js';

const DRAWER_ID = 'modern-persona-button';
const CONTENT_ID = 'mp-drawer';

let panel = null;

function nativeDrawer() {
    return document.getElementById('persona-management-button');
}

function ourDrawer() {
    return document.getElementById(DRAWER_ID);
}

/** Build the top-bar drawer that hosts the panel. */
function injectDrawer() {
    if (ourDrawer()) return ourDrawer();
    const native = nativeDrawer();
    const holder = document.getElementById('top-settings-holder');
    if (!holder) throw new Error('top-settings-holder not found');

    const s = settings();
    const iconEl = h('div', { class: `drawer-icon fa-solid ${s.icon} fa-fw closedIcon`, title: t`Personas` });
    const toggleEl = h('div.drawer-toggle', null, iconEl);
    const content = h('div.drawer-content.closedDrawer', { id: CONTENT_ID });
    const drawer = h('div.drawer', { id: DRAWER_ID }, toggleEl, content);

    if (native?.parentElement === holder) native.insertAdjacentElement('afterend', drawer);
    else holder.append(drawer);

    // Reuse SillyTavern's own open/close handler so behaviour matches the other icons.
    $(toggleEl).on('click', st.doNavbarIconClick);

    return drawer;
}

function applyReplaceMode(replace) {
    const native = nativeDrawer();
    if (native) native.classList.toggle('mp-hidden-native', !!replace);
    document.body.classList.toggle('mp-replacing', !!replace);
}

function openDrawer() {
    const drawer = ourDrawer();
    if (!drawer) return;
    const content = drawer.querySelector('.drawer-content');
    if (content?.classList.contains('openDrawer')) return;
    $(drawer.querySelector('.drawer-toggle')).trigger('click');
}

function closeDrawer() {
    const drawer = ourDrawer();
    const content = drawer?.querySelector('.drawer-content');
    if (content?.classList.contains('openDrawer')) $(drawer.querySelector('.drawer-toggle')).trigger('click');
}

/** Settings block in the Extensions panel. */
function injectSettingsBlock() {
    const host = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
    if (!host || document.getElementById('mp-ext-settings')) return;
    const s = settings();
    const replaceInput = h('input', { type: 'checkbox', checked: s.replaceNative, onChange: (ev) => { setSetting('replaceNative', ev.target.checked); applyReplaceMode(ev.target.checked); } });
    const animInput = h('input', { type: 'checkbox', checked: s.animations, onChange: (ev) => { setSetting('animations', ev.target.checked); document.body.classList.toggle('mp-no-motion', !ev.target.checked); } });
    const block = h('div.inline-drawer#mp-ext-settings', null,
        h('div.inline-drawer-toggle.inline-drawer-header', null, h('b', null, 'Modern Persona'), h('div.inline-drawer-icon.fa-solid.fa-circle-chevron-down.down')),
        h('div.inline-drawer-content', null,
            h('label.checkbox_label', null, replaceInput, h('span', null, t`Replace the built-in Persona Management panel`)),
            h('label.checkbox_label', null, animInput, h('span', null, t`Enable animations`)),
            h('div.flex-container.marginTop10', null,
                button({ label: t`Open Modern Persona`, icon: 'circle-user', kind: 'primary', small: true, onClick: () => { openDrawer(); } }),
                button({ label: t`New persona wizard`, icon: 'wand-magic-sparkles', kind: 'ghost', small: true, onClick: () => { openDrawer(); panel?.openCreate(); } }),
            ),
            h('small.mp-muted', null, t`More options live in the panel's Settings tab.`),
        ),
    );
    host.append(block);
}

function registerSlashCommands() {
    const c = ctx();
    try {
        c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({
            name: 'persona-studio',
            aliases: ['modern-persona', 'mp'],
            callback: async (args, value) => {
                const action = String(value ?? '').trim().toLowerCase();
                if (action === 'close') { closeDrawer(); return ''; }
                openDrawer();
                if (action === 'new' || action === 'create') panel?.openCreate();
                else if (['profile', 'traits', 'ai', 'links', 'settings'].includes(action)) panel?.setTab(action);
                return '';
            },
            unnamedArgumentList: [
                c.SlashCommandArgument.fromProps({ description: 'open | close | new | profile | traits | ai | links | settings', typeList: [c.ARGUMENT_TYPE.STRING], isRequired: false }),
            ],
            helpString: 'Opens the Modern Persona panel. Optional argument: <code>new</code> to start the creation wizard, or a tab name (<code>profile</code>, <code>traits</code>, <code>ai</code>, <code>links</code>, <code>settings</code>). <code>close</code> closes it.',
        }));
    } catch (err) {
        console.warn('[ModernPersona] slash command registration failed', err);
    }
}

function boot() {
    const s = settings();
    document.body.classList.toggle('mp-no-motion', !s.animations);

    const drawer = injectDrawer();
    const content = drawer.querySelector(`#${CONTENT_ID}`);
    panel = createPanel(content, { onToggleReplace: applyReplaceMode });
    applyReplaceMode(s.replaceNative);
    injectSettingsBlock();
    registerSlashCommands();

    // Reload the list whenever the drawer opens, so it always reflects the latest state.
    const observer = new MutationObserver(() => {
        if (content.classList.contains('openDrawer')) panel.open();
    });
    observer.observe(content, { attributes: true, attributeFilter: ['class'] });

    // If something else triggers the hidden native icon, open ours instead.
    const native = nativeDrawer();
    native?.querySelector('.drawer-toggle')?.addEventListener('click', (ev) => {
        if (!settings().replaceNative) return;
        ev.stopImmediatePropagation();
        ev.preventDefault();
        openDrawer();
    }, true);

    // Personas are initialised by the core after extensions load; wait for APP_READY
    // (or a short fallback when the extension was enabled after start-up).
    let primed = false;
    const prime = () => { if (primed) return; primed = true; panel.refresh(); };
    const { source, types } = events();
    source.on(types.APP_READY, prime);
    setTimeout(prime, 3000);

    console.log('[ModernPersona] ready');
}

jQuery(() => {
    try {
        boot();
    } catch (err) {
        console.error('[ModernPersona] failed to start', err);
    }
});

export { openDrawer, closeDrawer, icon };
