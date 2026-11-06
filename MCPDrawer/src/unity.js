// Unity export: sprite sheet PNG + TextureImporter .meta (pixel-art settings, sliced sprites)
// + one AnimationClip (.anim) per tag. Re-exports keep GUIDs and sprite IDs so scene references survive.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { encodePng } from './png.js';
import { renderSheet, frameList } from './render.js';

const newGuid = () => crypto.randomBytes(16).toString('hex');
const md5 = (s) => crypto.createHash('md5').update(s).digest();

// Deterministic signed int64 sprite id derived from texture guid + sprite name.
function internalId(guid, name) {
  const v = md5(`${guid}/${name}`).readBigInt64LE(0);
  return (v === 0n ? 1n : v).toString();
}

function readMeta(file) {
  if (!fs.existsSync(file)) return { guid: null, ids: {} };
  const txt = fs.readFileSync(file, 'utf8');
  const guid = txt.match(/^guid: ([0-9a-f]{32})/m)?.[1] || null;
  const ids = {};
  const table = txt.split(/^\s+nameFileIdTable:\s*$/m)[1];
  if (table) {
    for (const line of table.split('\n').slice(1)) {
      const m = line.match(/^ {6}(.+?): (-?\d+)\s*$/);
      if (!m) break;
      ids[m[1]] = m[2];
    }
  }
  return { guid, ids };
}

const PIVOTS = {
  center: [0, 0.5, 0.5], 'top-left': [1, 0, 1], top: [2, 0.5, 1], 'top-right': [3, 1, 1], left: [4, 0, 0.5],
  right: [5, 1, 0.5], 'bottom-left': [6, 0, 0], bottom: [7, 0.5, 0], 'bottom-right': [8, 1, 0],
};

function platform(target) {
  return `  - serializedVersion: 3
    buildTarget: ${target}
    maxTextureSize: 8192
    resizeAlgorithm: 0
    textureFormat: -1
    textureCompression: 0
    compressionQuality: 50
    crunchedCompression: 0
    allowsAlphaSplitting: 0
    overridden: 0
    androidETC2FallbackOverride: 0
    forceMaximumCompressionQuality_BC6H_BC7: 0`;
}

function textureMeta({ guid, sprites, ppu, alignment, pivot }) {
  const spriteYaml = sprites.map((s) => `    - serializedVersion: 2
      name: ${s.name}
      rect:
        serializedVersion: 2
        x: ${s.x}
        y: ${s.y}
        width: ${s.w}
        height: ${s.h}
      alignment: ${alignment}
      pivot: {x: ${pivot[0]}, y: ${pivot[1]}}
      border: {x: 0, y: 0, z: 0, w: 0}
      customData:
      outline: []
      physicsShape: []
      tessellationDetail: -1
      bones: []
      spriteID: ${md5(guid + s.name).toString('hex')}
      internalID: ${s.id}
      vertices: []
      indices:
      edges: []
      weights: []`).join('\n');
  return `fileFormatVersion: 2
guid: ${guid}
TextureImporter:
  internalIDToNameTable: []
  externalObjects: {}
  serializedVersion: 13
  mipmaps:
    mipMapMode: 0
    enableMipMap: 0
    sRGBTexture: 1
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
  maxTextureSize: 8192
  textureSettings:
    serializedVersion: 2
    filterMode: 0
    aniso: 1
    mipBias: 0
    wrapU: 1
    wrapV: 1
    wrapW: 1
  nPOTScale: 0
  lightmap: 0
  compressionQuality: 50
  spriteMode: 2
  spriteExtrude: 1
  spriteMeshType: 0
  alignment: ${alignment}
  spritePivot: {x: ${pivot[0]}, y: ${pivot[1]}}
  spritePixelsToUnits: ${ppu}
  spriteBorder: {x: 0, y: 0, z: 0, w: 0}
  spriteGenerateFallbackPhysicsShape: 1
  alphaUsage: 1
  alphaIsTransparency: 1
  spriteTessellationDetail: -1
  textureType: 8
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
${platform('DefaultTexturePlatform')}
${platform('Standalone')}
  spriteSheet:
    serializedVersion: 2
    sprites:
${spriteYaml}
    outline: []
    customData:
    physicsShape: []
    bones: []
    spriteID: ${md5(guid + '/sheet').toString('hex')}
    internalID: 0
    vertices: []
    indices:
    edges: []
    weights: []
    secondaryTextures: []
    spriteCustomMetadata:
      entries: []
    nameFileIdTable:
${sprites.map((s) => `      ${s.name}: ${s.id}`).join('\n')}
  mipmapLimitGroupName:
  pSDRemoveMatte: 0
  userData:
  assetBundleName:
  assetBundleVariant:
`;
}

function gcd(a, b) { return b ? gcd(b, a % b) : a; }

