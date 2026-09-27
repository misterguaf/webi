# Gestió — Design Vision

Status: ACTIVE
Version: 0.1
Project: Grup Scout Parpalló — Gestió
Phase: 3.5

---

## 1. Product vision

Gestió is the internal management application of Grup Scout Parpalló.

It must not feel like a generic administrative dashboard.

It should feel like a carefully designed desktop application:
precise, calm, elegant and highly polished.

The main visual reference is the quality and restraint associated with
well-designed macOS applications, combined with a younger and more
technological identity of its own.

Gestió should feel professional enough for financial and administrative work,
while still reflecting that Parpalló is a young, active and contemporary
organisation.

---

## 2. Personality

Gestió is:

ELEGANT
SERENE
YOUNG
TECHNOLOGICAL
BOLD

These qualities must remain balanced.

Boldness must never damage clarity.

Youthfulness must never make the application look childish.

Technology must never make it look like a gaming interface.

Elegance must never make it cold or difficult to use.

---

## 3. Core principle

80% CLARITY
20% MAGIC

The application must first be:

- understandable;
- fast;
- predictable;
- readable;
- comfortable for repeated use.

The remaining layer can create delight through:

- motion;
- material;
- depth;
- transitions;
- micro-interactions;
- carefully chosen visual moments.

The "wow" effect should come from polish, not from visual noise.

---

## 4. Native desktop feeling

Gestió should feel closer to a native macOS application than to a traditional
web dashboard.

This does NOT mean copying macOS literally.

It means adopting qualities such as:

- precise spacing;
- clear visual hierarchy;
- calm layouts;
- high-quality typography;
- refined controls;
- meaningful translucency;
- subtle depth;
- responsive interactions;
- consistent iconography;
- excellent state transitions.

The interface should feel intentionally designed rather than assembled from
generic dashboard components.

---

## 5. Desktop-first, mobile-complete

Gestió is designed desktop-first.

Desktop is the primary environment for:

- administration;
- treasury;
- participant management;
- activity management;
- registrations;
- complex tables;
- incident resolution;
- detailed workflows.

The desktop experience may therefore use:

- sidebar navigation;
- multi-column layouts;
- richer information density;
- drawers;
- contextual panels;
- keyboard shortcuts;
- command palette;
- larger data surfaces.

Mobile must still be fully functional.

Mobile is not an afterthought or a broken compressed desktop layout.

The same task may use a different interaction pattern on mobile when needed.

Examples:

- tables may become structured cards;
- sidebar may become compact navigation;
- secondary actions may move into menus;
- layouts may become sequential instead of multi-column.

Responsive does not mean identical.

It means equally understandable and usable.

---

## 6. Information density

Gestió uses medium information density.

The home dashboard should communicate the current situation quickly without
trying to display every available detail.

Within a few seconds, a user should understand:

- what is happening;
- what requires attention;
- the state of relevant activities;
- the state of annual fees;
- the existence of incidents or pending actions.

Detailed information belongs in the corresponding functional area.

Use progressive disclosure.

Overview first.
Details when requested.

---

## 7. Visual identity

Gestió has its own visual identity, distinct from the public Parpalló website.

The interface should remain approximately 85–90% neutral.

Its identity comes from a controlled accent family called:

IRIS

Iris is based on a cold relationship between:

- violet;
- indigo;
- lavender;
- subtle blue influence.

The exact colour tokens are defined in `DESIGN_SYSTEM.md`.

Gestió must not become "the purple application".

Iris should appear strategically in:

- active navigation;
- primary actions;
- selection;
- focus;
- interaction states;
- selected icons;
- selected charts;
- subtle reflections and glow;
- key branded moments.

Semantic colours remain semantic.

Green, amber and red must communicate status and risk rather than branding.

A screenshot should eventually be recognisable as Gestió even without showing
the logo.

---

## 8. Light mode

Light mode should feel:

LUMINOUS
CALM
PRECISE
CLEAN

It should use:

- soft white and cool neutral surfaces;
- very subtle separation between layers;
- restrained shadows;
- limited translucency;
- Iris accents used carefully.

Light mode should feel close to a polished modern macOS application.

Glass should often be felt before it is consciously noticed.

---

## 9. Dark mode

Dark mode is not simply an inverted light mode.

It is the more atmospheric expression of Gestió.

It should feel:

DEEP
PREMIUM
TECHNOLOGICAL
POLISHED

Use:

