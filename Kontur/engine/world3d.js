// Kontur world3d: 3D-построители для 2.5D-сцен. Геометрия описывается в мире (1 ед. ≈ 1 м, Y вверх, Z вглубь),
// проецируется камерой camera3d и превращается в обычные узлы Kontur с props.surface (нормаль, плоскость, блик,
// свечение, контур) — их понимают проходы отложенного света (renderSVG mode normal/plane/planeD/emissive/ink).
// Перенос Tools/scene_sketch/lib2.mjs: те же примитивы, материалы и порядок случайных чисел (сцена совпадает).
// ES-модуль без внешних зависимостей (ядро kontur.js — камера): работает в браузере и в Node.
// Модули: engine/world/*.js (color, rng, geom, camera, builder, materials, shapes, facade, emit, items).
export { C, mix, dark, lite, jit } from './world/color.js';
export { rnd, reseed, hashSeed, withSeed } from './world/rng.js';
export { sub, add, mul, dot, cross, norm, polyNormal, triangulate } from './world/geom.js';
export { CAMERA_DEFAULT, camera, fitCamera, unproject } from './world/camera.js';
export { Scene } from './world/builder.js';
export { bevel, blob, MAT, MATERIALS, MATERIAL_DOCS, registerMaterial, materialPrims } from './world/materials.js';
export { face, frameOf, box, cyl, smoothProfile, PROFILES, registerProfile, lathe, latheStack, sphere, sphereTris, arch, awning, disc, stairs } from './world/shapes.js';
export { house, windowPrims, doorPrims, pipePrims, ivy, char, textPrim } from './world/facade.js';
export { toNodes, toScene } from './world/emit.js';
export { WORLD_ITEMS, registerWorldItem, worldItemsDoc, worldItemParams, checkWorldItem, buildWorld, normTess } from './world/items.js';
