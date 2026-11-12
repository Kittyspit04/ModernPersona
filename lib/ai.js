/**
 * AI helpers. Everything goes through SillyTavern's `generateRaw`, so the
 * currently connected API, model and connection profile are used as-is.
 */
import { ctx, events } from './st.js';
import { settings, TONES } from './settings.js';
import { CATEGORIES, traitsForPrompt } from './traits.js';
import { currentCharacter } from './personas.js';

let activeJobs = 0;

export function isBusy() {
    return activeJobs > 0;
}

function languageLine() {
    const lang = settings().ai.language?.trim();
    return lang ? `Write in ${lang}.` : 'Write in the same language as the source material.';
}

function characterContext() {
    if (!settings().ai.includeCharacter) return '';
    const ch = currentCharacter();
    if (!ch?.name) return '';
    const desc = String(ch.description || '').slice(0, 1200);
    return `\n\nThe persona will be used in a roleplay with a character named ${ch.name}.${desc ? ` Their description, for tone and setting only (do not describe them, do not copy from it):\n"""${desc}"""` : ''}`;
}

/**
 * Run a raw generation with a shared system prompt.
 * @param {string} prompt
 * @param {{ length?: number, system?: string, signal?: AbortSignal }} [options]
 */
export async function run(prompt, { length, system } = {}) {
    const c = ctx();
    const s = settings();
    activeJobs++;
    document.body.classList.add('mp-ai-busy');
    try {
        const text = await c.generateRaw({
            prompt,
            systemPrompt: system ?? s.ai.systemPrompt,
            responseLength: length ?? s.ai.responseLength,
        });
        return cleanOutput(text);
    } finally {
        activeJobs--;
        if (activeJobs <= 0) {
            activeJobs = 0;
            document.body.classList.remove('mp-ai-busy');
        }
    }
}

/** Abort the running generation, if any. */
export function stop() {
    try { ctx().stopGeneration(); } catch { /* ignore */ }
}

