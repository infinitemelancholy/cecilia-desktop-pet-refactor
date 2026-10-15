Create one horizontal animation strip for ChatGPT pet `cecilia-cafe`, state `idle`.

Use the attached canonical base for identity. Use the attached layout guide only for slot count, spacing, centering, and padding; do not draw the guide.

Output exactly 6 full-body frames in one left-to-right row on a genuinely transparent alpha background (no cyan, checkerboard or painted background). Treat the row as 6 invisible equal-width slots: one centered complete pose per slot, evenly spaced, with no overlap, clipping, empty slots, labels, or borders.

Identity: same pet in every frame: 大头小身薄荷长发绿眼；红色细竖条纹泡泡肩长袖白袖口，白荷叶围裙，深裙棕领结，白女仆头饰低束发淡蓝发带。服装按官方第6话图。真实透明；无字无飘浮效果。. Preserve silhouette, face, proportions, markings, palette, material, style, and props.
Style: Pet-safe sprite: compact full-body mascot, readable in a 192x208 cell, clear silhouette, simple face, stable palette/materials, and crisp naturally antialiased transparent edges. Style `auto`: Infer the most appropriate pet-safe style from the user request and reference images, then keep that exact style consistent across every row.
Animation continuity: keep apparent pet scale and baseline stable within the row unless the state itself intentionally changes vertical position, such as `jumping`. Move the pose within the slot instead of redrawing the pet larger or smaller frame to frame.

State action: Calm low-distraction resting loop: subtle breathing, tiny blink, slight head/body bob, and only quiet persona-preserving motion.

State requirements:
- CRITICAL: idle is the low-distraction baseline state and the first frame is also used as the reduced-motion static pet.
- Use only subtle idle motion: gentle breathing, a tiny blink, a slight head or body bob, a very small material sway, or another quiet motion that fits the pet persona.
- Keep the pet essentially in the same pose, facing direction, silhouette, markings, palette, and prop state across all 6 frames.
- Idle variation must stay calm but still read as animation; do not repeat effectively identical copies across the loop.
- Do not show waving, walking, running, jumping, talking, working, reviewing, emotional reactions, large gestures, item interactions, or new props.
- Feet, base, body, or object anchor should remain planted or nearly planted.
- The first and last frames should be very close visually so the loop feels calm and does not pop.

Clean extraction: crisp opaque edges, safe padding, no scenery, text, guide marks, checkerboard, shadows, glows, motion blur, speed lines, dust, detached effects, stray pixels, or artificial chroma fringes around the pet.


Reference roles: Image 1 is the approved cafe canonical (primary exact face, identity, proportions, hairstyle and costume); Image 2 is a layout guide only, never depict its lines or colors; Image 3 is the original pet style and identity reference, do not copy its saint costume; Image 4 is the official episode 6 outfit source. Keep cafe canonical costume throughout. Six frames should show a breathing and blinking loop: 1 calm open eyes, 2 slight chest inhale and hair sway, 3 softly half-lidded blink, 4 eyes closed for a brief blink, 5 eyes opening and exhale, 6 calm open eyes close to frame 1. Small changes only. All six fully visible figures occupy equal size and stable shoe baseline, separated by clear transparent space. No blue/cyan guides, no text, no box borders. Output exactly one horizontal row of six poses.
CRITICAL COMPOSITION UPDATE: leave generously more empty transparent space. Each entire full-body figure, including the long side ponytail, must occupy only about 60% of the whole strip canvas height and at most 75% of its own invisible slot width. The canvas must have transparent outer margins at least 4% of the whole image width on BOTH left and right. Leave visibly clear transparent gaps between every adjacent pair of complete silhouettes. Nothing may touch or cross the canvas edges. Do not draw larger figures just to fill the canvas. All figures share one common scale. Actual fully transparent background with NO yellow, cyan, green, red or white matte fringe. No detached colored specks.
