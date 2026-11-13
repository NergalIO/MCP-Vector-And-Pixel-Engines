// Unity (6 / 2022+, URP 2D или встроенный конвейер): экспорт сцены готовым префабом.
//
// Слои запекаются в PNG так же, как для Godot (mcp/layers.mjs): эффекты Kontur — внутри картинок.
// Дальше пишутся родные файлы Unity с постоянными GUID (повторный экспорт в то же место не рвёт ссылки):
//   Layers/*.png + .meta     — спрайты (Single, опора слева сверху, без сжатия; «ближайший» фильтр в пиксельном режиме;
//                              карты нормалей — вторичная текстура _NormalMap для 2D-света URP)
//   Animations/<клип>.anim   — по клипу Kontur: кадры всех анимированных слоёв синхронно
//   <Имя>.controller          — Animator: состояние на клип, переходы «потом» (next)
//   <Имя>.prefab              — SortingGroup + Animator + KonturPlayer, слои — SpriteRenderer по порядку,
//                              свет — Light2D (точечные + общий «Ambient»), режимы наложения — материал Kontur/Sprite Blend
//   Kontur/Runtime/KonturPlayer.cs, KonturBlend.shader — один раз на проект (GUID постоянные)
// Формат файлов снят с Unity 6000.6 (эталон, который Unity пишет сам) и проверяется импортом в Unity.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseColor } from '../engine/kontur.js';
import { bakeLayers, layersManifest, SANE } from './layers.mjs';
import { posixRel, writeFileEnsured } from './paths.mjs';
import { ambientRGB } from './scene_util.mjs';
import { cleanExportDir, writeExportList, legacyNote } from './export_dir.mjs';
import { crc32, guidOf, fileIdOf, unityAssetsRoot, unityColorSpace, assetKey, fitUrpLight, urpAmbient, UNITY_BLEND, num, ystr } from './unity_common.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const UNITY_RUNTIME = {
  player: { file: 'KonturPlayer.cs', guid: guidOf('runtime/KonturPlayer.cs') },
  shader: { file: 'KonturBlend.shader', guid: guidOf('runtime/KonturBlend.shader') },
};
const URP = { light2d: '073797afb82c5a1438f328866b10b3f0', spriteLit: 'a97c105638bdf8b4a8650670310a4cd3', spriteUnlit: '9dfc825aed78fcd4ba02077103263b40' };
const HEAD = '%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n';
const ref = (fileID, guid, type) => (guid ? `{fileID: ${fileID}, guid: ${guid}, type: ${type}}` : `{fileID: ${fileID}}`);
const spriteRef = (guid) => ref(21300000, guid, 3);
const color = (c, a = 1) => `{r: ${num(c[0])}, g: ${num(c[1])}, b: ${num(c[2])}, a: ${num(a)}}`;

/* ---------------- .meta ---------------- */
const nativeMeta = (guid, mainId) => `fileFormatVersion: 2\nguid: ${guid}\nNativeFormatImporter:\n  externalObjects: {}\n  mainObjectFileID: ${mainId}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n`;
const prefabMeta = (guid) => `fileFormatVersion: 2\nguid: ${guid}\nPrefabImporter:\n  externalObjects: {}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n`;
const monoMeta = (guid) => `fileFormatVersion: 2\nguid: ${guid}\nMonoImporter:\n  externalObjects: {}\n  serializedVersion: 2\n  defaultReferences: []\n  executionOrder: 0\n  icon: {instanceID: 0}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n`;
const shaderMeta = (guid) => `fileFormatVersion: 2\nguid: ${guid}\nShaderImporter:\n  externalObjects: {}\n  defaultTextures: []\n  nonModifiableTextures: []\n  preprocessorOverride: 0\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n`;
const jsonMeta = (guid) => `fileFormatVersion: 2\nguid: ${guid}\nTextScriptImporter:\n  externalObjects: {}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n`;

