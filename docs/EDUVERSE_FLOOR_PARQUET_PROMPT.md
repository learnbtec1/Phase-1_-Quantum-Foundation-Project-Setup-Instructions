# Eduverse — dedicated hardwood parquet floor (image prompt)

Use for a **separate floor texture** (tiling plane under the avatar). Match **color, tone, and longitudinal oak pattern** to your reference `image_0.png` when generating.

## Prompt (English)

```
A detailed, low-angle, wide perspective architectural photograph focusing exclusively on a minimalist room's extensive floor covered with hardwood parquet. The flooring consists of longitudinal, wide oak planks. The wood must have the identical warm, natural honey oak color, tone, and longitudinal pattern as seen in image_0.png. Subtle, inviting grain patterns are visible. The planks feature a polished satin finish, softly reflecting warm ambient daylight coming from a blurred, out-of-focus background. The shot is clean, high-end, and perfectly level. Realistic seams and textures are paramount. 8k resolution, photorealistic, intricate detail, cinematic lighting, calm atmosphere.
```

## Export & wiring

1. Generate or composite the image (use **image_0.png** as style reference in your tool if supported).
2. Save as **`frontend/public/images/eduverse-floor-parquet.png`** (or update `EDUVERSE_FLOOR_DEDICATED_URL` in `AvatarCanvas.tsx`).
3. Set **`EDUVERSE_FLOOR_MODE = 'dedicated_file'`** in `AvatarCanvas.tsx`.
4. Tune **`EDUVERSE_FLOOR_TILES_PER_METER`** if planks look too large/small.
5. Set **`EDUVERSE_FLOOR_TILE_COLOR_HEX`** in `AvatarCanvas.tsx` to your desired tile tint (multiplies with the texture; use `#ffffff` for no tint).

## Modes

| `EDUVERSE_FLOOR_MODE` | Behavior |
|----------------------|----------|
| `'neutral'` | Solid soft color (no image). |
| `'panorama_slice'` | Floor UV from the main panorama (`EDUVERSE_BG_URL`). |
| `'dedicated_file'` | Tiled texture from `EDUVERSE_FLOOR_DEDICATED_URL`. |

See also: `docs/EDUVERSE_PANORAMA_PROMPT.md` (walls / window panorama).
