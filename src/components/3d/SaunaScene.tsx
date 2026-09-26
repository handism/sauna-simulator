import { useEffect, useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer/decoder';

import type { AmbientEnv, AudioEngine } from '../../hooks/useAudioEngine';
import { QUALITY, type QualityMode } from './quality';
// Replaces three's AgX curve with Blender's before any material compiles.
import './agx';
import { createLighting, eveningAmount, type LightingMode } from './lighting';
import { createWaterEffects, type WaterDefinition } from './waterEffects';
import { updateSteamPositions } from './steam';
import { attachLookControls } from './lookControls';
import { disposeTree, prepareModel } from './modelMaterials';
import { applyIrradiance, createProbeTextures, type IrradianceHeader } from './irradiance';
import { applyReflection } from './reflection';
import { applyGlass } from './glass';
import { addSideImages, applyRefraction, SIDE_IMAGE_LAYER } from './refraction';
import { applyCaustics } from './caustics';
import { createHdrOutput, type RenderStats } from './hdrOutput';
import { createMirrorUniforms, createPlanarReflection, type PlanarReflection } from './planarReflection';

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

const STEAM_LAYER = 1;

const STAGE_LABELS: Record<AmbientEnv, string> = { sauna: 'サウナ', water: '水風呂', totonou: '外気浴' };

export default function SaunaScene({ quality, audio, stage, lightingMode, loylyEvents, onReady, onError }: SceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const qualityRef = useRef(quality);
  const applyQualityRef = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    qualityRef.current = quality;
    applyQualityRef.current?.();
  }, [quality]);
  const stageRef = useRef(stage);
  const lightingRef = useRef(lightingMode);
  useLayoutEffect(() => {
    lightingRef.current = lightingMode;
  }, [lightingMode]);
  const setViewRef = useRef<((next: AmbientEnv) => void) | null>(null);
  useLayoutEffect(() => {
    stageRef.current = stage;
    setViewRef.current?.(stage);
  }, [stage]);
  useEffect(() => {
    const element = host.current!;
    // Metrics for browser tests. Skip unchanged values so the render loop does not mutate the DOM every frame.
    const setData = (key: string, value: string) => {
      if (element.dataset[key] !== value) element.dataset[key] = value;
    };
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      onError();
      return;
    }
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
    const camera = new THREE.PerspectiveCamera(65, 1, 0.05, 250);
    camera.rotation.order = 'YXZ';
    renderer.shadowMap.enabled = true;
    // Raw depth for the soft shadow filter in softShadows.ts.
    renderer.shadowMap.type = THREE.BasicShadowMap;
    // Same view transform as the source Cycles renders (AgX, look None; Blender's curve, agx.ts).
    renderer.toneMapping = THREE.AgXToneMapping;
    element.appendChild(renderer.domElement);
    // Transparent surfaces blend in scene-linear light, tone mapped once (hdrOutput.ts).
    const output = createHdrOutput(renderer);
    const lighting = createLighting(scene, renderer, output.hdr);
    // The water's mirror needs the linear HDR pass; without it the water keeps the probes.
    const mirrorUniforms = createMirrorUniforms();
    let mirror: PlanarReflection | null = null;
    const mirrorState = [0, 0];
    let qualityIndex = 0;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(90 * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const puff = document.createElement('canvas');
    puff.width = puff.height = 64;
    const ctx = puff.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(1, '#ffffff00');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    const puffTexture = new THREE.CanvasTexture(puff);
    const material = new THREE.PointsMaterial({
      color: '#eff4f5',
      size: 0.45,
      map: puffTexture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const steam = new THREE.Points(geometry, material);
    // Only the main camera sees the steam: it rises by the stove inside the room, out of the water's
    // mirror, which would otherwise redraw every frame of a löyly (planarReflection.ts).
    steam.layers.set(STEAM_LAYER);
    camera.layers.enable(STEAM_LAYER);
    scene.add(steam);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onLoyly = () => {
      if (ready && stageRef.current === 'sauna') steamStarted = performance.now();
    };
    loylyEvents.addEventListener('loyly', onLoyly);
    let resetMetrics = () => {};
    const applyQuality = () => {
      const preset = QUALITY[qualityRef.current];
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.pixelRatio));
      lighting.setShadowSize(preset.shadowSize);
      lighting.setDuskLights(preset.duskLights);
      mirror?.setScale(preset.mirror);
      qualityIndex++;
      resetMetrics();
      setData('quality', qualityRef.current);
      setData('pixelRatio', String(renderer.getPixelRatio()));
    };
    applyQualityRef.current = applyQuality;
    applyQuality();
    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    const lost = (event: Event) => {
      event.preventDefault();
      fail();
    };
    renderer.domElement.addEventListener('webglcontextlost', lost);
    const look = attachLookControls(element, camera);
    let releaseProbes = () => {};
    const start = performance.now();
    async function load() {
      try {
        const base = `${import.meta.env.BASE_URL}models/`;
        const get = (name: string) =>
          fetch(`${base}${name}`, { signal: abort.signal }).then((r) => {
            if (!r.ok) throw Error(name);
            return r;
          });
        const [definition, binary, irradianceHeader, irradianceData, reflectionHeader, reflectionData]: [
          SceneDefinition,
          ArrayBuffer,
          IrradianceHeader,
          ArrayBuffer,
          IrradianceHeader,
          ArrayBuffer,
        ] = await Promise.all([
          get('sauna.scene.json').then((r) => r.json()),
          get('sauna.glb').then((r) => r.arrayBuffer()),
          get('irradiance.json').then((r) => r.json()),
          get('irradiance.bin').then((r) => r.arrayBuffer()),
          get('reflection.json').then((r) => r.json()),
          get('reflection.bin').then((r) => r.arrayBuffer()),
        ]);
        if (disposed || failed) return;
        // Throws on a layout mismatch before the model is parsed.
        const probes = createProbeTextures(
          { header: irradianceHeader, buffer: irradianceData },
          { header: reflectionHeader, buffer: reflectionData },
        );
        releaseProbes = probes.dispose;
        probes.apply(lighting.irradiance);
        setData('irradianceProbes', String(probes.probes));
        const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(binary, base);
        if (disposed || failed) {
          disposeTree(gltf.scene);
          return;
        }
        const stats = prepareModel(gltf.scene);
        const refraction = applyRefraction(gltf.scene, definition.water.center[1]);
        setData('refractionMaterials', String(refraction.materials));
        setData('refractionTriangles', String(refraction.triangles));
        setData('causticMaterials', String(applyCaustics(gltf.scene)));
        setData('glassMeshes', String(applyGlass(gltf.scene, lighting.irradiance)));
        setData('irradianceMaterials', String(applyIrradiance(gltf.scene, lighting.irradiance)));
        setData('reflectionMaterials', String(applyReflection(gltf.scene, lighting.irradiance)));
        const waterEffects = createWaterEffects(definition.water, lighting.irradiance, mirrorUniforms);
        // After every material change: the mirrored images copy the finished materials.
        const sideImages = addSideImages(gltf.scene, definition.water.center[1], waterEffects.time);
        setData('sideImageMeshes', String(sideImages.meshes));
        setData('sideImageTriangles', String(sideImages.triangles));
        camera.layers.enable(SIDE_IMAGE_LAYER);
        setData('foliageMaterials', String(stats.foliageMaterials));
        setData('noiseColorMaterials', String(stats.noiseColorMaterials));
        setData('imageRampMaterials', String(stats.imageRampMaterials));
        setData('leafClusterMaterials', String(stats.leafClusterMaterials));
        scene.add(gltf.scene);
        scene.add(waterEffects.group);
        if (output.hdr) {
          mirror = createPlanarReflection(renderer, definition.water.center[1], mirrorUniforms);
          mirror.setScale(QUALITY[qualityRef.current].mirror);
        }
        const forward = new THREE.Vector3();
        const upVector = new THREE.Vector3();
        const pose = {
          position: [0, 0, 0],
          forward: [0, 0, -1],
          up: [0, 1, 0],
          stove: definition.stove,
          water: definition.water.spout,
        };
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
          previous = 0;
          recorded = false;
          frameTimes.length = 0;
          delete element.dataset.frameMeanMs;
          delete element.dataset.frameMaxMs;
        };
        // Counts of the scene pass, without the tone mapping pass; the mirror pass separately.
        const recordRenderInfo = ({ calls, triangles }: RenderStats) => {
          setData('drawCalls', String(calls));
          setData('triangles', String(triangles));
        };
        const draw = () => {
          setData('sideImagesShown', String(sideImages.update(camera)));
          if (mirror) {
            // What else the reflection shows changing: lighting and the quality's lights.
            mirrorState[0] = lighting.irradiance.suiIrradianceEvening.value;
            mirrorState[1] = qualityIndex;
            const reflected = mirror.render(scene, camera, waterEffects.surface, mirrorState);
            // Counts of the last mirror pass; frames that keep its image add no draws.
            setData('mirrorCalls', String(reflected.calls));
            setData('mirrorTriangles', String(reflected.triangles));
            setData('mirrorSize', mirror.size);
          }
          return output.render(scene, camera);
        };
        const setView = (next: AmbientEnv) => {
          const view = definition.views[next];
          camera.position.fromArray(view.position);
          camera.lookAt(new THREE.Vector3().fromArray(view.target));
          updateAudio();
          camera.fov = view.fov;
          camera.updateProjectionMatrix();
          steamStarted = -Infinity;
          steam.visible = false;
          look.cancel();
          resetMetrics();
          setData('stage', next);
          lighting.update(eveningAmount(lightingRef.current, next), 0, true);
          recordRenderInfo(draw());
        };
        setViewRef.current = setView;
        setView(stageRef.current);
        steam.position.fromArray(definition.stove);
        const firstFrame = draw();
        ready = true;
        clearTimeout(timeout);
        setData('loadMs', String(Math.round(performance.now() - start)));
        recordRenderInfo(firstFrame);
        onReady();
        renderer.setAnimationLoop((now) => {
          if (document.hidden) {
            previous = 0;
            return;
          }
          updateAudio();
          const delta = previous ? Math.min((now - previous) / 1000, 0.1) : 0;
          lighting.update(eveningAmount(lightingRef.current, stageRef.current), delta, reducedMotion.matches);
          setData('lighting', lightingRef.current);
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
            material.opacity = 0.24 * Math.sin(Math.min(1, age / 6) * Math.PI);
            updateSteamPositions(positions, age, reducedMotion.matches);
            geometry.attributes.position.needsUpdate = true;
          }
          recordRenderInfo(draw());
          setData('textures', String(renderer.info.memory.textures));
          setData('geometries', String(renderer.info.memory.geometries));
        });
      } catch {
        fail();
      }
    }
    void load();
    return () => {
      audio.setSpatialPose(null);
      disposed = true;
      applyQualityRef.current = null;
      lighting.dispose();
      setViewRef.current = null;
      abort.abort();
      clearTimeout(timeout);
      observer.disconnect();
      renderer.setAnimationLoop(null);
      loylyEvents.removeEventListener('loyly', onLoyly);
      look.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', lost);
      disposeTree(scene);
      releaseProbes();
      mirror?.dispose();
      output.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [audio, loylyEvents, onReady, onError]);
  return (
    <div
      ref={host}
      className="sauna-3d-canvas"
      tabIndex={0}
      role="region"
      aria-label={`${STAGE_LABELS[stage]}の3D視点。ドラッグ、スワイプ、矢印キーで見回す`}
    />
  );
}