/** Импорт PNG: спрайт (Single, опора слева сверху) или карта нормалей. */
function textureMeta({ guid, sprite = true, ppu = 100, point = false, normalGuid = null, size = 2048 }) {
  const maxSize = Math.min(16384, Math.max(2048, 2 ** Math.ceil(Math.log2(Math.max(1, size)))));
  return `fileFormatVersion: 2
guid: ${guid}
TextureImporter:
  internalIDToNameTable: []
  externalObjects: {}
  serializedVersion: 13
  mipmaps:
    mipMapMode: 0
    enableMipMap: 0
    sRGBTexture: ${sprite ? 1 : 0}
    linearTexture: 0
    fadeOut: 0
    borderMipMap: 0
    mipMapsPreserveCoverage: 0
    alphaTestReferenceValue: 0.5
    mipMapFadeDistanceStart: 1
    mipMapFadeDistanceEnd: 3
  bumpmap:
    convertToNormalMap: 0
    externalNormalMap: 0
    heightScale: 0.25
    normalMapFilter: 0
    flipGreenChannel: 0
  isReadable: 0
  streamingMipmaps: 0
  streamingMipmapsPriority: 0
  vTOnly: 0
  ignoreMipmapLimit: 0
  grayScaleToAlpha: 0
  generateCubemap: 6
  cubemapConvolution: 0
  seamlessCubemap: 0
  textureFormat: 1
  maxTextureSize: ${maxSize}
  textureSettings:
    serializedVersion: 2
    filterMode: ${point ? 0 : 1}
    aniso: 1
    mipBias: 0
    wrapU: 1
    wrapV: 1
    wrapW: 1
  nPOTScale: 0
  lightmap: 0
  compressionQuality: 50
  spriteMode: ${sprite ? 1 : 0}
  spriteExtrude: 1
  spriteMeshType: 0
  alignment: 1
  spritePivot: {x: 0, y: 1}
  spritePixelsToUnits: ${num(ppu)}
  spriteBorder: {x: 0, y: 0, z: 0, w: 0}
  spriteGenerateFallbackPhysicsShape: 0
  alphaUsage: 1
  alphaIsTransparency: ${sprite ? 1 : 0}
  spriteTessellationMethod: 0
  spriteTessellationDetail: -1
  spriteGeometrySubdivision: -1
  textureType: ${sprite ? 8 : 1}
  textureShape: 1
  singleChannelComponent: 0
  flipbookRows: 1
  flipbookColumns: 1
  maxTextureSizeSet: 0
  compressionQualitySet: 0
  textureFormatSet: 0
  ignorePngGamma: 0
  applyGammaDecoding: 0
  swizzle: 50462976
  cookieLightType: 0
  platformSettings:
  - serializedVersion: 4
    buildTarget: DefaultTexturePlatform
    maxTextureSize: ${maxSize}
    resizeAlgorithm: 0
    textureFormat: -1
    textureCompression: 0
    compressionQuality: 50
    crunchedCompression: 0
    allowsAlphaSplitting: 0
    overridden: 0
    ignorePlatformSupport: 0
    androidETC2FallbackOverride: 0
    forceMaximumCompressionQuality_BC6H_BC7: 0
  spriteSheet:
    serializedVersion: 2
    sprites: []
    outline: []
    customData:
    physicsShape: []
    bones: []
    spriteID: ${sprite ? guid.slice(0, 16) + '0800000000000000' : ''}
    internalID: 0
    vertices: []
    indices:
    edges: []
    weights: []
    secondaryTextures:${normalGuid ? `\n    - texture: ${ref(2800000, normalGuid, 3)}\n      name: _NormalMap` : ' []'}
    spriteCustomMetadata:
      entries: []
    nameFileIdTable: {}
  mipmapLimitGroupName:
  pSDRemoveMatte: 0
  userData:
  assetBundleName:
  assetBundleVariant:
`;
}

