/**
 * Persona operations. Every write goes through the same `power_user` objects
 * the built-in Persona Management panel uses, so both views stay in sync and
 * the core prompt builder picks up changes immediately.
 */
import { ctx, st, powerUser, currentAvatarId, events, toast, t } from './st.js';
import { forgetPersona, copyPersonaData } from './settings.js';

const DEFAULT_DEPTH = 2;
const DEFAULT_ROLE = 0;

export const POSITION_OPTIONS = [
    { value: 0, label: 'In prompt', hint: 'Story string / Prompt Manager' },
    { value: 2, label: 'Top of Author\'s Note' },
    { value: 3, label: 'Bottom of Author\'s Note' },
    { value: 4, label: 'In chat at depth' },
    { value: 9, label: 'Disabled', hint: 'Description is not sent' },
];

export const ROLE_OPTIONS = [
    { value: 0, label: 'System' },
    { value: 1, label: 'User' },
    { value: 2, label: 'Assistant' },
];

/** @typedef {{ id: string, name: string, title: string, description: string, position: number, depth: number, role: number, lorebook: string, connections: Array<{type:string,id:string}>, isDefault: boolean, isCurrent: boolean, lockedChat: boolean, lockedChar: boolean }} PersonaView */

function descriptorOf(avatarId) {
    const pu = powerUser();
    return pu.persona_descriptions?.[avatarId];
}

function ensureDescriptor(avatarId) {
    const pu = powerUser();
    if (!pu.persona_descriptions) pu.persona_descriptions = {};
    if (!pu.persona_descriptions[avatarId]) {
        pu.persona_descriptions[avatarId] = {
            description: '',
            position: st.POSITIONS.IN_PROMPT,
            depth: DEFAULT_DEPTH,
            role: DEFAULT_ROLE,
            lorebook: '',
            connections: [],
            title: '',
        };
    }
    return pu.persona_descriptions[avatarId];
}

async function emit(type, payload) {
    const { source, types } = events();
    const name = types[type];
    if (name) await source.emit(name, payload);
}

function save() {
    ctx().saveSettingsDebounced();
}

/** Current connection object for the open character/group, mirrors personas.js */
function currentConnection() {
    const c = ctx();
    if (c.groupId) return { type: 'group', id: c.groupId };
    const character = c.characters?.[c.characterId];
    if (character?.avatar) return { type: 'character', id: character.avatar };
    return null;
}

export function isConnectedToCurrent(avatarId) {
    const conn = currentConnection();
    if (!conn) return false;
    const list = descriptorOf(avatarId)?.connections ?? [];
    return list.some(x => x.type === conn.type && x.id === conn.id);
}

/** Build a view model for a persona id. */
export function viewOf(avatarId) {
    const pu = powerUser();
    const d = descriptorOf(avatarId) ?? {};
    const chatPersona = ctx().chatMetadata?.persona;
    return {
        id: avatarId,
        name: pu.personas?.[avatarId] || '[Unnamed Persona]',
        title: d.title || '',
        description: d.description || '',
        position: Number.isFinite(Number(d.position)) ? Number(d.position) : st.POSITIONS.IN_PROMPT,
        depth: Number.isFinite(Number(d.depth)) ? Number(d.depth) : DEFAULT_DEPTH,
        role: Number.isFinite(Number(d.role)) ? Number(d.role) : DEFAULT_ROLE,
        lorebook: d.lorebook || '',
        connections: Array.isArray(d.connections) ? d.connections : [],
        isDefault: pu.default_persona === avatarId,
        isCurrent: currentAvatarId() === avatarId,
        lockedChat: chatPersona === avatarId,
        lockedChar: isConnectedToCurrent(avatarId),
    };
}

/** All persona ids known to the server, with missing descriptors initialised. */
export async function listPersonaIds() {
    const ids = await st.getUserAvatars(false);
    const pu = powerUser();
    for (const id of ids) {
        if (!pu.personas?.[id]) {
            await st.initPersona(id, '[Unnamed Persona]', '', '', { silent: true });
        }
    }
    return ids;
}

