# Modern Persona

A sleek, animated persona creator for [SillyTavern](https://github.com/SillyTavern/SillyTavern).
It replaces the stock *Persona Management* drawer with a modern panel that has a persona gallery,
an inline editor, trait management, AI enhancement tools and step-by-step wizards. Built for phones
first, comfortable on desktop: on screens wider than 1000 px it opens as a large centred window (up to
1760 px) whatever SillyTavern's Chat Width is.

Works on its own; with [Modern Mobile UI](https://github.com/Kittyspit04/ModernMobileUI) installed it follows
that theme's appearance (Zinc, Midnight, Light, Liquid Glass, themes per chat), on phones and in its desktop
mode.

The look follows a dark zinc palette with springy motion. If your custom CSS already defines the
`--cai-*` variables (background, bubble colours, text, radius, easing), the panel picks them up
automatically so it matches the rest of your theme.

## Install

1. In SillyTavern open **Extensions** (the cubes icon) → **Install extension**.
2. Paste the repository URL:

   ```
   https://github.com/Kittyspit04/ModernPersona
   ```

3. Click **Install for all users** (or just for you) and let the page reload.
4. The smiley persona icon in the top bar is replaced by a new persona icon. Tap it.

Requires a recent SillyTavern release (1.13 or newer). No extras server, no API keys of its own:
the AI tools use whatever API and model you are currently connected to.

## What you get

### Gallery
- All personas with avatar, name, title, lock badges and the default crown.
- Search and A–Z sorting. On phones the gallery becomes a horizontal strip above the editor.
- Tap a persona to make it active. Everything stays in sync with SillyTavern's own persona state.

### Editor
- **Hero card** with a large avatar (tap to change the image, with SillyTavern's crop dialog),
  inline-editable name and title, status pills and one-tap buttons for *default*, *lock to chat*,
  *link to character* and a *more* menu (duplicate, interview, delete).
- **Profile tab**: description with live word and token counts, *Polish* (one-tap AI clean-up),
  *Adjust…* (the refine wizard) and *History* (restore earlier versions). Prompt placement
  (position, depth, role) and the persona lorebook live here too.
- **Traits tab**: facts grouped into categories (identity, appearance, personality, background,
  skills, likes, dislikes, speech, goals, relationships, quirks). Add your own, pick from quick-add
  suggestions, edit by tapping, move between categories with a long-press or right-click.
  Buttons to let the AI *suggest* traits, *extract* traits from the current description, and to
  *write traits into the description* (compact list without AI, or prose with AI).
- **AI tab**: Polish, Add detail, Shorten, Generate from traits, Interview, Adjust, Suggest title,
  eight tone presets and a free-form custom instruction. Every result appears in a review card
  with a word-by-word reveal, *Use this*, *Append*, *Compare*, *Copy* and *Retry*.
- **Links tab**: default / chat / character toggles, linked characters with unlink, and the
  SillyTavern persona behaviour switches (notifications, multi-connections, auto-lock).
- **Settings tab**: replace-the-stock-panel toggle, animations, word reveal, top-bar icon,
  AI options (character context, max tokens, output language, system prompt), backup and restore.

### Wizards
- **Guided wizard** – name and avatar → traits → description (write, compile from traits or
  generate with AI) → placement, lorebook, default and chat lock → review → create.
- **Interview** – answer a handful of questions in your own words, optionally let the AI ask
  follow-ups, then have it write the description. Works for new and existing personas.
- **Adjust** – pick a goal (polish, add detail, shorten, change tone, point of view, custom
  instruction), run it, compare with the original, apply. Every applied change is kept in the
  persona's history so you can undo it.
- **Import from character** – turn any character card into a persona.

### Animations
Springy pop-ins, staggered card entrances, a sliding tab indicator, slide transitions between
wizard steps, a breathing orb and shimmer skeleton while the AI thinks, a pulsing top-bar icon
during generation, word-by-word reveal of results, and small press/scale feedback on every control.
The system *reduce motion* preference is respected, and there is an in-panel switch to turn motion off.

## Slash command

```
/persona-studio            open the panel
/persona-studio new        open the panel and start the creation wizard
/persona-studio traits     open a tab (profile, traits, ai, links, settings)
/persona-studio close      close the panel
```

Aliases: `/modern-persona`, `/mp`.

## Where data lives

Persona names, descriptions, placement and connections are the regular SillyTavern persona
settings, so the stock panel, slash commands and backups keep working. Traits, version history and
the extension's own options are stored in `extension_settings.modernPersona` inside your user
settings.

## Keeping the stock panel

Turn off **Replace the built-in persona panel** in the Settings tab (or in the Extensions panel
block). The original smiley icon comes back and Modern Persona keeps its own icon next to it.

## Development notes

- `index.js` – bootstraps the drawer, settings block and slash command.
- `lib/st.js` – the only file that imports SillyTavern internals.
- `lib/personas.js` – persona operations that write to the same state the core uses.
- `lib/ai.js` – prompts for every AI tool, all routed through `generateRaw`.
- `lib/traits.js` – categories, quick-add presets, trait storage and compilation.
- `ui/` – DOM toolkit, reusable widgets, the panel and the wizards.
- `style.css` – theme tokens, keyframes, layout and the mobile breakpoint.

## License

MIT