/* ---------------- объекты префаба ---------------- */
function gameObject(id, name, comps, active = true) {
  return `--- !u!1 &${id}
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
${comps.map((c) => `  - component: {fileID: ${c}}`).join('\n')}
  m_Layer: 0
  m_Name: ${ystr(name)}
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: ${active ? 1 : 0}
`;
}
function transform(id, go, pos, father, children = []) {
  return `--- !u!4 &${id}
Transform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: ${go}}
  serializedVersion: 2
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: ${num(pos[0])}, y: ${num(pos[1])}, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_ConstrainProportionsScale: 0
  m_Children:${children.length ? '\n' + children.map((c) => `  - {fileID: ${c}}`).join('\n') : ' []'}
  m_Father: {fileID: ${father || 0}}
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
`;
}
function spriteRenderer(id, go, { sprite, material, order, size }) {
  return `--- !u!212 &${id}
SpriteRenderer:
  serializedVersion: 3
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: ${go}}
  m_Enabled: 1
  m_CastShadows: 0
  m_ReceiveShadows: 0
  m_DynamicOccludee: 1
  m_StaticShadowCaster: 0
  m_MotionVectors: 1
  m_LightProbeUsage: 1
  m_ReflectionProbeUsage: 1
  m_RayTracingMode: 0
  m_RayTraceProcedural: 0
  m_RayTracingAccelStructBuildFlagsOverride: 0
  m_RayTracingAccelStructBuildFlags: 1
  m_SmallMeshCulling: 1
  m_ForceMeshLod: -1
  m_MeshLodSelectionBias: 0
  m_RenderingLayerMask: 1
  m_RendererPriority: 0
  m_Materials:
  - ${material}
  m_StaticBatchInfo:
    firstSubMesh: 0
    subMeshCount: 0
  m_StaticBatchRoot: {fileID: 0}
  m_ProbeAnchor: {fileID: 0}
  m_LightProbeVolumeOverride: {fileID: 0}
  m_ScaleInLightmap: 1
  m_ReceiveGI: 1
  m_PreserveUVs: 0
  m_IgnoreNormalsForChartDetection: 0
  m_ImportantGI: 0
  m_StitchLightmapSeams: 1
  m_SelectedEditorRenderState: 0
  m_MinimumChartSize: 4
  m_AutoUVMaxDistance: 0.5
  m_AutoUVMaxAngle: 89
  m_LightmapParameters: {fileID: 0}
  m_GlobalIlluminationMeshLod: 0
  m_SortingLayerID: 0
  m_SortingLayer: 0
  m_SortingOrder: ${order}
  m_MaskInteraction: 0
  m_Sprite: ${sprite}
  m_Color: {r: 1, g: 1, b: 1, a: 1}
  m_FlipX: 0
  m_FlipY: 0
  m_DrawMode: 0
  m_Size: {x: ${num(size[0])}, y: ${num(size[1])}}
  m_AdaptiveModeThreshold: 0.5
  m_SpriteTileMode: 0
  m_WasSpriteAssigned: 1
  m_SpriteSortPoint: 0
  m_BlendShapeWeights: []
`;
}
function light2D(id, go, rid, { type, rgb, intensity, falloff = 0.5, outer = 1, normalQuality = 2, normalDistance = 3 }) {
  return `--- !u!114 &${id}
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: ${go}}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: ${ref(11500000, URP.light2d, 3)}
  m_Name:
  m_EditorClassIdentifier: Unity.RenderPipelines.Universal.2D.Runtime::UnityEngine.Rendering.Universal.Light2D
  m_ComponentVersion: 4
  m_LightType: ${type}
  m_BlendStyleIndex: 0
  m_Light2DProvider:
    rid: -2
  m_SelectionSources:
    rid: ${rid}
  m_FalloffIntensity: ${num(falloff)}
  m_Color: ${color(rgb)}
  m_Intensity: ${num(intensity)}
  m_LightVolumeIntensity: 1
  m_LightVolumeEnabled: 0
  m_ApplyToSortingLayers: 00000000i
  m_LightCookieSprite: {fileID: 0}
  m_DeprecatedPointLightCookieSprite: {fileID: 0}
  m_LightOrder: 0
  m_AlphaBlendOnOverlap: 0
  m_OverlapOperation: 0
  m_NormalMapDistance: ${num(normalDistance)}
  m_NormalMapQuality: ${normalQuality}
  m_UseNormalMap: 0
  m_ShadowsEnabled: 0
  m_ShadowIntensity: 0.75
  m_ShadowSoftness: 0.3
  m_ShadowSoftnessFalloffIntensity: 0.5
  m_ShadowVolumeIntensityEnabled: 0
  m_ShadowVolumeIntensity: 0.75
  m_RenderingLayersMask:
    serializedVersion: 0
    m_Bits: 1
  m_LocalBounds:
    m_Center: {x: 0, y: 0, z: 0}
    m_Extent: {x: 0, y: 0, z: 0}
  m_PointLightInnerAngle: 360
  m_PointLightOuterAngle: 360
  m_PointLightInnerRadius: 0
  m_PointLightOuterRadius: ${num(outer)}
  m_ShapeLightParametricSides: 5
  m_ShapeLightParametricAngleOffset: 0
  m_ShapeLightParametricRadius: 1
  m_ShapeLightFalloffSize: 0.5
  m_ShapeLightFalloffOffset: {x: 0, y: 0}
  m_ShapePath:
  - {x: -0.5, y: -0.5, z: 0}
  - {x: 0.5, y: -0.5, z: 0}
  - {x: 0.5, y: 0.5, z: 0}
  - {x: -0.5, y: 0.5, z: 0}
  references:
    version: 2
    RefIds:
    - rid: -2
      type: {class: , ns: , asm: }
    - rid: ${rid}
      type: {class: Light2DProviderSources, ns: UnityEngine.Rendering.Universal, asm: Unity.RenderPipelines.Universal.2D.Runtime}
      data:
        m_SelectedHashCode: ${type}
        m_SelectedSource:
          rid: -2
        m_Provider2DCache:
          rid: -2
`;
}

