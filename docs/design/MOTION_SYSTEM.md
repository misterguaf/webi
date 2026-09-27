# Gestió — Motion System

Status: ACTIVE
Version: 0.1
Project: Grup Scout Parpalló — Gestió
Phase: 3.5

---

## 1. Purpose

Motion is a core part of the Gestió experience.

It should make the application feel:

- polished;
- responsive;
- coherent;
- premium;
- alive without becoming distracting.

Motion must communicate:

- continuity;
- hierarchy;
- state;
- cause and effect;
- spatial relationship.

Gestió must not use animation simply because animation looks impressive.

Core rule:

80% CLARITY
20% MAGIC

---

## 2. Motion personality

Gestió motion should feel:

PRECISE
SOFT
FAST
NATURAL
CONFIDENT

It should not feel:

- bouncy without reason;
- playful in financial contexts;
- slow;
- theatrical;
- game-like;
- exaggerated.

Motion should support the feeling of a polished macOS application.

---

## 3. Motion hierarchy

Gestió uses three levels of motion.

### Level 1 — Micro motion

Very subtle.

Used for:

- hover;
- pressed states;
- focus;
- icon transitions;
- small control changes;
- selection.

Typical duration:

100–180ms

These interactions should feel almost instantaneous.

---

### Level 2 — Interface motion

Clearly visible but restrained.

Used for:

- sidebar collapse;
- drawers;
- tab changes;
- popovers;
- command palette;
- panel opening;
- contextual navigation.

Typical duration:

180–320ms

These transitions should communicate where interface elements come from and
where they go.

---

### Level 3 — Signature motion

Used only for meaningful moments.

Examples:

- card → detail transition;
- payment confirmation;
- activity publication;
- issue resolution;
- global search opening;
- completion states.

Typical duration:

250–500ms

Signature motion may create the “wow” effect of Gestió.

It must remain rare.

---

# 4. Timing tokens

Use shared timing values instead of arbitrary durations.

--motion-instant: 100ms
--motion-fast:    160ms
--motion-default: 220ms
--motion-medium:  300ms
--motion-slow:    420ms

Avoid animations longer than 500ms for normal interface transitions.

---

# 5. Easing

Gestió should avoid generic linear motion.

Preferred easing families:

### Enter

Objects entering should decelerate naturally.

Suggested:

cubic-bezier(0.16, 1, 0.3, 1)

---

### Exit

Objects leaving may accelerate slightly.

Suggested:

cubic-bezier(0.4, 0, 1, 1)

---

### Standard transition

Suggested:

cubic-bezier(0.2, 0, 0, 1)

---

## 5.1 Spring motion

Springs may be used for:

- command palette;
- contextual panels;
- card expansion;
- selected premium interactions.

Springs must remain controlled.

Avoid:

- repeated bouncing;
- overshoot that affects readability;
- exaggerated elastic motion.

Suggested character:

stiffness: medium-high
damping: high
overshoot: minimal

---

# 6. Official Gestió motion patterns

The following patterns form the initial official motion library.

Do not invent new motion patterns when one of these can solve the interaction.

---

## MOTION 01 — App Enter

Purpose:
Initial appearance of Gestió.

Behaviour:

- main shell appears immediately;
- content fades in subtly;
- optional 4–8px upward translation;
- no dramatic intro animation.

Duration:
200–300ms

Gestió must feel ready immediately.

Never block interaction with an intro animation.

---

## MOTION 02 — Sidebar Collapse

Purpose:
Collapse or expand the desktop sidebar.

Behaviour:

Expanded:
icon + label

Collapsed:
icon remains;
label fades and reduces available width;
layout transitions smoothly.

Avoid:
text abruptly disappearing after width collapse.

Suggested sequence:

1. labels begin fading;
2. sidebar width changes;
3. content area responds;
4. icons settle into final alignment.

Duration:
220–300ms

Motion should preserve spatial continuity.

---

## MOTION 03 — Navigation Context Shift

Purpose:
Move between primary Gestió sections.

Examples:

Dashboard → Activitats
Activitats → Quotes

Behaviour:

- current content moves/fades subtly;
- incoming content appears from the navigation direction or depth;
- persistent shell remains stable.

Avoid full-page browser-like refresh behaviour.

Duration:
180–260ms

The user should feel that they remain inside the same application.

---

## MOTION 04 — Shared Card Expansion

Purpose:
Open a card or row into a detailed view.

This is one of Gestió's signature interactions.

Behaviour:

The selected element should visually become part of the next view.

