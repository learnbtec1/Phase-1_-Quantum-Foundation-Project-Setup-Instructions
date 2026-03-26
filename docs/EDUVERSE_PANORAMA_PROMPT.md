# Eduverse — seamless panoramic background (image prompt)

Use this text with your image model (Midjourney, DALL·E, SDXL, etc.). Export a **single equirectangular or ultra-wide** bitmap, then slice in-app with `EDUVERSE_U_SPLIT`.

## Prompt (English)

```
A seamless wide-angle panoramic view for a 3D room background. The central 42% of the image features a massive, floor-to-ceiling clean glass window overlooking a serene botanical garden with a soft Amman city skyline at sunset. The left 30% and right 28% of the image are minimalist textured white walls with soft ambient light. No furniture, no desks, no floors. High-end architectural photography, 8k resolution, cinematic lighting, calm and studious atmosphere, photorealistic.
```

## Horizontal layout (UV / width)

| Zone   | Share | U range (0→1) |
|--------|-------|----------------|
| Left   | 30%   | 0.00 – 0.30    |
| Center | 42%   | 0.30 – 0.72    |
| Right  | 28%   | 0.72 – 1.00    |

Code: `EDUVERSE_U_SPLIT = [0, 0.3, 0.72, 1]`.

## Floor in 3D

The prompt specifies **no floor in the texture**. In `AvatarCanvas.tsx`, use `EDUVERSE_FLOOR_MODE = 'neutral'` for a solid plane, `'panorama_slice'` if your panorama includes a floor strip, or `'dedicated_file'` for a separate parquet texture — see **`docs/EDUVERSE_FLOOR_PARQUET_PROMPT.md`**.

## Asset path

Replace `public/images/edu.verse-bg.png` after generating the new image (keep filename or update `EDUVERSE_BG_URL`).

## Floor palette (3D match)

**Warm honey oak parquet** (reference floor photo): solid plane + `gridHelper` use tan / oak tones, not cool grey.

| Role | Hex (example) |
|------|------------------|
| Solid floor / warm planks | `#C6A68D`, or lighter `#D2B48C`, cream `#E3DAC9` toward lit background |
| Plank seams / grid center | `#8B7355` |

In `AvatarCanvas.tsx`: `EDUVERSE_FLOOR_TILE_COLOR_HEX`, `EDUVERSE_GRID_COLOR_CENTER`, `EDUVERSE_GRID_COLOR_CELL`, `EDUVERSE_FLOOR_GRID_VISIBLE`.

**Cool cyan-grey** (older panoramic match): was `#C2CED7` / `#7A8B99` — switch constants if the background image floor reads cool again.