export async function listPersonas() {
    const ids = await listPersonaIds();
    return ids.map(viewOf);
}

export function thumbUrl(avatarId, bust = false) {
    const url = ctx().getThumbnailUrl('persona', avatarId);
    return bust ? `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}` : url;
}

export function fullUrl(avatarId) {
    return st.getUserAvatar(avatarId);
}

/** Refresh the hidden native list so core state stays coherent. */
export async function refreshNative(openAt = '') {
    try {
        await st.getUserAvatars(true, openAt);
        st.setPersonaDescription();
    } catch (err) {
        console.warn('[ModernPersona] native refresh failed', err);
    }
}

export async function select(avatarId) {
    if (!avatarId || avatarId === currentAvatarId()) return;
    await st.setUserAvatar(avatarId, { toastPersonaNameChange: true, navigateToCurrent: true });
}

export function makeAvatarId(name) {
    const clean = String(name || 'persona').replace(/[^a-zA-Z0-9]/g, '') || 'persona';
    return `${Date.now()}-${clean}.png`;
}

/**
 * Upload avatar bytes for a persona id.
 * @param {Blob|File|string} source A File/Blob, a data URL, or a URL to fetch
 * @param {string} avatarId Target avatar id (file name)
 * @param {object} [options]
 * @param {boolean} [options.crop=true] Offer the crop dialog
 */
export async function uploadAvatar(source, avatarId, { crop = true } = {}) {
    const c = ctx();
    let blob;
    let dataUrl = null;

    if (typeof source === 'string') {
        if (source.startsWith('data:')) {
            dataUrl = source;
            blob = await (await fetch(source)).blob();
        } else {
            blob = await (await fetch(source, { cache: 'no-cache' })).blob();
        }
    } else {
        blob = source;
    }

    let url = '/api/avatars/upload';
    const pu = powerUser();
    if (crop && !pu.never_resize_avatars) {
        if (!dataUrl) dataUrl = await blobToDataUrl(blob);
        const dlg = new c.Popup(t`Adjust your avatar`, c.POPUP_TYPE.CROP, '', { cropImage: dataUrl });
        dlg.dlg?.classList?.add('mp-popup');
        const result = await dlg.show();
        if (!result) return false;
        if (dlg.cropData !== undefined) {
            url += `?crop=${encodeURIComponent(JSON.stringify(dlg.cropData))}`;
        }
    }

    const file = blob instanceof File ? blob : new File([blob], 'avatar.png', { type: blob.type || 'image/png' });
    const formData = new FormData();
    formData.append('avatar', file);
    formData.append('overwrite_name', avatarId);

    const response = await fetch(url, {
        method: 'POST',
        headers: c.getRequestHeaders({ omitContentType: true }),
        cache: 'no-cache',
        body: formData,
    });
    if (!response.ok) {
        toast()?.error(t`Avatar upload failed`);
        return false;
    }

    try {
        await fetch(st.getUserAvatar(avatarId), { cache: 'reload' });
        await fetch(c.getThumbnailUrl('persona', avatarId), { cache: 'reload' });
    } catch { /* cache bust is best effort */ }

    // Refresh avatars already rendered in chat.
    document.querySelectorAll('#chat .mes[is_user="true"] .avatar img').forEach(img => {
        const src = img.getAttribute('src');
        if (src) img.setAttribute('src', src.split('&t=')[0] + `&t=${Date.now()}`);
    });
    return true;
}

export function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Create a persona.
 * @param {{name:string, title?:string, description?:string, position?:number, depth?:number, role?:number, lorebook?:string, avatar?: Blob|string|null, crop?: boolean, select?: boolean, makeDefault?: boolean, lockChat?: boolean}} data
 */
