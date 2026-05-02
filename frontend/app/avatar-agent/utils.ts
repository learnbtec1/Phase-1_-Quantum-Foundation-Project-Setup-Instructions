
// utils.ts

// Simple Perlin Noise implementation (conceptual for demonstration)
// In a real project, you'd use a library like 'simplex-noise' or 'perlin-noise'
// This is a very basic pseudo-random noise, not true Perlin noise.
// For actual Perlin noise, a more complex algorithm is required, ideally from a dedicated library like 'simplex-noise' or 'perlin-noise'.
// This implementation serves as a conceptual placeholder for demonstration purposes.
let _perlinSeed = Math.random() * 1000;
export function perlinNoise(x: number, y: number = 0, z: number = 0): number {
  // This is a very basic pseudo-random noise, not true Perlin noise.
  // For actual Perlin noise, a more complex algorithm is required.
  // For demonstration, we'll use a simple hash-based approach.
  const prime1 = 73856093;
  const prime2 = 19349663;
  const prime3 = 83492791;
  const val = Math.sin(x * prime1 + y * prime2 + z * prime3 + _perlinSeed);
  return (val + 1) / 2; // Normalize to 0-1
}

// Easing functions
export const Easing = {
  // No easing, no acceleration
  linear: (t: number) => t,

  // Accelerating from zero velocity
  easeInQuad: (t: number) => t * t,
  easeOutQuad: (t: number) => t * (2 - t),
  easeInOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),

  // Accelerating from zero velocity and then decelerating to zero
  easeInOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  easeOutSine: (t: number) => Math.sin(t * Math.PI / 2),

  // Decelerating to zero velocity
  easeOutCubic: (t: number) => (--t) * t * t + 1,
};

// Function to smoothly interpolate between two values
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