export function cleanOutput(text) {
    let out = String(text ?? '').trim();
    // Remove code fences
    out = out.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    // Remove a wrapping pair of quotes if the whole thing is quoted
    if (/^["“].*["”]$/s.test(out) && !out.slice(1, -1).includes('"')) out = out.slice(1, -1).trim();
    // Strip common prefaces
    out = out.replace(/^(here( is|'s) (the|your|a) [^:\n]{0,60}:\s*)/i, '').trim();
    return out;
}

function personaBlock(name, description) {
    return `Persona name: ${name || '{{user}}'}\nCurrent description:\n"""\n${description || '(empty)'}\n"""`;
}

/** Polish: fix grammar, tighten, keep meaning and length. */
export function enhance({ name, description }) {
    return run(`${personaBlock(name, description)}

Task: Polish this persona description. Fix spelling and grammar, remove repetition, make every sentence specific and vivid, and keep all facts exactly as they are. Do not invent new facts. Keep roughly the same length and the same format (prose stays prose, lists stay lists). ${languageLine()}${characterContext()}

Return only the improved description.`);
}

/** Expand: add detail while respecting existing facts. */
export function expand({ name, description, traits = [], focus = '' }) {
    const traitText = traitsForPrompt(traits);
    return run(`${personaBlock(name, description)}
${traitText ? `\nKnown traits (must stay true):\n${traitText}\n` : ''}
Task: Expand this persona description to roughly twice its length. Add concrete, specific detail${focus ? ` with emphasis on ${focus}` : ''}: appearance, mannerisms, voice, a hint of backstory and what drives them. Never contradict the existing facts or traits. Keep the same point of view and the same language. ${languageLine()}${characterContext()}

Return only the expanded description.`, { length: Math.max(settings().ai.responseLength, 600) });
}

/** Condense: shorter, token-efficient version. */
export function condense({ name, description, target = 120 }) {
    return run(`${personaBlock(name, description)}

Task: Rewrite this persona description so it uses as few tokens as possible while keeping every important fact. Aim for about ${target} words or fewer. Prefer short declarative sentences or a compact bracketed list. ${languageLine()}

Return only the condensed description.`, { length: 300 });
}

/** Rewrite with a tone preset. */
export function retone({ name, description, tone }) {
    const preset = TONES.find(x => x.id === tone) ?? TONES[0];
    return run(`${personaBlock(name, description)}

Task: Rewrite this persona description in a ${preset.label.toLowerCase()} style (${preset.hint.toLowerCase()}). Keep every fact, the point of view and roughly the same length. ${languageLine()}${characterContext()}

Return only the rewritten description.`);
}

/** Convert point of view. */
export function convertPov({ name, description, pov }) {
    const target = pov === 'first' ? 'first person ("I", "my")' : pov === 'second' ? 'second person ("you", "your")' : `third person, referring to the persona as ${name || '{{user}}'} or by pronoun`;
    return run(`${personaBlock(name, description)}

Task: Rewrite this persona description in ${target}. Keep every fact and roughly the same length. ${languageLine()}

Return only the rewritten description.`);
}

/** Apply a free-form instruction. */
export function custom({ name, description, instruction, traits = [] }) {
    const traitText = traitsForPrompt(traits);
    return run(`${personaBlock(name, description)}
${traitText ? `\nKnown traits:\n${traitText}\n` : ''}
Task: Edit the persona description following this instruction exactly: "${instruction}". Unless the instruction says otherwise, keep all other facts and the overall length. ${languageLine()}${characterContext()}

Return only the edited description.`);
}

/** Generate a brand-new description from traits and notes. */
export function fromTraits({ name, title, traits = [], notes = '', style = 'prose', length = 'medium' }) {
    const traitText = traitsForPrompt(traits);
    const lengthHint = { short: 'about 80 words', medium: 'about 160 words', long: 'about 280 words' }[length] ?? 'about 160 words';
    const styleHint = style === 'list'
        ? 'Format: a compact bracketed profile, one line per category, like "[Name: ...]\\nAppearance: ...\\nPersonality: ...".'
        : style === 'mixed'
            ? 'Format: one short paragraph of prose followed by a compact list of key facts.'
            : 'Format: flowing third-person prose, one or two paragraphs, no headings.';
    return run(`Create a persona description for a roleplay user character.

Name: ${name || '{{user}}'}${title ? `\nTitle / tagline: ${title}` : ''}
${traitText ? `Traits:\n${traitText}` : 'Traits: (none given, invent a coherent, interesting character)'}
${notes ? `Extra notes from the user:\n"""${notes}"""` : ''}

${styleHint}
Length: ${lengthHint}. Make it specific and usable as a prompt: concrete appearance, personality with at least one flaw, a hint of background, how they speak. Use every trait given. Do not add a title or heading. ${languageLine()}${characterContext()}

Return only the description.`, { length: Math.max(settings().ai.responseLength, 500) });
}

/** Generate from interview answers. */
export function fromInterview({ name, answers, style = 'prose', length = 'medium' }) {
    const qa = answers.filter(a => a.answer?.trim()).map(a => `Q: ${a.question}\nA: ${a.answer.trim()}`).join('\n\n');
    const lengthHint = { short: 'about 80 words', medium: 'about 160 words', long: 'about 280 words' }[length] ?? 'about 160 words';
    const styleHint = style === 'list'
        ? 'Format: a compact bracketed profile, one line per category.'
        : 'Format: flowing third-person prose, one or two paragraphs, no headings.';
    return run(`Create a persona description for a roleplay user character named ${name || '{{user}}'} from this interview with the player.

${qa || '(The player gave no answers. Invent a coherent, interesting character.)'}

${styleHint}
Length: ${lengthHint}. Turn the answers into a vivid, specific profile. Keep every fact the player gave, fill small gaps tastefully, do not contradict anything. ${languageLine()}${characterContext()}

Return only the description.`, { length: Math.max(settings().ai.responseLength, 500) });
}

/** Suggest a handful of new traits for a persona. */
export async function suggestTraits({ name, description, traits = [], count = 8 }) {
    const categories = CATEGORIES.map(c => c.id).join(', ');
    const raw = await run(`${personaBlock(name, description)}
${traits.length ? `\nExisting traits:\n${traitsForPrompt(traits)}\n` : ''}
Task: Suggest ${count} new, specific traits that would make this persona more interesting and consistent with what is known. Spread them over different categories. Each trait is a short phrase of at most 10 words.
Allowed categories: ${categories}.
${languageLine()}

Respond with a JSON array only, no prose, in this exact shape:
[{"category":"personality","text":"Laughs at her own bad jokes"}]`, { length: 400, system: 'You output strictly valid JSON and nothing else.' });
    return parseTraitJson(raw);
}

/** Extract traits from an existing description. */
export async function extractTraits({ name, description }) {
    const categories = CATEGORIES.map(c => c.id).join(', ');
    const raw = await run(`${personaBlock(name, description)}

Task: Extract every distinct fact from the description as a trait. Each trait is a short phrase of at most 12 words, assigned to one category. Do not invent anything that is not in the description.
Allowed categories: ${categories}.

Respond with a JSON array only, no prose, in this exact shape:
[{"category":"appearance","text":"Short silver hair"}]`, { length: 700, system: 'You output strictly valid JSON and nothing else.' });
    return parseTraitJson(raw);
}

/** Generate a short title / tagline. */
export function suggestTitle({ name, description, traits = [] }) {
    return run(`${personaBlock(name, description)}
${traits.length ? `\nTraits:\n${traitsForPrompt(traits)}\n` : ''}
Task: Write one short title or tagline for this persona, at most 6 words, no quotation marks, no trailing period. Example: "Wandering Knight of the Ash Coast". ${languageLine()}

Return only the title.`, { length: 40 });
}

/** Ask follow-up interview questions based on previous answers. */
export async function followUpQuestions({ name, answers, count = 3 }) {
    const qa = answers.filter(a => a.answer?.trim()).map(a => `Q: ${a.question}\nA: ${a.answer.trim()}`).join('\n');
    const raw = await run(`A player is describing the character they will play, named ${name || '{{user}}'}. So far:

${qa || '(nothing yet)'}

Task: Ask ${count} short follow-up questions that would uncover the most interesting missing details (contradictions, secrets, sensory specifics, relationships). Each question is one sentence. ${languageLine()}

Respond with a JSON array of strings only.`, { length: 250, system: 'You output strictly valid JSON and nothing else.' });
    const parsed = parseJsonArray(raw);
    return parsed.filter(x => typeof x === 'string' && x.trim()).slice(0, count);
}

function parseJsonArray(raw) {
    const text = String(raw ?? '');
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end <= start) return [];
    try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function parseTraitJson(raw) {
    const allowed = new Set(CATEGORIES.map(c => c.id));
    return parseJsonArray(raw)
        .filter(x => x && typeof x === 'object' && typeof x.text === 'string' && x.text.trim())
        .map(x => ({
            category: allowed.has(String(x.category).toLowerCase()) ? String(x.category).toLowerCase() : 'custom',
            text: String(x.text).trim().replace(/\.$/, ''),
        }));
}

/** Resolve when the current generation finishes or fails. */
export function onGenerationEnd(callback) {
    const { source, types } = events();
    const handler = () => callback();
    source.on(types.GENERATION_ENDED, handler);
    source.on(types.GENERATION_STOPPED, handler);
    return () => {
        source.removeListener(types.GENERATION_ENDED, handler);
        source.removeListener(types.GENERATION_STOPPED, handler);
    };
}
