/**
 * Trait management. Traits are small labelled facts about the persona,
 * grouped by category. They live in the extension settings keyed by avatar
 * id and can be compiled into a description or extracted from one.
 */
import { settings, saveSettings } from './settings.js';
import { ctx } from './st.js';

export const CATEGORIES = [
    { id: 'identity', label: 'Identity', icon: 'fa-id-card', hint: 'Age, gender, species, occupation' },
    { id: 'appearance', label: 'Appearance', icon: 'fa-eye', hint: 'Looks, build, clothing, distinctive marks' },
    { id: 'personality', label: 'Personality', icon: 'fa-heart', hint: 'Temperament, values, flaws' },
    { id: 'background', label: 'Background', icon: 'fa-book', hint: 'History, origin, family' },
    { id: 'skills', label: 'Skills', icon: 'fa-bolt', hint: 'Abilities, talents, training' },
    { id: 'likes', label: 'Likes', icon: 'fa-thumbs-up', hint: 'Things they enjoy' },
    { id: 'dislikes', label: 'Dislikes', icon: 'fa-thumbs-down', hint: 'Things they avoid or hate' },
    { id: 'speech', label: 'Speech', icon: 'fa-comment', hint: 'Voice, accent, verbal habits' },
    { id: 'goals', label: 'Goals', icon: 'fa-flag', hint: 'Wants, motivations, fears' },
    { id: 'relationships', label: 'Relationships', icon: 'fa-people-arrows', hint: 'Bonds with other characters' },
    { id: 'quirks', label: 'Quirks', icon: 'fa-wand-sparkles', hint: 'Habits, tics, oddities' },
    { id: 'custom', label: 'Other', icon: 'fa-ellipsis', hint: 'Anything else' },
];

/** Quick-add suggestions shown in the trait picker. */
export const PRESETS = {
    identity: ['Early twenties', 'Late thirties', 'University student', 'Freelance artist', 'Night-shift nurse', 'Retired soldier', 'Travelling merchant', 'Apprentice mage'],
    appearance: ['Tall and lean', 'Short with a stocky build', 'Messy dark hair', 'Silver-blonde braid', 'Freckles across the nose', 'Scar through one eyebrow', 'Always in a worn leather jacket', 'Round glasses', 'Tired green eyes'],
    personality: ['Dry sense of humour', 'Fiercely loyal', 'Slow to trust', 'Curious to a fault', 'Hot-tempered but quick to forgive', 'Calm under pressure', 'Secretly sentimental', 'Blunt and honest', 'Anxious overthinker'],
    background: ['Grew up in a small coastal town', 'Raised by a single parent', 'Left home at sixteen', 'Former street kid', 'Only child of wealthy parents', 'Survived a shipwreck', 'Exiled from their homeland'],
    skills: ['Excellent cook', 'Speaks three languages', 'Skilled with a bow', 'Picks locks', 'Plays the piano', 'Reads people easily', 'Fixes anything mechanical', 'Trained medic'],
    likes: ['Rainy mornings', 'Strong black coffee', 'Old books', 'Cats', 'Long walks at night', 'Spicy food', 'Quiet company', 'Thunderstorms'],
    dislikes: ['Crowds', 'Being lied to', 'Cold weather', 'Loud music', 'Small talk', 'Being told what to do', 'Needles'],
    speech: ['Soft-spoken', 'Swears casually', 'Speaks formally', 'Thick northern accent', 'Uses a lot of sarcasm', 'Rarely raises their voice', 'Trails off mid-sentence when thinking'],
    goals: ['Wants to find a missing sibling', 'Dreams of opening a bakery', 'Seeks revenge', 'Longs to be understood', 'Afraid of being forgotten', 'Wants to prove themselves'],
    relationships: ['Estranged from their father', 'Has a close childhood friend', 'Recently heartbroken', 'Protective older sibling', 'Owes a debt to a dangerous person'],
    quirks: ['Taps fingers when nervous', 'Collects bottle caps', 'Talks to plants', 'Never sits with their back to a door', 'Hums while working', 'Always carries a notebook'],
    custom: [],
};

export function categoryOf(id) {
    return CATEGORIES.find(c => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];
}

/** @returns {Array<{id:string, category:string, text:string}>} */
export function getTraits(avatarId) {
    if (!avatarId) return [];
    const s = settings();
    return s.traits[avatarId] ?? (s.traits[avatarId] = []);
}

export function setTraits(avatarId, traits) {
    if (!avatarId) return;
    const s = settings();
    s.traits[avatarId] = traits;
    saveSettings();
}

export function addTrait(avatarId, category, text) {
    const clean = String(text ?? '').trim();
    if (!clean) return null;
    const list = getTraits(avatarId);
    if (list.some(x => x.category === category && x.text.toLowerCase() === clean.toLowerCase())) return null;
    const trait = { id: ctx().uuidv4(), category: categoryOf(category).id, text: clean };
    list.push(trait);
    saveSettings();
    return trait;
}

export function updateTrait(avatarId, traitId, patch) {
    const list = getTraits(avatarId);
    const trait = list.find(x => x.id === traitId);
    if (!trait) return;
    Object.assign(trait, patch);
    saveSettings();
}

export function removeTrait(avatarId, traitId) {
    const list = getTraits(avatarId);
    const index = list.findIndex(x => x.id === traitId);
    if (index >= 0) list.splice(index, 1);
    saveSettings();
}

export function moveTrait(avatarId, traitId, direction) {
    const list = getTraits(avatarId);
    const index = list.findIndex(x => x.id === traitId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    saveSettings();
}

export function groupTraits(traits) {
    /** @type {Map<string, Array<{id:string, category:string, text:string}>>} */
    const map = new Map();
    for (const category of CATEGORIES) map.set(category.id, []);
    for (const trait of traits) {
        const key = categoryOf(trait.category).id;
        map.get(key).push(trait);
    }
    return map;
}

/**
 * Compile traits into a compact description block without AI.
 * Produces a bracketed, list-style profile that works well as a prompt.
 */
export function compileTraits(name, traits, { title = '' } = {}) {
    const grouped = groupTraits(traits);
    const lines = [];
    const who = name || '{{user}}';
    const head = title ? `${who} (${title})` : who;
    lines.push(`[${head}]`);
    for (const category of CATEGORIES) {
        const list = grouped.get(category.id);
        if (!list?.length) continue;
        lines.push(`${category.label}: ${list.map(x => x.text.replace(/\.$/, '')).join('; ')}.`);
    }
    return lines.join('\n');
}

/** Build a plain-text summary of the traits for prompts. */
export function traitsForPrompt(traits) {
    const grouped = groupTraits(traits);
    const lines = [];
    for (const category of CATEGORIES) {
        const list = grouped.get(category.id);
        if (!list?.length) continue;
        lines.push(`- ${category.label}: ${list.map(x => x.text).join('; ')}`);
    }
    return lines.join('\n');
}
