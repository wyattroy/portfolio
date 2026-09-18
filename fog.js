/**
 * fog.js — tiles fade toward the background as they recede into the past.
 *
 * Fog is measured from where you're looking, not baked onto old projects: it
 * starts at the nearest card on screen in front of the camera. Zoomed out, that's
 * the newest work; zoom in on a 2019 project and 2019 is crisp while what lies
 * behind it fades. When cards pass behind the camera the starting point glides
 * to the next one rather than jumping.
 *
 * The fade is front-loaded: most of it happens just behind that nearest card,
 * then it eases off across the graph's full depth. three.js's built-in fog only
 * fades in a straight line, so every fogged material gets this curve patched
 * into its shader (installFogCurve).
 *
 * The "Bounce & Fog Tuner" artifact runs this same code and exports FOG.
 */

export const FOG = {
  startYears: 0,       // how far behind the nearest card on screen the fog begins, in years
  strength: 0.65,      // how faded a card the graph's full depth behind that is (0 = no fog, 1 = gone)
  falloff: 4,          // 0 = even fade; higher = more of the fade right behind the nearest card
  color: '#FFFFFF',    // what tiles fade toward; keep it the page background unless you want a tint
};

// Shared by every patched material: change .value and all of them follow
export const fogUniforms = {
  fogStrength: { value: FOG.strength },
  fogFalloff: { value: FOG.falloff },
};

// 0 → 1 across the fog range, front-loaded by `falloff` (same curve as the shader)
export function fogShape(x, falloff) {
  const t = Math.min(1, Math.max(0, x));
  return falloff < 0.001 ? t : (1 - Math.exp(-falloff * t)) / (1 - Math.exp(-falloff));
}

const FOG_PARS = `
uniform float fogStrength;
uniform float fogFalloff;`;

const FOG_FRAGMENT = `
#ifdef USE_FOG
  // fogNear = where the fog starts (nearest card on screen), fogFar = one graph-depth further
  float fogX = clamp( ( vFogDepth - fogNear ) / max( fogFar - fogNear, 1e-4 ), 0.0, 1.0 );
  float fogShaped = fogFalloff < 0.001 ? fogX : ( 1.0 - exp( -fogFalloff * fogX ) ) / ( 1.0 - exp( -fogFalloff ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogStrength * fogShaped );
#endif`;

// Patch a material to use the front-loaded fog curve. Safe to call repeatedly.
export function installFogCurve(material) {
  if (!material || material.userData.fogCurve || material.fog === false) return;
  material.userData.fogCurve = true;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    shader.uniforms.fogStrength = fogUniforms.fogStrength;
    shader.uniforms.fogFalloff = fogUniforms.fogFalloff;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <fog_pars_fragment>', `#include <fog_pars_fragment>${FOG_PARS}`)
      .replace('#include <fog_fragment>', FOG_FRAGMENT);
  };
  material.customProgramCacheKey = () => 'fog-curve-v1';
  material.needsUpdate = true;
}

// Patch every material under an object (scene, group or mesh)
export function installFogCurveIn(root) {
  root.traverse(obj => {
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach(installFogCurve);
  });
}

export function createFogState() {
  return { front: null };
}

// How quickly the fog's starting point glides to a new nearest card
const FRONT_GLIDE = 0.12; // share of the remaining gap closed per 60 Hz frame

// Per frame.
//   nearestDepth: camera-forward distance to the nearest card on screen in
//                 front of the camera (null if none — keeps the last value)
//   spanDepth:    the graph's full depth, newest to oldest, in world units
//   unitsPerYear: time-axis world units per year
export function updateFog(fog, cfg, state, nearestDepth, spanDepth, unitsPerYear, dt = 16.67) {
  if (nearestDepth != null) {
    if (state.front == null) state.front = nearestDepth;
    else state.front += (nearestDepth - state.front) * (1 - Math.pow(1 - FRONT_GLIDE, dt / 16.67));
  }
  const front = state.front ?? 0;
  const near = Math.max(0.1, front + cfg.startYears * unitsPerYear);
  fog.near = near;
  fog.far = near + Math.max(0.001, spanDepth);
  fog.color.set(cfg.color);
  fogUniforms.fogStrength.value = Math.min(1, Math.max(0, cfg.strength));
  fogUniforms.fogFalloff.value = Math.max(0, cfg.falloff);
}