function animClip({ name, keys, guid, loop }) {
  const total = keys.reduce((t, k) => t + k.duration, 0);
  const g = keys.reduce((a, k) => gcd(a, Math.round(k.duration)), 0) || 100;
  const fps = 1000 / g;
  const sampleRate = Number.isInteger(fps) && fps <= 120 ? fps : 60;
  let t = 0;
  const curve = keys.map((k) => {
    const line = `    - time: ${+(t / 1000).toFixed(4)}\n      value: {fileID: ${k.id}, guid: ${guid}, type: 3}`;
    t += k.duration;
    return line;
  }).join('\n');
  const unique = [...new Set(keys.map((k) => k.id))];
  return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!74 &7400000
AnimationClip:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_Name: ${name}
  serializedVersion: 7
  m_Legacy: 0
  m_Compressed: 0
  m_UseHighQualityCurve: 1
  m_RotationCurves: []
  m_CompressedRotationCurves: []
  m_EulerCurves: []
  m_PositionCurves: []
  m_ScaleCurves: []
  m_FloatCurves: []
  m_PPtrCurves:
  - serializedVersion: 2
    curve:
${curve}
    attribute: m_Sprite
    path:
    classID: 212
    script: {fileID: 0}
    flags: 2
  m_SampleRate: ${sampleRate}
  m_WrapMode: 0
  m_Bounds:
    m_Center: {x: 0, y: 0, z: 0}
    m_Extent: {x: 0, y: 0, z: 0}
  m_ClipBindingConstant:
    genericBindings:
    - serializedVersion: 2
      path: 0
      attribute: 0
      script: {fileID: 0}
      typeID: 212
      customType: 23
      isPPtrCurve: 1
      isIntCurve: 0
      isSerializeReferenceCurve: 0
    pptrCurveMapping:
${unique.map((id) => `    - {fileID: ${id}, guid: ${guid}, type: 3}`).join('\n')}
  m_AnimationClipSettings:
    serializedVersion: 2
    m_AdditiveReferencePoseClip: {fileID: 0}
    m_AdditiveReferencePoseTime: 0
    m_StartTime: 0
    m_StopTime: ${+(total / 1000).toFixed(4)}
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

const nativeMeta = (guid) => `fileFormatVersion: 2
guid: ${guid}
NativeFormatImporter:
  externalObjects: {}
  mainObjectFileID: 7400000
  userData:
  assetBundleName:
  assetBundleVariant:
`;

export function exportUnity(sprite, { folder, name, ppu = 16, pivot = 'center', clips = true, loop = true, columns, padding = 0 } = {}) {
  if (!folder) throw new Error('folder is required (absolute path inside a Unity project\'s Assets folder)');
  folder = path.resolve(folder);
  if (!folder.split(path.sep).includes('Assets')) throw new Error('folder must be inside a Unity project\'s Assets folder');
  const base = String(name || sprite.id).replace(/[^\w.-]+/g, '_');
  fs.mkdirSync(folder, { recursive: true });
  const written = [];
  const write = (file, data) => { fs.writeFileSync(file, data); written.push(file); };

  const sheet = renderSheet(sprite, { scale: 1, columns: columns || Math.min(sprite.frames.length, 16), padding });
  const pngFile = path.join(folder, `${base}.png`);
  write(pngFile, encodePng(sheet.rgba, sheet.width, sheet.height));

  const old = readMeta(pngFile + '.meta');
  const guid = old.guid || newGuid();
  const sprites = sheet.rects.map((r, i) => {
    const sname = `${base}_${i}`;
    return { name: sname, id: old.ids[sname] || internalId(guid, sname), x: r.x, y: sheet.height - r.y - r.h, w: r.w, h: r.h, frame: r.frame };
  });
  const [alignment, px, py] = typeof pivot === 'object' ? [9, pivot.x ?? 0.5, pivot.y ?? 0.5] : PIVOTS[pivot] || PIVOTS.center;
  write(pngFile + '.meta', textureMeta({ guid, sprites, ppu, alignment, pivot: [px, py] }));

  const clipNames = [];
  if (clips) {
    const groups = sprite.tags.length
      ? sprite.tags.map((t) => ({ name: `${base}_${t.name}`, frames: frameList(sprite, { tag: t.name }) }))
      : [{ name: base, frames: frameList(sprite) }];
    for (const g of groups) {
      const file = path.join(folder, `${g.name.replace(/[^\w.-]+/g, '_')}.anim`);
      const keys = g.frames.map((f) => ({ id: sprites[f].id, duration: sprite.frames[f].duration }));
      write(file, animClip({ name: g.name, keys, guid, loop }));
      const animGuid = readMeta(file + '.meta').guid || newGuid();
      write(file + '.meta', nativeMeta(animGuid));
      clipNames.push(g.name);
    }
  }
  return { written, texture_guid: guid, sprites: sprites.map((s) => s.name), clips: clipNames, ppu };
}
