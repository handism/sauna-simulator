import { useEffect, useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer/decoder';

import type { AmbientEnv, AudioEngine } from '../../hooks/useAudioEngine';
import { QUALITY, type QualityMode } from './quality';
import { createLighting, eveningAmount, type LightingMode } from './lighting';
import { createWaterEffects, type WaterDefinition } from './waterEffects';
import { updateSteamPositions } from './steam';
import { applyFoliageTransmission, isFoliageMaterial } from './foliage';
import { applyLeafCluster, createLeafClusterTexture, leafClusterOf } from './leafCluster';
import { applyImageRamp, imageRampOf, type ImageRamp } from './imageRamp';
import { applyNoiseColor, noiseColorOf, type NoiseColor } from './noiseColor';

interface SceneDefinition {
  views: Record<AmbientEnv, { position: number[]; target: number[]; fov: number }>;
  stove: number[];
  water: WaterDefinition;
}

export interface SceneProps {
  audio: AudioEngine;
  quality: QualityMode;
  stage: AmbientEnv;
  lightingMode: LightingMode;
  loylyEvents: EventTarget;
  onReady: () => void;
  onError: () => void;
}

function disposeTree(root: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const texture of textures) {
    texture.dispose();
    if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) texture.image.close();
  }
  for (const material of materials) material.dispose();
}