- deep graphite rather than pure black;
- multiple dark surface levels;
- controlled translucency;
- subtle reflections;
- soft borders;
- increased perception of depth;
- Iris violet/indigo accents;
- extremely controlled glow.

Dark mode may be visually more spectacular than light mode.

It must never become:

- gaming;
- cyberpunk;
- neon-heavy;
- visually exhausting.

Professional readability remains the priority.

---

## 10. Glass and material

Glass is part of the material language of Gestió.

It is not the default surface for everything.

Strong glass is appropriate for:

- sidebar;
- command palette;
- floating panels;
- overlays;
- popovers;
- contextual toolbars;
- selected drawers.

Subtle glass may appear in:

- selected metric surfaces;
- quick actions;
- special highlighted elements.

Solid or near-solid surfaces are preferred for:

- data-heavy content;
- tables;
- long forms;
- dense lists;
- reading-intensive areas.

Glass should create hierarchy.

If everything is glass, glass has no meaning.

---

## 11. Motion

Motion is a defining part of Gestió.

Most interaction motion should be:

- fast;
- subtle;
- natural;
- easy to ignore during repeated use.

Some moments are allowed to create a clear "wow" effect.

Potential signature moments include:

- contextual navigation transitions;
- card or row expanding into detail;
- shared-element transitions;
- command palette entrance;
- sidebar transformations;
- metric updates;
- state transformations;
- payment confirmation;
- activity publication;
- resolved incidents;
- significant completion states.

Motion must communicate continuity, hierarchy or state.

Decorative animation with no purpose should be avoided.

Gestió will eventually define a small official motion library in
`MOTION_SYSTEM.md`.

---

## 12. Interaction quality

Every interaction should feel finished.

Important details include:

- hover states;
- focus states;
- pressed states;
- loading states;
- skeletons;
- empty states;
- success feedback;
- error feedback;
- disabled states;
- contextual actions;
- keyboard navigation;
- command palette;
- responsive transitions.

A feature is not visually complete merely because its default state looks
good.

---

## 13. Dashboard philosophy

The dashboard is a summary, not the application itself.

It should answer:

"What should I know right now?"

Possible categories include:

- activities;
- registrations;
- annual fees;
- incidents;
- pending actions;
- recent changes.

The dashboard should avoid unnecessary widgets.

Every card must justify its existence.

---

## 14. Navigation

Desktop navigation should primarily use a refined lateral sidebar.

The sidebar should:

- feel integrated into the application;
- remain visually light;
- support collapse;
- preserve recognisable icons when collapsed;
- use clear tooltips;
- communicate active context precisely.

Gestió should support a global command/search experience through `⌘K`.

Search should eventually allow users to find:

- participants;
- activities;
- registrations;
- payments;
- actions.

Search is part of navigation, not an optional utility.

---

## 15. Typography

Typography should support the native desktop feeling.

The preferred direction is a system-first sans-serif stack so macOS can use
its native San Francisco typography without bundling proprietary font files.

Typography should feel:

- clean;
- compact;
- highly readable;
- neutral enough for dense administrative information;
- expressive through hierarchy rather than decorative fonts.

Exact typography tokens belong in `DESIGN_SYSTEM.md`.

---

## 16. Accessibility

Accessibility is part of the visual system, not a later patch.

Gestió must account for:

- sufficient contrast;
- keyboard focus;
- meaningful states beyond colour alone;
- touch target size;
- readable typography;
- reduced motion;
- reduced transparency where appropriate.

Support:

`prefers-reduced-motion`

and design motion so removing animation does not break comprehension.

---

## 17. What Gestió must NOT become

Gestió must not look like:

- a generic SaaS dashboard;
- Bootstrap admin;
- a corporate enterprise panel;
- a collection of unrelated cards;
- an Apple imitation;
- a glassmorphism demo;
- a gaming interface;
- a neon cyberpunk product;
- an animation showcase;
- a mobile layout stretched onto desktop.

Do not add visual complexity simply to make the application look more
"designed".

---

## 18. Design decision test

When evaluating a visual decision, ask:

1. Does it make the interface clearer?
2. Does it feel intentional?
3. Does it belong to Gestió?
4. Does it remain professional?
5. Will it still feel good after using the application every week?
6. Does the effect justify the attention it demands?

If the answer is no, simplify.

---

## 19. Desired reaction

The first reaction should be:

"This is extremely polished."

The second should be:

"I immediately understand how to use it."

Not the other way around.

Gestió should impress through confidence, coherence and detail rather than
spectacle alone.
