import { useEffect, useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer/decoder';

import type { AmbientEnv, AudioEngine } from '../../hooks/useAudioEngine';
import { QUALITY, type QualityMode } from './quality';
import { createLighting, eveningAmount, type LightingMode } from './lighting';
import { createWaterEffects, type WaterDefinition } from './waterEffects';
import { updateSteamPositions } from './steam';
import { attachLookControls } from './lookControls';
import { disposeTree, prepareModel } from './modelMaterials';

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
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // Same view transform as the source Cycles renders (AgX, look None).
    renderer.toneMapping = THREE.AgXToneMapping;
    element.appendChild(renderer.domElement);
    const lighting = createLighting(scene, renderer);
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
    const start = performance.now();
    async function load() {
      try {
        const base = `${import.meta.env.BASE_URL}models/`;
        const [definition, binary]: [SceneDefinition, ArrayBuffer] = await Promise.all([
          fetch(`${base}sauna.scene.json`, { signal: abort.signal }).then((r) => {
            if (!r.ok) throw Error('scene');
            return r.json();
          }),
          fetch(`${base}sauna.glb`, { signal: abort.signal }).then((r) => {
            if (!r.ok) throw Error('model');
            return r.arrayBuffer();
          }),
        ]);
        if (disposed || failed) return;
        const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(binary, base);
        if (disposed || failed) {
          disposeTree(gltf.scene);
          return;
        }
        const stats = prepareModel(gltf.scene);
        setData('foliageMaterials', String(stats.foliageMaterials));
        setData('noiseColorMaterials', String(stats.noiseColorMaterials));
        setData('imageRampMaterials', String(stats.imageRampMaterials));
        setData('leafClusterMaterials', String(stats.leafClusterMaterials));
        scene.add(gltf.scene);
        const waterEffects = createWaterEffects(definition.water, scene.background as THREE.Color);
        scene.add(waterEffects.group);
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
        const recordRenderInfo = () => {
          setData('drawCalls', String(renderer.info.render.calls));
          setData('triangles', String(renderer.info.render.triangles));
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
          renderer.render(scene, camera);
          recordRenderInfo();
        };
        setViewRef.current = setView;
        setView(stageRef.current);
        steam.position.fromArray(definition.stove);
        renderer.render(scene, camera);
        ready = true;
        clearTimeout(timeout);
        setData('loadMs', String(Math.round(performance.now() - start)));
        recordRenderInfo();
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
          renderer.render(scene, camera);
          recordRenderInfo();
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