export default function SaunaScene({ quality, audio, stage, lightingMode, loylyEvents, onReady, onError }: SceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const qualityRef = useRef(quality);
  const applyQualityRef = useRef<(() => void) | null>(null);
  useLayoutEffect(() => { qualityRef.current = quality; applyQualityRef.current?.(); }, [quality]);
  const stageRef = useRef(stage);
  const lightingRef = useRef(lightingMode);
  useLayoutEffect(() => { lightingRef.current = lightingMode; }, [lightingMode]);
  const setViewRef = useRef<((next: AmbientEnv) => void) | null>(null);
  useLayoutEffect(() => {
    stageRef.current = stage;
    setViewRef.current?.(stage);
  }, [stage]);
  useEffect(() => {
    const element = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { onError(); return; }
    let disposed = false;
    let failed = false;
    let ready = false;
    let steamStarted = -Infinity;
    const abort = new AbortController();
    const fail = () => {
      if (disposed || failed) return;
      failed = true;
      ready = false;
      abort.abort();
      clearTimeout(timeout);
      renderer.setAnimationLoop(null);
      audio.setSpatialPose(null);
      onError();
    };
    const timeout = window.setTimeout(fail, 30000);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(65, 1, .05, 250);
    camera.rotation.order = 'YXZ';
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    element.appendChild(renderer.domElement);
    const lighting = createLighting(scene, renderer);
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(90 * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const puff = document.createElement('canvas'); puff.width = puff.height = 64;
    const ctx = puff.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, '#ffffff'); gradient.addColorStop(1, '#ffffff00');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
    const puffTexture = new THREE.CanvasTexture(puff);
    const material = new THREE.PointsMaterial({ color: '#eff4f5', size: .45, map: puffTexture, transparent: true, opacity: 0, depthWrite: false });
    const steam = new THREE.Points(geometry, material); scene.add(steam);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onLoyly = () => { if (ready && stageRef.current === 'sauna') steamStarted = performance.now(); };
    loylyEvents.addEventListener('loyly', onLoyly);
    let resetMetrics = () => {};
    const applyQuality = () => {
      const preset = QUALITY[qualityRef.current];
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.pixelRatio));
      lighting.setShadowSize(preset.shadowSize);
      resetMetrics();
      element.dataset.quality = qualityRef.current;
      element.dataset.pixelRatio = String(renderer.getPixelRatio());
    };
    applyQualityRef.current = applyQuality;
    applyQuality();
    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    const lost = (event: Event) => { event.preventDefault(); fail(); };
    renderer.domElement.addEventListener('webglcontextlost', lost);
    let pointer: { id: number; x: number; y: number } | null = null;
    const down = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      element.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      camera.rotation.y -= (event.clientX - pointer.x) * .004;
      camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - (event.clientY - pointer.y) * .004, -.85, .85);
      pointer.x = event.clientX; pointer.y = event.clientY;
    };
    const up = (event: PointerEvent) => {
      if (pointer?.id === event.pointerId) pointer = null;
    };
    const key = (event: KeyboardEvent) => {
      if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      camera.rotation.y += event.key === 'ArrowLeft' ? .08 : event.key === 'ArrowRight' ? -.08 : 0;
      camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x + (event.key === 'ArrowUp' ? .06 : event.key === 'ArrowDown' ? -.06 : 0), -.85, .85);
    };
    element.addEventListener('pointerdown', down); element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up); element.addEventListener('pointercancel', up);
    element.addEventListener('lostpointercapture', up); element.addEventListener('keydown', key);
    const start = performance.now();
    async function load() {
      try {
        const base = `${import.meta.env.BASE_URL}models/`;
        const [definition, binary]: [SceneDefinition, ArrayBuffer] = await Promise.all([
          fetch(`${base}sauna.scene.json`, { signal: abort.signal }).then(r => { if (!r.ok) throw Error('scene'); return r.json(); }),
          fetch(`${base}sauna.glb`, { signal: abort.signal }).then(r => { if (!r.ok) throw Error('model'); return r.arrayBuffer(); }),
        ]);
        if (disposed || failed) return;
        const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(binary, base);
        if (disposed || failed) { disposeTree(gltf.scene); return; }
        // Replace the exported closed water volume with the bounded realtime surface.
        // Drawing both creates a milky double layer when the viewer sits in the pool.
        const foliage = new Set<THREE.MeshStandardMaterial>();
        const noiseColors = new Map<THREE.MeshStandardMaterial, NoiseColor>();
        const imageRamps = new Map<THREE.MeshStandardMaterial, ImageRamp>();
        const leafClusters = new Map<number, THREE.DataTexture>();
        let leafClusterMaterials = 0;
        gltf.scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if (isFoliageMaterial(material)) foliage.add(material);
            const noise = noiseColorOf(material);
            if (noise) noiseColors.set(material as THREE.MeshStandardMaterial, noise);
            const ramp = imageRampOf(material);
            if (ramp) imageRamps.set(material as THREE.MeshStandardMaterial, ramp);
            const cluster = leafClusterOf(material);
            if (cluster && material instanceof THREE.MeshStandardMaterial && !material.alphaMap) {
              // One mask per leaf count; disposeTree releases it with the materials.
              if (!leafClusters.has(cluster.leaves)) leafClusters.set(cluster.leaves, createLeafClusterTexture(cluster));
              applyLeafCluster(material, leafClusters.get(cluster.leaves)!);
              leafClusterMaterials++;
            }
          }
          // Glass and water must not cast opaque silhouettes onto the garden.
          object.castShadow = materials.every(material => !material.transparent);
          object.receiveShadow = object.castShadow;
          if (materials.every(material => material.name === 'V4 | clear spring water')) object.visible = false;
        });
        foliage.forEach(applyFoliageTransmission);
        noiseColors.forEach((noise, material) => applyNoiseColor(material, noise));
        imageRamps.forEach((ramp, material) => applyImageRamp(material, ramp));
        element.dataset.foliageMaterials = String(foliage.size);
        element.dataset.noiseColorMaterials = String(noiseColors.size);
        element.dataset.imageRampMaterials = String(imageRamps.size);
        element.dataset.leafClusterMaterials = String(leafClusterMaterials);
        scene.add(gltf.scene);
        const waterEffects = createWaterEffects(definition.water);
        scene.add(waterEffects.group);
        const forward = new THREE.Vector3();
        const upVector = new THREE.Vector3();
        const pose = { position: [0, 0, 0], forward: [0, 0, -1], up: [0, 1, 0], stove: definition.stove, water: definition.water.spout };
        const updateAudio = () => {
          camera.position.toArray(pose.position);
          camera.getWorldDirection(forward).toArray(pose.forward);
          upVector.set(0, 1, 0).applyQuaternion(camera.quaternion).toArray(pose.up);
          audio.setSpatialPose(pose);
        };
        let previous = 0;
        let recorded = false;
        const frameTimes: number[] = [];
        resetMetrics = () => {
          previous = 0; recorded = false; frameTimes.length = 0;
          delete element.dataset.frameMeanMs; delete element.dataset.frameMaxMs;
        };
        const setView = (next: AmbientEnv) => {
          const view = definition.views[next];
          camera.position.fromArray(view.position);
          camera.lookAt(new THREE.Vector3().fromArray(view.target));
          updateAudio();
          camera.fov = view.fov; camera.updateProjectionMatrix();
          steamStarted = -Infinity; steam.visible = false; pointer = null;
          resetMetrics();
          element.dataset.stage = next;
          lighting.update(eveningAmount(lightingRef.current, next), 0, true);
          renderer.render(scene, camera);
          element.dataset.triangles = String(renderer.info.render.triangles);
          element.dataset.drawCalls = String(renderer.info.render.calls);
        };
        setViewRef.current = setView;
        setView(stageRef.current);
        steam.position.fromArray(definition.stove);
        renderer.render(scene, camera);
        ready = true;
        clearTimeout(timeout);
        element.dataset.loadMs = String(Math.round(performance.now() - start));
        element.dataset.triangles = String(renderer.info.render.triangles);
        element.dataset.drawCalls = String(renderer.info.render.calls);
        onReady();
        renderer.setAnimationLoop((now) => {
          if (document.hidden) { previous = 0; return; }
          updateAudio();
          const delta = previous ? Math.min((now - previous) / 1000, .1) : 0;
          lighting.update(eveningAmount(lightingRef.current, stageRef.current), delta, reducedMotion.matches);
          element.dataset.lighting = lightingRef.current;
          if (previous && frameTimes.length < 180) frameTimes.push(now - previous);
          previous = now;
          if (frameTimes.length === 180 && !recorded) {
            recorded = true;
            element.dataset.frameMeanMs = (frameTimes.reduce((a, b) => a + b, 0) / 180).toFixed(2);
            element.dataset.frameMaxMs = Math.max(...frameTimes).toFixed(2);
          }
          const age = (now - steamStarted) / 1000;
          steam.visible = stageRef.current === 'sauna' && age < 6;
          waterEffects.update(now / 1000, reducedMotion.matches);
          if (steam.visible) {
            material.opacity = .24 * Math.sin(Math.min(1, age / 6) * Math.PI);
            updateSteamPositions(positions, age, reducedMotion.matches);
            geometry.attributes.position.needsUpdate = true;
          }
          renderer.render(scene, camera);
          element.dataset.drawCalls = String(renderer.info.render.calls);
          element.dataset.triangles = String(renderer.info.render.triangles);
          element.dataset.textures = String(renderer.info.memory.textures);
          element.dataset.geometries = String(renderer.info.memory.geometries);
        });
      } catch { fail(); }
    }
    void load();
    return () => {
      audio.setSpatialPose(null);
      disposed = true; applyQualityRef.current = null; lighting.dispose(); setViewRef.current = null; abort.abort(); clearTimeout(timeout); observer.disconnect();
      renderer.setAnimationLoop(null);
      loylyEvents.removeEventListener('loyly', onLoyly);
      element.removeEventListener('pointerdown', down); element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up); element.removeEventListener('pointercancel', up);
      element.removeEventListener('lostpointercapture', up); element.removeEventListener('keydown', key);
      renderer.domElement.removeEventListener('webglcontextlost', lost);
      disposeTree(scene); renderer.dispose(); renderer.domElement.remove();
    };
  }, [audio, loylyEvents, onReady, onError]);
  return <div ref={host} className="sauna-3d-canvas" tabIndex={0} role="region" aria-label={`${stage === 'sauna' ? 'サウナ' : stage === 'water' ? '水風呂' : '外気浴'}の3D視点。ドラッグ、スワイプ、矢印キーで見回す`} />;
}