/* ---------------- анимация ---------------- */
function animationClip({ name, fps, loop, length, curves }) {
  // curves: [{ path, keys: [{ time, sprite }] }]
  const pptr = curves.map((c) => `  - serializedVersion: 2
    curve:
${c.keys.map((k) => `    - time: ${num(k.time)}\n      value: ${spriteRef(k.sprite)}`).join('\n')}
    attribute: m_Sprite
    path: ${ystr(c.path)}
    classID: 212
    script: {fileID: 0}
    flags: 2`).join('\n');
  const bindings = curves.map((c) => `    - serializedVersion: 2
      path: ${crc32(c.path)}
      attribute: 0
      script: {fileID: 0}
      typeID: 212
      customType: 23
      isPPtrCurve: 1
      isIntCurve: 0
      isSerializeReferenceCurve: 0
      metaData: 0`).join('\n');
  const mapping = curves.flatMap((c) => c.keys.map((k) => `    - ${spriteRef(k.sprite)}`)).join('\n');
  return `${HEAD}--- !u!74 &7400000
AnimationClip:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_Name: ${ystr(name)}
  serializedVersion: 8
  m_Legacy: 0
  m_Compressed: 0
  m_UseHighQualityCurve: 1
  m_RotationCurves: []
  m_CompressedRotationCurves: []
  m_EulerCurves: []
  m_PositionCurves: []
  m_ScaleCurves: []
  m_FloatCurves: []
  m_PPtrCurves:${curves.length ? '\n' + pptr : ' []'}
  m_SampleRate: ${num(fps)}
  m_WrapMode: 0
  m_Bounds:
    m_Center: {x: 0, y: 0, z: 0}
    m_Extent: {x: 0, y: 0, z: 0}
  m_ClipBindingConstant:
    genericBindings:${curves.length ? '\n' + bindings : ' []'}
    pptrCurveMapping:${mapping ? '\n' + mapping : ' []'}
  m_AnimationClipSettings:
    serializedVersion: 2
    m_AdditiveReferencePoseClip: {fileID: 0}
    m_AdditiveReferencePoseTime: 0
    m_StartTime: 0
    m_StopTime: ${num(length)}
    m_OrientationOffsetY: 0
    m_Level: 0
    m_CycleOffset: 0
    m_HasAdditiveReferencePose: 0
    m_LoopTime: ${loop ? 1 : 0}
    m_LoopBlend: 0
    m_LoopBlendOrientation: 0
    m_LoopBlendPositionY: 0
    m_LoopBlendPositionXZ: 0
    m_KeepOriginalOrientation: 0
    m_KeepOriginalPositionY: 1
    m_KeepOriginalPositionXZ: 0
    m_HeightFromFeet: 0
    m_Mirror: 0
  m_EditorCurves: []
  m_EulerEditorCurves: []
  m_HasGenericRootTransform: 0
  m_HasMotionFloatCurves: 0
  m_Events: []
`;
}
function animatorController(name, key, states) {
  // states: [{ name, clipGuid, next }]
  const sid = (n) => fileIdOf(`${key}/state/${n}`), tid = (n) => fileIdOf(`${key}/transition/${n}`), smId = fileIdOf(`${key}/sm`);
  const out = [HEAD];
  states.forEach((s, i) => {
    const tr = s.next && states.some((x) => x.name === s.next) ? [tid(s.name)] : [];
    out.push(`--- !u!1102 &${sid(s.name)}
AnimatorState:
  serializedVersion: 6
  m_ObjectHideFlags: 1
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_Name: ${ystr(s.name)}
  m_Speed: 1
  m_CycleOffset: 0
  m_Transitions:${tr.length ? `\n  - {fileID: ${tr[0]}}` : ' []'}
  m_StateMachineBehaviours: []
  m_Position: {x: 50, y: 50, z: 0}
  m_IKOnFeet: 0
  m_WriteDefaultValues: 1
  m_Mirror: 0
  m_SpeedParameterActive: 0
  m_MirrorParameterActive: 0
  m_CycleOffsetParameterActive: 0
  m_TimeParameterActive: 0
  m_Motion: ${ref(7400000, s.clipGuid, 2)}
  m_Tag:
  m_SpeedParameter:
  m_MirrorParameter:
  m_CycleOffsetParameter:
  m_TimeParameter:
`);
    if (tr.length) out.push(`--- !u!1101 &${tr[0]}
AnimatorStateTransition:
  m_ObjectHideFlags: 1
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_Name:
  m_Conditions: []
  m_DstStateMachine: {fileID: 0}
  m_DstState: {fileID: ${sid(s.next)}}
  m_Solo: 0
  m_Mute: 0
  m_IsExit: 0
  serializedVersion: 3
  m_TransitionDuration: 0
  m_TransitionOffset: 0
  m_ExitTime: 1
  m_HasExitTime: 1
  m_HasFixedDuration: 1
  m_InterruptionSource: 0
  m_OrderedInterruption: 1
  m_CanTransitionToSelf: 1
`);
  });
  out.push(`--- !u!91 &9100000
AnimatorController:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_Name: ${ystr(name)}
  serializedVersion: 6
  m_AnimatorParameters: []
  m_AnimatorLayers:
  - serializedVersion: 5
    m_Name: Base Layer
    m_StateMachine: {fileID: ${smId}}
    m_Mask: {fileID: 0}
    m_Motions: []
    m_Behaviours: []
    m_BlendingMode: 0
    m_SyncedLayerIndex: -1
    m_DefaultWeight: 0
    m_IKPass: 0
    m_SyncedLayerAffectsTiming: 0
    m_Controller: {fileID: 9100000}
  m_EvaluateTransitionsOnStart: 1
--- !u!1107 &${smId}
AnimatorStateMachine:
  serializedVersion: 7
  m_ObjectHideFlags: 1
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_Name: Base Layer
  m_ChildStates:
${states.map((s, i) => `  - serializedVersion: 1\n    m_State: {fileID: ${sid(s.name)}}\n    m_Position: {x: ${300 + (i % 3) * 220}, y: ${Math.floor(i / 3) * 70}, z: 0}`).join('\n')}
  m_ChildStateMachines: []
  m_AnyStateTransitions: []
  m_EntryTransitions: []
  m_StateMachineTransitions: {}
  m_StateMachineBehaviours: []
  m_AnyStatePosition: {x: 50, y: 20, z: 0}
  m_EntryPosition: {x: 50, y: 120, z: 0}
  m_ExitPosition: {x: 800, y: 120, z: 0}
  m_ParentStateMachinePosition: {x: 800, y: 20, z: 0}
  m_DefaultState: {fileID: ${sid(states[0].name)}}
`);
  return out.join('');
}
function blendMaterial(name, mode) {
  const b = UNITY_BLEND[mode];
  return `${HEAD}--- !u!21 &2100000
Material:
  serializedVersion: 8
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_Name: ${ystr(name)}
  m_Shader: ${ref(4800000, UNITY_RUNTIME.shader.guid, 3)}
  m_Parent: {fileID: 0}
  m_ModifiedSerializedProperties: 0
  m_ValidKeywords: []
  m_InvalidKeywords: []
  m_LightmapFlags: 4
  m_EnableInstancingVariants: 0
  m_DoubleSidedGI: 0
  m_CustomRenderQueue: -1
  stringTagMap: {}
  disabledShaderPasses: []
  m_LockedProperties:
  m_SavedProperties:
    serializedVersion: 3
    m_TexEnvs:
    - _MainTex:
        m_Texture: {fileID: 0}
        m_Scale: {x: 1, y: 1}
        m_Offset: {x: 0, y: 0}
    m_Ints: []
    m_Floats:
    - _BlendOp: ${b.op}
    - _Curve: ${b.curve ?? 1}
    - _DstBlend: ${b.dst}
    - _Prep: ${b.prep}
    - _SrcBlend: ${b.src}
    m_Colors:
    - _Color: {r: 1, g: 1, b: 1, a: 1}
  m_BuildTextureStacks: []
  m_AllowLocking: 1
`;
}

