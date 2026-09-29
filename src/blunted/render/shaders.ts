// GLSL patches that make Three.js' MeshPhongMaterial light like the C++ deferred renderer
// (legacy/src/systems/graphics/rendering + public/data/media/shaders/*.frag):
//   lighting.frag     -> RE_Direct: wrapped ("scattering emulation") diffuse, Phong specular with
//                        exponent shininess * 128, shadows darken direct light to 25% (shadow.intensity 0.75)
//   ambient.frag      -> RE_IndirectDiffuse: 70% desaturated albedo * ambient (the blueish tint lives in
//                        the hemisphere light colours) * (1 + self-illumination)
//   simple.frag       -> alpha test at 0.12 (plus a mip-level alpha boost so nets don't vanish)
//   postprocess.frag  -> linear fog capped at 25% applied *before* tone mapping, and the optional
//                        'original' tone curve (slight desaturation + AlternateContrast S-curve + clamp)
// Light intensities carry the original's "brightness 2.0" factor, so no 1/PI Lambert normalisation here.

import * as THREE from 'three';

/** replaces <lights_phong_pars_fragment> */
export const FB_LIGHTS_PARS = /* glsl */ `
varying vec3 vViewPosition;

struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};

uniform float fbSelfIllumination;
#ifdef FB_ILLUMINATION_MAP
	uniform sampler2D fbIlluminationMap;
#endif
float fbIllumination = 0.0;

#ifdef USE_FOG
	uniform float fbFogMax;
#endif

void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {

	float nDotLD = dot( geometryNormal, directLight.direction );
	// scattering emulation: keep some nuance on the back of objects
	float scatter_nDotLD = pow( nDotLD * 0.5 + 0.5, 1.7 );
	float resulting_nDotLD = max( nDotLD, 0.0 ) * 0.6 + scatter_nDotLD * 0.4;

	reflectedLight.directDiffuse += resulting_nDotLD * directLight.color * material.diffuseColor;

	vec3 refl = reflect( - geometryViewDir, geometryNormal );
	float spec = pow( max( 0.0, dot( refl, directLight.direction ) ), material.specularShininess );
	reflectedLight.directSpecular += spec * material.specularStrength * material.specularColor * directLight.color;

}

void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {

	vec3 base = material.diffuseColor;
	vec3 baseDesaturated = vec3( ( base.r + base.g + base.b ) / 3.0 );
	reflectedLight.indirectDiffuse += irradiance * ( baseDesaturated * 0.7 + base * 0.3 ) * ( 1.0 + fbIllumination );

}

#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong
`;

/** appended after <lights_phong_fragment> (inside main, before the light loop) */
export const FB_ILLUMINATION = /* glsl */ `
fbIllumination = fbSelfIllumination;
#if defined( FB_ILLUMINATION_MAP ) && defined( USE_MAP )
	fbIllumination = texture2D( fbIlluminationMap, vMapUv ).r;
#endif
`;

/**
 * inserted before <alphatest_fragment>: thin alpha-tested details (goal nets, fences, crowd) lose
 * coverage in the lower mip levels and vanish in the distance; scaling alpha by the mip level keeps
 * them (see Ben Golus, "Anti-aliased Alpha Test: The Esoteric Alpha To Coverage")
 */
export const FB_ALPHA_MIP = /* glsl */ `
#if defined( USE_ALPHATEST ) && defined( USE_MAP )
	{
		vec2 fbTexel = vMapUv * vec2( textureSize( map, 0 ) );
		vec2 fbDx = dFdx( fbTexel );
		vec2 fbDy = dFdy( fbTexel );
		float fbMipLevel = max( 0.0, 0.5 * log2( max( dot( fbDx, fbDx ), dot( fbDy, fbDy ) ) ) );
		diffuseColor.a *= 1.0 + fbMipLevel * 0.25;
	}
#endif
`;

/** inserted before <tonemapping_fragment>; <fog_fragment> is removed */
export const FB_FOG = /* glsl */ `
#ifdef USE_FOG
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fbFogMax * saturate( ( vFogDepth - fogNear ) / ( fogFar - fogNear ) ) );
#endif
`;

/** body for THREE.CustomToneMapping: postprocess.frag's colour grading */
const FB_CUSTOM_TONEMAPPING = /* glsl */ `vec3 CustomToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	float lum = dot( color, vec3( 0.2125, 0.7154, 0.0721 ) );
	color = mix( vec3( lum ), color, 0.95 );
	color = color * 0.7 + ( 0.5 - 0.5 * cos( clamp( color, 0.0, 1.0 ) * 3.14159265 ) ) * 0.3;
	return clamp( color, 0.0, 1.0 );
}`;

let customToneMappingInstalled = false;

/** installs the 'original' tone curve as THREE.CustomToneMapping (global to the three module, idempotent) */
export function InstallCustomToneMapping(): void {
  if (customToneMappingInstalled) return;
  const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
  const stub = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
  if (chunk.includes(stub)) THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(stub, FB_CUSTOM_TONEMAPPING);
  customToneMappingInstalled = true;
}

/** patches a MeshPhongMaterial program (use from onBeforeCompile) */
export function PatchPhongShader(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <lights_phong_pars_fragment>', FB_LIGHTS_PARS)
    .replace('#include <alphatest_fragment>', FB_ALPHA_MIP + '\n#include <alphatest_fragment>')
    .replace('#include <lights_phong_fragment>', '#include <lights_phong_fragment>\n' + FB_ILLUMINATION)
    .replace('#include <fog_fragment>', '')
    .replace('#include <tonemapping_fragment>', FB_FOG + '\n#include <tonemapping_fragment>');
}

export const SKY_VERTEX = /* glsl */ `
varying vec3 vWorldDirection;
void main() {
	vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
	vWorldDirection = worldPosition.xyz - cameraPosition;
	gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

// z-up gradient sky; the horizon colour is the original's fog/background colour (0.85, 0.85, 0.9)
export const SKY_FRAGMENT = /* glsl */ `
uniform vec3 zenithColor;
uniform vec3 horizonColor;
uniform vec3 groundColor;
uniform vec3 sunDirection;
uniform vec3 sunColor;
varying vec3 vWorldDirection;
void main() {
	vec3 d = normalize( vWorldDirection );
	float h = d.z;
	vec3 col = h > 0.0 ? mix( horizonColor, zenithColor, pow( h, 0.6 ) ) : mix( horizonColor, groundColor, pow( min( - h * 3.0, 1.0 ), 0.7 ) );
	float s = max( dot( d, sunDirection ), 0.0 );
	col += sunColor * ( pow( s, 900.0 ) * 6.0 + pow( s, 24.0 ) * 0.15 );
	gl_FragColor = vec4( col, 1.0 );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`;