export async function create(data) {
    const name = String(data.name || '').trim();
    if (!name) throw new Error('A persona needs a name');
    const avatarId = makeAvatarId(name);

    await st.initPersona(avatarId, name, data.description ?? '', data.title ?? '', {
        position: data.position ?? st.POSITIONS.IN_PROMPT,
        depth: data.depth ?? DEFAULT_DEPTH,
        role: data.role ?? DEFAULT_ROLE,
        lorebook: data.lorebook ?? '',
    });

    let uploaded = false;
    if (data.avatar) {
        uploaded = await uploadAvatar(data.avatar, avatarId, { crop: data.crop ?? true });
    }
    if (!uploaded) {
        await uploadAvatar(st.default_user_avatar, avatarId, { crop: false });
    }

    save();
    await refreshNative(avatarId);

    if (data.makeDefault) {
        powerUser().default_persona = avatarId;
        save();
    }
    if (data.select !== false) {
        await select(avatarId);
    }
    if (data.lockChat && data.select !== false) {
        await st.setPersonaLockState(true, 'chat');
    }
    return avatarId;
}

export async function rename(avatarId, newName) {
    const pu = powerUser();
    const name = String(newName || '').trim();
    const oldName = pu.personas[avatarId];
    if (!name || name === oldName) return false;
    pu.personas[avatarId] = name;
    if (avatarId === currentAvatarId()) {
        st.setUserName(name, { toastPersonaNameChange: false });
    }
    save();
    await emit('PERSONA_RENAMED', { avatarId, oldName, newName: name });
    await refreshNative(avatarId);
    return true;
}

export async function setTitle(avatarId, title) {
    const d = ensureDescriptor(avatarId);
    d.title = String(title ?? '').trim();
    save();
    await emit('PERSONA_UPDATED', avatarId);
    await refreshNative(avatarId);
}

export async function setDescription(avatarId, description) {
    const d = ensureDescriptor(avatarId);
    d.description = String(description ?? '');
    if (avatarId === currentAvatarId()) {
        powerUser().persona_description = d.description;
        const native = document.getElementById('persona_description');
        if (native instanceof HTMLTextAreaElement) native.value = d.description;
    }
    save();
    await emit('PERSONA_UPDATED', avatarId);
}

export async function setPlacement(avatarId, { position, depth, role }) {
    const d = ensureDescriptor(avatarId);
    if (position !== undefined) d.position = Number(position);
    if (depth !== undefined) d.depth = Math.max(0, Number(depth) || 0);
    if (role !== undefined) d.role = Number(role);
    if (avatarId === currentAvatarId()) {
        const pu = powerUser();
        pu.persona_description_position = d.position;
        pu.persona_description_depth = d.depth;
        pu.persona_description_role = d.role;
        st.setPersonaDescription();
    }
    save();
    await emit('PERSONA_UPDATED', avatarId);
}

export async function setLorebook(avatarId, lorebook) {
    const d = ensureDescriptor(avatarId);
    d.lorebook = String(lorebook ?? '');
    if (avatarId === currentAvatarId()) {
        powerUser().persona_description_lorebook = d.lorebook;
        st.setPersonaDescription();
    }
    save();
    await emit('PERSONA_UPDATED', avatarId);
}

export async function toggleDefault(avatarId) {
    const pu = powerUser();
    if (pu.default_persona === avatarId) {
        delete pu.default_persona;
    } else {
        pu.default_persona = avatarId;
    }
    save();
    await refreshNative(avatarId);
    return pu.default_persona === avatarId;
}

/** Lock state helpers operate on the currently selected persona (core limitation). */
export async function toggleLock(type) {
    return await st.togglePersonaLock(type);
}

export function lockState(type) {
    try { return st.isPersonaLocked(type); } catch { return false; }
}

function hasCommand(name) {
    try { return Boolean(ctx().SlashCommandParser?.commands?.[name]); } catch { return false; }
}

