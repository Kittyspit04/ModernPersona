/**
 * Bridge to SillyTavern internals.
 *
 * Everything the extension needs from the host lives here, so the rest of the
 * code never has to care about relative import paths or which helper is on
 * `SillyTavern.getContext()` and which one must be imported directly.
 *
 * Path note: this file lives at
 *   public/scripts/extensions/third-party/ModernPersona/lib/st.js
 * so `../../../../../script.js` is `public/script.js` and
 * `../../../../personas.js` is `public/scripts/personas.js`.
 */

import {
    doNavbarIconClick,
    setUserName,
    default_user_avatar,
} from '../../../../../script.js';

import {
    user_avatar,
    setUserAvatar,
    getUserAvatars,
    getUserAvatar,
    initPersona,
    setPersonaDescription,
    getOrCreatePersonaDescriptor,
    isPersonaLocked,
    setPersonaLockState,
    togglePersonaLock,
    convertCharacterToPersona,
    persona_description_positions,
} from '../../../../personas.js';

export const MODULE_NAME = 'modernPersona';
export const EXTENSION_FOLDER = 'third-party/ModernPersona';

/** @returns {ReturnType<typeof SillyTavern.getContext>} */
export function ctx() {
    return SillyTavern.getContext();
}

/** Live getter for the currently selected persona avatar id. */
export function currentAvatarId() {
    return user_avatar;
}

export const st = {
    // script.js
    doNavbarIconClick,
    setUserName,
    default_user_avatar,
    // personas.js
    setUserAvatar,
    getUserAvatars,
    getUserAvatar,
    initPersona,
    setPersonaDescription,
    getOrCreatePersonaDescriptor,
    isPersonaLocked,
    setPersonaLockState,
    togglePersonaLock,
    convertCharacterToPersona,
    POSITIONS: persona_description_positions,
};

export function powerUser() {
    return ctx().powerUserSettings;
}

export function events() {
    const c = ctx();
    return { source: c.eventSource, types: c.eventTypes ?? c.event_types };
}

export function toast() {
    return globalThis.toastr;
}

export function t(strings, ...values) {
    // Pass through to ST's translation helper when available.
    try {
        return ctx().t(strings, ...values);
    } catch {
        return String.raw({ raw: strings }, ...values);
    }
}

/** Is the UI running on a phone-sized layout? */
export function isMobileLayout() {
    try {
        if (ctx().isMobile()) return true;
    } catch { /* ignore */ }
    return window.matchMedia('(max-width: 1000px)').matches;
}
