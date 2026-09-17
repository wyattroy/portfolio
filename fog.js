/**
 * fog.js — tiles fade toward the background as they recede into the past.
 *
 * The fade is front-loaded: most of it happens just behind the newest projects,
 * then it eases off toward the oldest, so the last couple of years read as their
 * own cluster in front of a softer past. three.js's built-in fog only fades in a
 * straight line, so every fogged material gets this curve patched into its
 * shader (installFogCurve). Distances are re-aimed every frame relative to the
 * graph, not the camera, so the look holds at any zoom or rotation.
 *
 * The "Bounce & Fog Tuner" artifact runs this same code and exports FOG.
 */

export const FOG = {
  startYears: 0,       // how far behind the newest project the fog begins, in years
  strength: 0.65,      // how faded the oldest project is (0 = no fog, 1 = gone into the background)
  falloff: 4,          // 0 = even fade front to back; higher = more of the fade right behind the newest work
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
  // fogNear = where the fog starts, fogFar = depth of the oldest project
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

// Per frame. depthNewest / depthOldest: camera-forward distance to the newest
// and oldest tiles. unitsPerYear: time-axis world units per year.
export function updateFog(fog, cfg, depthNewest, depthOldest, unitsPerYear) {
  const near = Math.max(0.1, depthNewest + cfg.startYears * unitsPerYear);
  fog.near = near;
  fog.far = Math.max(near + 0.001, depthOldest);
  fog.color.set(cfg.color);
  fogUniforms.fogStrength.value = Math.min(1, Math.max(0, cfg.strength));
  fogUniforms.fogFalloff.value = Math.max(0, cfg.falloff);
}