/**
 * exportUnity(scene, dir, opts) — dir: папка внутри Assets проекта Unity (например Assets/Kontur/room) или любая папка.
 * opts: fps (12), scale, normals, clips, lights, title — как у Godot;
 *       ppu (100 — пикселей сцены на единицу Unity), origin ('center' | 'top-left'),
 *       pipeline ('urp' | 'builtin'), colorSpace ('linear' | 'gamma'; по умолчанию — из ProjectSettings проекта, иначе linear),
 *       runtimeDir (куда положить KonturPlayer.cs и шейдер), log
 */
export async function exportUnity(scene, dir, opts = {}) {
  const pipeline = opts.pipeline === 'builtin' ? 'builtin' : 'urp';
  const ppu = opts.ppu > 0 ? opts.ppu : 100;
  // имя префаба и контроллера: Unity понимает любые буквы, убираем только запрещённые в именах файлов знаки
  // eslint-disable-next-line no-control-regex -- управляющие символы в имени файла запрещены
  const title = String(opts.title || 'KonturScene').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 60) || 'KonturScene';
  const assetsRoot = unityAssetsRoot(dir);
  const colorSpace = opts.colorSpace === 'gamma' || opts.colorSpace === 'linear' ? opts.colorSpace : unityColorSpace(assetsRoot);
  const keyOf = (f) => assetKey(f, assetsRoot);
  const guidFor = (f) => guidOf(keyOf(f));
  // файлы прошлого экспорта — только свои, по списку: в Assets/Materials, Assets/Animations проекта лежат чужие ассеты
  const prev = cleanExportDir(dir, { markers: ['Layers', 'Animations', 'Materials'] });
  const b = await bakeLayers(scene, dir, { ...opts, lights: pipeline === 'urp' ? opts.lights : false, tag: 'unity', layersDir: 'Layers' });
  const { W, H, px, scale, clips, fpsOf, clipStem, nodes, lights, frameCount, t0 } = b;
  const texPPU = ppu * scale;
  const [ox, oy] = opts.origin === 'top-left' ? [0, 0] : [W / 2, H / 2];
  const toUnity = (x, y) => [(x - ox) / ppu, -(y - oy) / ppu];
  const point = !!px && !px.aa;
  const written = [], metas = [];
  const put = (f, text, meta) => { if (text != null) writeFileEnsured(f, text); if (meta) { writeFileEnsured(f + '.meta', meta); metas.push(f + '.meta'); } written.push(f); };

  // 1. текстуры: .meta с постоянными GUID
  const spriteGuid = new Map();
  const texMeta = (file, normal, w, h) => {
    const g = guidFor(file);
    spriteGuid.set(file, g);
    let ng = null;
    if (normal) { ng = guidFor(normal); put(normal, null, textureMeta({ guid: ng, sprite: false, point, size: Math.max(w, h) })); }
    put(file, null, textureMeta({ guid: g, sprite: true, ppu: texPPU, point, normalGuid: ng, size: Math.max(w, h) }));
    return g;
  };
  for (const n of nodes) {
    if (n.type === 'static') texMeta(n.file, n.normal, n.width, n.height);
    else for (const a of n.anims) for (const f of a.frames) texMeta(f.file, f.normal, n.width, n.height);
  }

  // 2. общие скрипт и шейдер (один раз на проект)
  const runtimeDir = opts.runtimeDir || (assetsRoot ? join(assetsRoot, 'Kontur', 'Runtime') : join(dir, 'KonturRuntime'));
  put(join(runtimeDir, UNITY_RUNTIME.player.file), readFileSync(join(HERE, 'unity', UNITY_RUNTIME.player.file), 'utf8'), monoMeta(UNITY_RUNTIME.player.guid));
  const blendModes = [...new Set(nodes.map((n) => n.blend).filter((m) => m && UNITY_BLEND[m]))];
  if (blendModes.length || existsSync(join(runtimeDir, UNITY_RUNTIME.shader.file))) put(join(runtimeDir, UNITY_RUNTIME.shader.file), readFileSync(join(HERE, 'unity', UNITY_RUNTIME.shader.file), 'utf8'), shaderMeta(UNITY_RUNTIME.shader.guid));

  // 3. материалы режимов наложения
  const matRef = new Map();
  for (const m of blendModes) {
    const f = join(dir, 'Materials', `Kontur_${SANE(m)}.mat`);
    const g = guidFor(f);
    put(f, blendMaterial(`Kontur_${SANE(m)}`, m), nativeMeta(g, 2100000));
    matRef.set(m, ref(2100000, g, 2));
  }
  const defaultMat = pipeline === 'urp' ? ref(2100000, URP.spriteLit, 2) : ref(10754, '0000000000000000f000000000000000', 0);
  const unknownBlend = nodes.filter((n) => n.blend && !UNITY_BLEND[n.blend]).map((n) => n.blend);

  // 4. клипы → .anim; контроллер
  const animated = nodes.filter((n) => n.type === 'anim');
  const clipFiles = [];
  if (animated.length) {
    for (const c of clips) {
      const fps = fpsOf(c), nFrames = Math.max(1, Math.round((c.end - c.start) * fps));
      const curves = animated.map((n) => {
        const a = n.anims.find((x) => x.name === c.name);
        const keys = [];
        let i = 0;
        for (const f of a?.frames || []) { keys.push({ time: i / fps, sprite: spriteGuid.get(f.file) }); i += f.duration; }
        // последний ключ на последнем кадре — длина клипа в Unity = последний ключ + 1 кадр
        if (keys.length && keys[keys.length - 1].time < (nFrames - 1) / fps - 1e-9) keys.push({ time: (nFrames - 1) / fps, sprite: keys[keys.length - 1].sprite });
        return { path: n.name, keys };
      }).filter((cv) => cv.keys.length);
      const f = join(dir, 'Animations', `${clipStem.get(c.name)}.anim`);
      const g = guidFor(f);
      put(f, animationClip({ name: c.name, fps, loop: c.loop !== false, length: nFrames / fps, curves }), nativeMeta(g, 7400000));
      clipFiles.push({ name: c.name, clipGuid: g, next: c.next });
    }
  }
  let controllerGuid = null;
  if (clipFiles.length) {
    const f = join(dir, `${title}.controller`);
    controllerGuid = guidFor(f);
    put(f, animatorController(title, keyOf(f), clipFiles), nativeMeta(controllerGuid, 9100000));
  }

  // 5. префаб
  const prefabFile = join(dir, `${title}.prefab`);
  const pk = keyOf(prefabFile);
  const id = (...k) => fileIdOf(`${pk}/${k.join('/')}`);
  const rootGo = id('root', 'go'), rootTr = id('root', 'tr');
  const docs = [], childTr = [], stateObjects = [];
  nodes.forEach((n, i) => {
    const go = id('layer', n.name, 'go'), tr = id('layer', n.name, 'tr'), sr = id('layer', n.name, 'sr');
    const first = n.type === 'static' ? n.file : n.anims[0]?.frames[0]?.file;
    const material = n.blend && matRef.has(n.blend) ? matRef.get(n.blend) : defaultMat;
    docs.push(gameObject(go, n.name, [tr, sr], n.state ? n.state.visible : true));
    docs.push(transform(tr, go, toUnity(n.x, n.y), rootTr));
    docs.push(spriteRenderer(sr, go, { sprite: spriteRef(spriteGuid.get(first)), material, order: i, size: [n.w / ppu, n.h / ppu] }));
    childTr.push(tr);
    if (n.state) stateObjects.push({ ...n.state, go });
  });
  let lightCount = 0;
  if (pipeline === 'urp' && lights.length) {
    const amb = ambientRGB(scene);
    const linear = colorSpace === 'linear', ambW = urpAmbient(amb, linear);
    const go = id('ambient', 'go'), tr = id('ambient', 'tr'), lc = id('ambient', 'light');
    docs.push(gameObject(go, 'Ambient', [tr, lc]));
    docs.push(transform(tr, go, [0, 0], rootTr));
    docs.push(light2D(lc, go, BigInt(id('ambient', 'rid')) % 9007199254740991n, { type: 4, rgb: ambW, intensity: 1 }));
    childTr.push(tr);
    for (const l of lights) {
      const nm = `Light_${l.name}`;
      const lg = id('light', nm, 'go'), lt = id('light', nm, 'tr'), ll = id('light', nm, 'light');
      const c = parseColor(l.color) || [1, 1, 1];
      const fit = fitUrpLight({ ambient: amb, ambientW: ambW, color: c, energy: +l.energy || 0, falloff: l.falloff ?? 1, z: l.z ?? 80, radius: l.radius, normals: b.normals, linear });
      docs.push(gameObject(lg, nm, [lt, ll], l.state ? l.state.visible : true));
      docs.push(transform(lt, lg, toUnity(l.x, l.y), rootTr));
      docs.push(light2D(ll, lg, BigInt(id('light', nm, 'rid')) % 9007199254740991n, {
        type: 3, rgb: fit.color, intensity: fit.intensity, falloff: fit.falloffIntensity, outer: Math.max(0.01, l.radius / ppu),
        normalQuality: b.normals ? 1 : 2, normalDistance: Math.max(0.01, (l.z ?? 80) / ppu),
      }));
      childTr.push(lt);
      if (l.state) stateObjects.push({ ...l.state, go: lg });
      lightCount++;
    }
  }
  const rootComps = [rootTr, id('root', 'sg')];
  if (controllerGuid) rootComps.push(id('root', 'animator'));
  rootComps.push(id('root', 'player'));
  const root = [gameObject(rootGo, title, rootComps), transform(rootTr, rootGo, [0, 0], 0, childTr),
    `--- !u!210 &${id('root', 'sg')}
SortingGroup:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: ${rootGo}}
  m_Enabled: 1
  m_SortingLayerID: 0
  m_SortingLayer: 0
  m_SortingOrder: 0
  m_SortAtRoot: 0
  m_Sort3DAs2D: 0
`];
  if (controllerGuid) root.push(`--- !u!95 &${id('root', 'animator')}
Animator:
  serializedVersion: 7
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: ${rootGo}}
  m_Enabled: 1
  m_Avatar: {fileID: 0}
  m_Controller: ${ref(9100000, controllerGuid, 2)}
  m_CullingMode: 0
  m_UpdateMode: 0
  m_ApplyRootMotion: 0
  m_LinearVelocityBlending: 0
  m_StabilizeFeet: 0
  m_AnimatePhysics: 0
  m_WarningMessage:
  m_HasTransformHierarchy: 1
  m_AllowConstantClipSamplingOptimization: 1
  m_KeepAnimatorStateOnDisable: 0
  m_WriteDefaultValuesOnDisable: 0
`);
  const groups = (scene.states || []).map((g) => `${g.name}=${g.default ?? Object.keys(g.values || {})[0]}`);
  const list = (items, f) => (items.length ? '\n' + items.map(f).join('\n') : ' []');
  root.push(`--- !u!114 &${id('root', 'player')}
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: ${rootGo}}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: ${ref(11500000, UNITY_RUNTIME.player.guid, 3)}
  m_Name:
  m_EditorClassIdentifier:
  clips:${list(clipFiles, (c) => `  - ${ystr(c.name)}`)}
  stateDefaults:${list(groups, (g) => `  - ${ystr(g)}`)}
  stateObjects:${list(stateObjects, (s) => `  - group: ${ystr(s.group)}\n    value: ${ystr(s.value)}\n    target: {fileID: ${s.go}}`)}
`);
  put(prefabFile, HEAD + [...root, ...docs].join(''), prefabMeta(guidFor(prefabFile)));

  // 6. описание слоёв
  const manifest = layersManifest(scene, dir, b, { target: 'unity', ppu, origin: opts.origin === 'top-left' ? 'top-left' : 'center', pipeline, colorSpace, prefab: `${title}.prefab` });
  const mf = join(dir, 'kontur_manifest.json');
  put(mf, JSON.stringify(manifest, null, 1), jsonMeta(guidFor(mf)));

  // список своих файлов (общий скрипт и шейдер вне папки экспорта в него не попадают и не удаляются)
  writeExportList(dir, [...b.files, ...b.files.map((f) => f + '.meta'), ...written, ...metas]);

  const stat = nodes.filter((n) => n.type === 'static').length;
  const notes = [];
  if (prev.legacy) notes.push(legacyNote(dir));
  if (!assetsRoot) notes.push(`Папка не внутри проекта Unity: скопируйте её в Assets целиком. ${posixRel(dir, runtimeDir) || runtimeDir} (скрипт и шейдер) нужна в проекте один раз — если она там уже есть, эту копию удалите, иначе будет два класса KonturPlayer.`);
  if (pipeline === 'builtin' && b.lights?.length === 0 && scene.nodes.some((n) => n.type === 'light')) notes.push('Свет не перенесён: во встроенном конвейере нет 2D-света (нужен URP).');
  if (blendModes.some((m) => !UNITY_BLEND[m].exact)) notes.push(`Режимы ${blendModes.filter((m) => !UNITY_BLEND[m].exact).join(', ')} переданы приблизительно (точно — multiply, screen).`);
  if (unknownBlend.length) notes.push(`Режимы ${[...new Set(unknownBlend)].join(', ')} в Unity не поддержаны — слой рисуется обычным.`);
  const summary = `Экспорт для Unity (${pipeline === 'urp' ? 'URP 2D' : 'встроенный конвейер'}): ${dir}
Префаб ${title}.prefab: слоёв ${nodes.length} (статичных ${stat}, анимированных ${nodes.length - stat}), PNG-кадров: ${frameCount}${clipFiles.length ? `, клипы (Animator): ${clipFiles.map((c) => `${c.name}@${fpsOf(clips.find((x) => x.name === c.name))}fps`).join(', ')}` : ''}${b.normals ? ', карты нормалей: да' : ''}${lightCount ? `, свет: ${lightCount} Light2D + Ambient (подобран под ${colorSpace === 'linear' ? 'Linear' : 'Gamma'})` : ''}${px ? `, пиксели ×${px.size} (фильтр Point)` : ''}${(scene.states || []).length ? `, состояния: ${scene.states.map((g) => g.name).join(', ')}` : ''}, ${((Date.now() - t0) / 1000).toFixed(1)}s.
Масштаб: ${ppu} px сцены = 1 единица Unity, ${opts.origin === 'top-left' ? 'левый верхний угол' : 'центр'} сцены — в точке префаба.
Из кода: GetComponent<KonturPlayer>().Play("клип"), SetState("группа", "вариант"). Скрипт и шейдер: ${posixRel(dir, runtimeDir) || runtimeDir}.${notes.length ? '\n' + notes.join('\n') : ''}`;
  return { summary, manifest, files: written };
}
