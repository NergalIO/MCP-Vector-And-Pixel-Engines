/*!
 * Kontur — движок векторной анимации
 * Ключевые кадры, морфинг путей, процедурные модификаторы, SVG-рендер.
 * Без зависимостей: работает в браузере и в Node.js. Исходники — engine/core/*.js;
 * этот файл — публичный API (одним файлом движок собирает mcp/bundle.mjs).
 */
export { clamp, lerp, noise3, noise1, fbm, hashStr, mat, vec3, roundTo, r3, r4, TAU, DEG, makeRng, pmStep } from './core/math.js';
export { easings, cubicBezier, springEase, resolveEase } from './core/ease.js';
export { parseColor, formatColor, mixColor, toLin, toGam } from './core/color.js';
export { parsePath, geomToPath, smoothGeom, toGeom, translateGeom, prepareMorph, lerpGeom, morph, measureGeom, pointAtFraction, deformGeom } from './core/geom.js';
export { interpolate, sampleKeys } from './core/tracks.js';
export { VERSION, propDefault, createScene, invalidate, invalidateNode, sceneMemo } from './core/model.js';
export { NODE_TYPES, NODE_DEFS, COMMON_PROPS, registerNodeType, typeProps, typeAnimated } from './core/types.js';
export { MODIFIERS, registerModifier, modIsStatic } from './core/modifiers.js';
export { compileSafeExpr, compileExpr, setExprPolicy, exprPolicy, allowExprFunctions, trustExpr, untrustAllExpr, exprAllowed, exprNeedsJS, sceneJSExprs, untrustedExprs, MAX_EXPR_STRING } from './core/expr.js';
export { RELIEF_DEFAULT, PASS_MODES, RENDER_MODES, modeInfo, registerRenderMode, surfaceAxes, resolveSurface, encodeNormal, encodePlaneD, encodeMatId, materialIndex, normalGradLayers, normalMapMatrix, CAMERA3D_DEFAULT, cameraModel } from './core/surface.js';
export { DITHER_PATTERNS } from './core/paint.js';
export { evaluate, symbolScene, instanceTime } from './core/evaluate.js';
export { nodeWorldMatrix, collectLights } from './core/rig.js';
export { quantizeRGBA, pixelOf } from './core/pixel.js';
export { treeToString, renderSVG, isSolid, dropUnderBg } from './core/svg.js';
export { DOMRenderer, Player } from './core/player.js';
export { CanvasRenderer, filterTemplate } from './core/canvas.js';
export { resolve, parseTransform, matMul, defsOf, urlRef } from './core/ir.js';
export { ops, clipRange, clipTime, uniqueId, subtreeOf, nodeRefs, markersCrossed } from './core/ops.js';
export { diffScenes, editsEmpty, editsCount, applyEdits } from './core/edits.js';
export { validateScene, validateStructure, repairScene } from './core/validate.js';
export { PRESETS, applyPreset, describeScene } from './core/presets.js';
export { SCENE_VERSION, sceneSchema, migrate, MIGRATIONS, typesTableMd, modifiersTableMd } from './core/schema.js';
export { importSVG, insertSVG, parseXML, decomposeMatrix } from './core/svgimport.js';
export { exportLottie } from './core/lottie.js';