export async function duplicate(avatarId) {
    const c = ctx();
    const pu = powerUser();
    let newId = '';
    if (hasCommand('persona-duplicate')) {
        const result = await c.executeSlashCommandsWithOptions(`/persona-duplicate select=false persona="${escapeArg(avatarId)}"`, { handleExecutionErrors: true });
        newId = String(result?.pipe ?? '').trim();
    } else {
        // Older cores: replicate the duplicate flow by hand.
        const name = pu.personas[avatarId];
        if (!name) return '';
        newId = makeAvatarId(name);
        const d = descriptorOf(avatarId) ?? {};
        pu.personas[newId] = name;
        pu.persona_descriptions[newId] = {
            description: d.description ?? '', position: d.position ?? st.POSITIONS.IN_PROMPT, depth: d.depth ?? DEFAULT_DEPTH,
            role: d.role ?? DEFAULT_ROLE, lorebook: d.lorebook ?? '', title: d.title ?? '', connections: [],
        };
        await uploadAvatar(st.getUserAvatar(avatarId), newId, { crop: false });
        save();
        await emit('PERSONA_CREATED', { avatarId: newId, name, description: d.description ?? '', title: d.title ?? '', duplicatedFromAvatarId: avatarId });
        await refreshNative(newId);
    }
    if (newId) copyPersonaData(avatarId, newId);
    return newId;
}

export async function remove(avatarId) {
    const c = ctx();
    let ok = false;
    if (hasCommand('persona-delete')) {
        const result = await c.executeSlashCommandsWithOptions(`/persona-delete silent=true persona="${escapeArg(avatarId)}"`, { handleExecutionErrors: true });
        ok = String(result?.pipe ?? '').trim() === 'true';
    } else {
        const pu = powerUser();
        const name = pu.personas[avatarId] || '';
        const response = await fetch('/api/avatars/delete', {
            method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify({ avatar: avatarId }),
        });
        ok = response.ok;
        if (ok) {
            delete pu.personas[avatarId];
            delete pu.persona_descriptions[avatarId];
            if (pu.default_persona === avatarId) pu.default_persona = null;
            if (c.chatMetadata?.persona === avatarId) { delete c.chatMetadata.persona; c.saveMetadataDebounced(); }
            save();
            await emit('PERSONA_DELETED', { avatarId, name });
            if (currentAvatarId() === avatarId) {
                const ids = await st.getUserAvatars(false);
                const next = pu.default_persona || ids[0];
                if (next) await st.setUserAvatar(next, { toastPersonaNameChange: false });
            }
            await refreshNative();
        }
    }
    if (ok) forgetPersona(avatarId);
    return ok;
}

function escapeArg(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export async function backup() {
    document.getElementById('personas_backup')?.click();
}

export async function restore() {
    document.getElementById('personas_restore')?.click();
}

export async function fromCharacter(characterIndex) {
    return await st.convertCharacterToPersona(Number(characterIndex));
}

export function tokenCount(text) {
    try {
        return ctx().getTokenCountAsync(String(text ?? ''));
    } catch {
        return Promise.resolve(Math.ceil(String(text ?? '').length / 4));
    }
}

export function lorebookNames() {
    try { return ctx().getWorldInfoNames(); } catch { return []; }
}

export function characterList() {
    const c = ctx();
    return (c.characters ?? []).map((ch, index) => ({
        index,
        name: ch.name,
        avatar: ch.avatar,
        description: ch.description ?? '',
        thumb: c.getThumbnailUrl('avatar', ch.avatar),
    }));
}

export function currentCharacter() {
    const c = ctx();
    if (c.groupId) {
        const group = c.groups?.find(g => g.id === c.groupId);
        return group ? { name: group.name, description: '' } : null;
    }
    const ch = c.characters?.[c.characterId];
    return ch ? { name: ch.name, description: ch.description ?? '', personality: ch.personality ?? '', scenario: ch.scenario ?? '' } : null;
}