Possible shared elements:

- title;
- status;
- participant name;
- icon;
- selected metric.

The transition may include:

- scale;
- position;
- radius transformation;
- surface elevation;
- opacity of secondary content.

Duration:
280–420ms

Use only when the relationship between source and destination is clear.

Fallback:
simple panel transition when shared-element motion would add complexity.

---

## MOTION 05 — Detail Drawer

Purpose:
Open secondary detail without abandoning context.

Behaviour:

Desktop:
drawer emerges from the relevant edge.

Mobile:
drawer may become a bottom or full-height sheet.

Background content may:

- remain visible;
- slightly dim;
- optionally reduce depth.

Duration:
220–320ms

Drawer closing should be slightly faster than opening.

---

## MOTION 06 — Command Palette

Trigger:
⌘K

This is a signature Gestió interaction.

Behaviour:

1. background subtly loses emphasis;
2. palette appears near the visual centre/top centre;
3. very small scale transition;
4. glass becomes visible;
5. focus immediately enters search input.

Suggested start:

scale: 0.97
opacity: 0
translateY: -6px

End:

scale: 1
opacity: 1
translateY: 0

Use controlled spring or premium ease.

Duration:
180–280ms

The palette must feel extremely fast.

Closing:
faster and simpler than opening.

---

## MOTION 07 — Popover / Context Menu

Purpose:
Secondary contextual actions.

Behaviour:

- short fade;
- small scale or translation;
- origin should correspond to trigger position.

Duration:
120–180ms

Never use dramatic motion.

---

## MOTION 08 — State Morph

Purpose:
Transform an interface state without replacing the whole component.

Examples:

PENDENT → PAGAT
ISSUE → RESOLT
DRAFT → PUBLICADA

Behaviour:

- badge changes material/colour;
- text transitions;
- optional icon appears;
- size changes should animate smoothly.

Duration:
180–260ms

State changes should feel connected to the action that caused them.

---

## MOTION 09 — Payment Confirmed

Signature event.

Purpose:
Provide clear feedback when a payment has been successfully verified.

Behaviour:

The UI should communicate certainty, not celebration.

Possible sequence:

1. control enters brief processing state;
2. value/state changes;
3. `PENDENT` or equivalent morphs into `PAGAT`;
4. check icon appears subtly;
5. affected metric updates.

Optional:
very subtle Iris → semantic success transition.

No:

- confetti;
- bouncing;
- large celebration;
- loud green flash.

Duration:
300–450ms total.

The effect should feel satisfying and professional.

---

## MOTION 10 — Issue Resolved

Purpose:
Communicate resolution of a financial or administrative issue.

Behaviour:

- warning emphasis reduces;
- issue badge morphs to resolved state;
- related information reorganises smoothly;
- content does not abruptly disappear.

If the issue disappears from a list:

1. state morph;
2. short pause;
3. row collapses/removes.

The user should understand what happened.

---

## MOTION 11 — Activity Published

Signature event.

Purpose:
Communicate that an activity moved from draft to published.

Possible sequence:

DRAFT
→ transition
→ PUBLICADA

The interface may use:

- state morph;
- small surface highlight;
- subtle Iris pulse;
- appearance in active activity list.

Avoid celebratory animation.

---

## MOTION 12 — Metric Update

Purpose:
Update dashboard values.

Examples:

82% → 83%
18 pending → 17 pending

Behaviour:

Small numeric changes may animate.

Preferred:

- number interpolation;
- short vertical number transition;
- brief semantic emphasis.

Duration:
250–450ms

Do not animate every metric every time the dashboard loads.

Use motion mainly when a user action caused the change.

---

## MOTION 13 — List Insert / Remove

Purpose:
Maintain spatial understanding when records change.

Insert:

- surrounding items move smoothly;
- new row fades/slides into place.

Remove:

- row first acknowledges state change;
- then height collapses;
- remaining rows reposition smoothly.

Duration:
180–300ms

Never instantly teleport surrounding content unless the data change is too
large for meaningful animation.

---

## MOTION 14 — Theme Transition

Purpose:
Switch between light and dark mode.

Avoid instantly flashing the whole interface.

Preferred:

- colour tokens transition briefly;
- surfaces and borders interpolate;
- glass changes subtly.

Duration:
180–300ms

Do not animate expensive blur values excessively.

Theme switching must remain immediate and stable.

---

## MOTION 15 — Toast / Feedback

Purpose:
Short-lived system feedback.

Enter:

- fade;
- small vertical movement.

Exit:

- fade;
- slightly faster movement.

Duration:

enter: 180–220ms
exit: 120–160ms

Toasts should not bounce.

---

# 7. Hover behaviour

Hover is subtle.

Preferred effects:

- small surface change;
- border emphasis;
- icon colour;
- tiny elevation;
- reveal contextual action.

Avoid:

- large scaling;
- strong glow;
- dramatic shadows.

Interactive cards may use at most approximately:

scale: 1.005–1.01

Often no scale is better.

---

# 8. Pressed behaviour

Pressed state should feel immediate.

Examples:

- tiny scale reduction;
- darker/lighter surface;
- reduced elevation.

Typical:

scale: 0.98–0.995

Duration:
80–120ms

Do not use strong bounce-back.

---

# 9. Loading

Gestió should avoid blocking spinners when partial loading is possible.

Preferred hierarchy:

1. preserve existing content;
2. skeleton;
3. inline progress state;
4. spinner only when necessary.

Skeletons should:

- match final layout;
- avoid excessive shimmer;
- remain calm.

Use subtle motion.

---

# 10. Navigation continuity

Persistent elements should remain persistent.

Examples:

- sidebar;
- toolbar;
- global search access;
- page shell.

Do not animate the whole screen when only one content region changes.

This helps Gestió feel like a desktop application rather than a website.

---

# 11. Motion and financial actions

Financial interactions require restraint.

Actions such as:

- verifying payment;
- changing allocations;
- resolving issues;
- authorising installments;

must prioritise:

1. clarity;
2. confirmation;
3. state visibility;
4. audit confidence.

Signature motion may reinforce completion.

It must never make serious financial actions feel playful.

---

# 12. Motion and destructive actions

Destructive actions must not use celebratory or branded motion.

Preferred:

- clear confirmation;
- semantic danger state;
- restrained transition;
- obvious resulting state.

Deletion should communicate consequence.

---

# 13. Reduced motion

Gestió must respect:

`prefers-reduced-motion: reduce`

When enabled:

- remove shared-element travel;
- remove scale-heavy transitions;
- remove spring effects;
- reduce translations;
- preserve short opacity changes where useful;
- keep all state changes understandable.

Motion must never be required to understand what happened.

---

# 14. Reduced transparency

Where platform/browser support permits, Gestió should provide a fallback for
users who prefer reduced transparency.

Glass surfaces should become:

- more opaque;
- higher contrast;
- visually stable.

The layout must not depend on blur.

---

# 15. Performance

Motion must remain smooth.

Target:
60fps on normal supported devices.

Avoid animating expensive properties unnecessarily.

Prefer:

- transform;
- opacity.

Be cautious with:

- large backdrop blur regions;
- box-shadow animation;
- layout-heavy width/height animations;
- filters.

Motion should never make Gestió feel slower.

---

# 16. Mobile motion

Mobile motion uses the same language but adapts spatial patterns.

Examples:

Desktop drawer:
side panel

Mobile:
bottom sheet / full-screen sheet

Desktop contextual transition:
small shared expansion

Mobile:
larger vertical transition

Touch interactions should feel direct.

Do not reproduce desktop motion mechanically on small screens.

---

# 17. Motion consistency rules

Do not:

- invent arbitrary easings;
- invent one-off durations;
- use multiple spring personalities;
- add bounce casually;
- animate every hover;
- animate content continuously;
- use motion to compensate for unclear hierarchy.

Reuse official patterns.

---

# 18. Signature Gestió moments

The following experiences should eventually become recognisable Gestió
interactions:

1. Sidebar transformation
2. ⌘K command palette
3. Shared card → detail transition
4. Payment confirmed state morph
5. Issue resolved transition
6. Activity published transition
7. Metric update after meaningful action

These are the places where the 20% “magic” may be most visible.

---

# 19. Motion decision test

Before adding an animation, ask:

1. What changed?
2. Does motion explain that change?
3. Does it preserve spatial continuity?
4. Will this interaction happen frequently?
5. Will the motion become annoying after 100 uses?
6. Can reduced-motion users understand the result without it?

If motion does not improve comprehension or product quality, remove it.

---

# 20. Initial implementation strategy

Do not implement every signature animation immediately.

During the first Gestió shell implementation, validate only:

- sidebar collapse;
- primary navigation transition;
- theme transition;
- basic popovers;
- command palette entrance if the palette is implemented.

More complex signature motion should be introduced when the corresponding
functional screen exists.

This keeps the system intentional and avoids building animation demos before
real product workflows.
