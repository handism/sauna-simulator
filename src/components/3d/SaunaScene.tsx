import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer/decoder';

import type { AmbientEnv, AudioEngine } from '../../hooks/useAudioEngine';
import { QUALITY, type QualityMode } from './quality';
// Replaces three's AgX curve with Blender's before any material compiles.
import './agx';
import { createLighting, timeOfDay, type LightingMode } from './lighting';
import { createGlossyLights } from './glossyLights';
import { createWaterEffects } from './waterEffects';
import { createSteam, LIFETIME_SECONDS } from './steam';
import { createFrameMetrics } from './frameMetrics';
import { createModelFetch, fetchSceneAssets, MODEL_BASE } from './sceneAssets';
import { attachLookControls } from './lookControls';
import { disposeTree, prepareModel } from './modelMaterials';
import { applyIrradiance, createProbeTextures } from './irradiance';
import { applyReflection } from './reflection';
import { applyGlass } from './glass';
import { addSideImages, applyRefraction, SIDE_IMAGE_LAYER } from './refraction';
import { applyCaustics } from './caustics';
import { applyWaterBottom } from './waterBottom';
import { createHdrOutput, createRenderer, type RenderStats } from './hdrOutput';
import { createDepthPrepass } from './depthPrepass';
import { createMirrorUniforms, createPlanarReflection, type PlanarReflection } from './planarReflection';
import { createShadowMask } from './shadowMask';
import { createDynamicResolution } from './dynamicResolution';
import { createFrameRate } from './frameRate';

export interface SceneProps {
  audio: AudioEngine;
  quality: QualityMode;
  stage: AmbientEnv;
  lightingMode: LightingMode;
  /** Date.now() of entering; automatic lighting follows the time since (the mount when absent). */
  enteredAt?: number;
  loylyEvents: EventTarget;
  onReady: () => void;
  onError: () => void;
  /** Whether the garden that follows the ready scene is still loading. */
  onGardenLoading?: (loading: boolean) => void;
}

const STEAM_LAYER = 1;

const STAGE_LABELS: Record<AmbientEnv, string> = { sauna: 'サウナ', water: '水風呂', totonou: '外気浴' };

export default function SaunaScene({
  quality,
  audio,
  stage,
  lightingMode,
  enteredAt,
  loylyEvents,
  onReady,
  onError,
  onGardenLoading,
}: SceneProps) {
  const host = useRef<HTMLDivElement>(null);
  // A ref: a new callback must not restart the scene.
  const gardenLoadingRef = useRef(onGardenLoading);
  useLayoutEffect(() => {
    gardenLoadingRef.current = onGardenLoading;
  }, [onGardenLoading]);
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
  // Kept across 2D/3D switches by the session, so a remounted scene resumes the same time of day.
  const [mountedAt] = useState(Date.now);
  const enteredAtRef = useRef(enteredAt ?? mountedAt);
  useLayoutEffect(() => {
    enteredAtRef.current = enteredAt ?? mountedAt;
  }, [enteredAt, mountedAt]);
  const setViewRef = useRef<((next: AmbientEnv) => void) | null>(null);
  useLayoutEffect(() => {
    stageRef.current = stage;
    setViewRef.current?.(stage);
  }, [stage]);
  useEffect(() => {
    const element = host.current!;
    const targetTime = () => timeOfDay(lightingRef.current, (Date.now() - enteredAtRef.current) / 1000);
    // Metrics for browser tests. Skip unchanged values so the render loop does not mutate the DOM every frame.
    const setData = (key: string, value: string) => {
      if (element.dataset[key] !== value) element.dataset[key] = value;
    };
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = createRenderer();
    } catch {
      onError();
      return;
    }
    let disposed = false;
    let failed = false;
    let ready = false;
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
    const prepass = createDepthPrepass();
    // The lit pass reads its shadows from a half-resolution mask (needs the float targets of HDR output).
    const shadowMask = output.hdr ? createShadowMask(renderer) : null;
    // The quality drawn, which trails the chosen one while its programs compile.
    let applied = qualityRef.current;
    const masked = () => shadowMask !== null && QUALITY[applied].shadowSize > 0;
    const lighting = createLighting(scene, renderer);
    // The water's mirror needs the linear HDR pass; without it the water keeps the probes.
    const mirrorUniforms = createMirrorUniforms();
    let mirror: PlanarReflection | null = null;
    const mirrorState = [0, 0, 0];
    let gardenAdded = 0;
    let qualityIndex = 0;
    const steam = createSteam();
    // Only the main camera sees the steam: it rises by the stove inside the room, out of the water's
    // mirror, which would otherwise redraw every frame of a löyly (planarReflection.ts).
    steam.points.layers.set(STEAM_LAYER);
    camera.layers.enable(STEAM_LAYER);
    scene.add(steam.points);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onLoyly = () => {
      if (!ready || stageRef.current !== 'sauna') return;
      const now = performance.now();
      steam.start(now);
      frameRate?.hold(now, LIFETIME_SECONDS * 1000);
    };
    loylyEvents.addEventListener('loyly', onLoyly);
    const metrics = createFrameMetrics(element);
    // The pixel ratio steps down from the quality's while frames miss 60 fps (dynamicResolution.ts);
    // ?resolution=fixed keeps the quality's, for frame cost measurements at a set ratio.
    const query = new URLSearchParams(window.location.search);
    const resolution = query.get('resolution') === 'fixed' ? null : createDynamicResolution(1);
    setData('resolution', resolution ? 'auto' : 'fixed');
    // A still view draws at 30 fps (frameRate.ts); ?frameRate=full draws every frame, for frame
    // cost measurements and tests that drive the animation frames themselves.
    const frameRate = query.get('frameRate') === 'full' ? null : createFrameRate();
    setData('frameRate', frameRate ? 'auto' : 'full');
    // ?temporal=off draws each frame on its own (temporalAA.ts), for comparisons.
    const temporal = query.get('temporal') !== 'off';
    const applyQuality = () => {
      applied = qualityRef.current;
      const preset = QUALITY[applied];
      const largest = Math.min(window.devicePixelRatio, preset.pixelRatio);
      resolution?.reset(largest);
      renderer.setPixelRatio(resolution?.pixelRatio ?? largest);
      lighting.setShadowSize(preset.shadowSize);
      lighting.setDuskLights(preset.duskLights);
      mirror?.setScale(preset.mirror);
      output.setTemporal(temporal && preset.temporal);
      setData('temporal', output.hdr && temporal && preset.temporal ? 'on' : 'off');
      qualityIndex++;
      metrics.reset();
      setData('quality', applied);
      setData('pixelRatio', String(renderer.getPixelRatio()));
    };
    // A quality's light and shadow counts need other programs, and three waits for the driver when
    // a program is first drawn (about 0.4 s for the scene's). Once the scene draws, the old quality
    // keeps drawing while the new one's programs compile off the render loop; the latest wins.
    let qualityRequest = 0;
    applyQualityRef.current = () => {
      const request = ++qualityRequest;
      if (!ready) return applyQuality();
      const preset = QUALITY[qualityRef.current];
      const compiled = lighting.withQuality(preset.shadowSize, preset.duskLights, () =>
        output.compile(scene, camera, scene),
      );
      void compiled
        .catch(() => {})
        .then(() => {
          if (request === qualityRequest && !disposed && !failed) applyQuality();
        });
    };
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
    // A key's step is not blended with the view before it (temporalAA.ts).
    const look = attachLookControls(element, camera, () => output.resetTemporal());
    let releaseProbes = () => {};
    // Parsed gardens not yet in the scene still hold GPU programs and geometry on exit.
    const gardenScenes: THREE.Object3D[] = [];
    const start = performance.now();
    async function load() {
      try {
        const get = createModelFetch(abort.signal);
        const { definition, model, irradiance, reflection } = await fetchSceneAssets(get);
        if (disposed || failed) return;
        // Throws on a layout mismatch before the model is parsed.
        const probes = createProbeTextures(irradiance, reflection);
        releaseProbes = probes.dispose;
        probes.apply(lighting.irradiance);
        setData('irradianceProbes', String(probes.probes));
        const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(model, MODEL_BASE);
        if (disposed || failed) {
          disposeTree(gltf.scene);
          return;
        }
        // Material counts add up over the scene and the garden loaded after it.
        const counts: Record<string, number> = {};
        const count = (key: string, value: number) => {
          counts[key] = (counts[key] ?? 0) + value;
          setData(key, String(counts[key]));
        };
        const prepare = (root: THREE.Object3D) => {
          const stats = prepareModel(root);
          const refraction = applyRefraction(root, definition.water.center[1]);
          count('refractionMaterials', refraction.materials);
          count('refractionTriangles', refraction.triangles);
          count('causticMaterials', applyCaustics(root));
          count('glassMeshes', applyGlass(root, lighting.irradiance));
          count('irradianceMaterials', applyIrradiance(root, lighting.irradiance));
          count('reflectionMaterials', applyReflection(root, lighting.irradiance));
          count('waterBottomMaterials', applyWaterBottom(root));
          for (const [key, value] of Object.entries(stats)) count(key, value);
          return refraction.triangles;
        };
        prepare(gltf.scene);
        const waterEffects = createWaterEffects(definition.water, lighting.irradiance, mirrorUniforms);
        // After every material change: the mirrored images copy the finished materials.
        const sideImages = addSideImages(gltf.scene, definition.water.center[1], waterEffects.time);
        setData('sideImageMeshes', String(sideImages.meshes));
        count('prepassMeshes', prepass.add(gltf.scene));
        count('shadowMaskMeshes', shadowMask?.add(gltf.scene) ?? 0);
        setData('sideImageTriangles', String(sideImages.triangles));
        camera.layers.enable(SIDE_IMAGE_LAYER);
        scene.add(gltf.scene);
        scene.add(waterEffects.group);
        // Seen only in the water's mirror, like the source's glossy-only area lights.
        const glossyLights = createGlossyLights();
        scene.add(glossyLights.mesh);
        if (output.hdr) {
          mirror = createPlanarReflection(
            renderer,
            definition.water.center[1],
            mirrorUniforms,
            (view, width, height) => {
              if (!masked()) return () => {};
              shadowMask!.render(scene, view, width, height, 'mirror');
              return () => shadowMask!.end();
            },
          );
          mirror.setScale(QUALITY[applied].mirror);
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
        // Counts of the scene pass, without the tone mapping pass; the mirror pass separately.
        const recordRenderInfo = ({ calls, triangles }: RenderStats) => {
          setData('drawCalls', String(calls));
          setData('triangles', String(triangles));
        };
        const drawingSize = new THREE.Vector2();
        const draw = () => {
          setData('sideImagesShown', String(sideImages.update(camera)));
          if (mirror) {
            // What else the reflection shows changing: lighting and the quality's lights.
            // Automatic lighting moves every frame while it changes scene; a step of 0.002 (0.36 s
            // of it, well under a percent of any light) keeps the reflection from being redrawn
            // each frame.
            mirrorState[0] = Math.round(lighting.time * 500) / 500;
            glossyLights.update(lighting.irradiance.suiIrradianceEvening.value);
            mirrorState[1] = qualityIndex;
            mirrorState[2] = gardenAdded;
            const reflected = mirror.render(scene, camera, waterEffects.surface, mirrorState);
            // Counts of the last mirror pass; frames that keep its image add no draws.
            setData('mirrorCalls', String(reflected.calls));
            setData('mirrorTriangles', String(reflected.triangles));
            setData('mirrorSize', mirror.size);
          }
          // The shadows at half resolution (shadowMask.ts), read by the lit pass.
          if (masked()) {
            renderer.getDrawingBufferSize(drawingSize);
            shadowMask!.render(scene, camera, drawingSize.x, drawingSize.y);
          }
          const stats = output.render(scene, camera);
          shadowMask?.end();
          return stats;
        };
        const setView = (next: AmbientEnv) => {
          const view = definition.views[next];
          camera.position.fromArray(view.position);
          camera.lookAt(new THREE.Vector3().fromArray(view.target));
          updateAudio();
          camera.fov = view.fov;
          camera.updateProjectionMatrix();
          steam.stop();
          look.cancel();
          output.resetTemporal();
          resolution?.settle();
          metrics.reset();
          setData('stage', next);
          lighting.update(targetTime(), 0, true);
          recordRenderInfo(draw());
        };
        // Every material's programs, compiled together off the main thread where the browser can:
        // drawn first, each waited for the driver in turn (about 0.5 s on load). Again if the
        // quality changed meanwhile. Chrome finished them in about 0.4 s, about 0.9 s while
        // another page drew WebGL, and not for 19 s before this page drew while DevTools
        // screencast such a page (a Playwright trace), so the first draw waits for the rest
        // after a second (docs/3d-qa/load-compile/).
        for (let compiled: QualityMode | null = null; compiled !== applied;) {
          compiled = applied;
          await output.compile(scene, camera, scene, 1000);
          if (disposed || failed) return;
        }
        setViewRef.current = setView;
        setView(stageRef.current);
        steam.points.position.fromArray(definition.stove);
        const firstFrame = draw();
        ready = true;
        clearTimeout(timeout);
        setData('loadMs', String(Math.round(performance.now() - start)));
        recordRenderInfo(firstFrame);
        onReady();
        // The woodland foliage (compress_web_glb.mjs GARDEN) is most of the download; it follows the
        // ready scene so a slow connection gets the room within the time limit. Its failure keeps
        // the scene. None of it reaches the water, so it adds no refraction or side images.
        const setGarden = (state: 'loading' | 'ready' | 'failed') => {
          setData('garden', state);
          gardenLoadingRef.current?.(state === 'loading');
        };
        setGarden('loading');
        void (async () => {
          try {
            const garden = await get('sauna-garden.glb').then((r) => r.arrayBuffer());
            if (disposed || failed) return;
            const { scene: woodland } = await new GLTFLoader()
              .setMeshoptDecoder(MeshoptDecoder)
              .parseAsync(garden, MODEL_BASE);
            if (disposed || failed) {
              disposeTree(woodland);
              return;
            }
            gardenScenes.push(woodland);
            if (prepare(woodland)) throw Error('Garden under water');
            count('prepassMeshes', prepass.add(woodland));
            count('shadowMaskMeshes', shadowMask?.add(woodland) ?? 0);
            // Compile for the pass it is drawn in, off the render loop where the browser can.
            await output.compile(woodland, camera, scene);
            if (disposed || failed) return;
            scene.add(woodland);
            gardenAdded = 1;
            lighting.refreshShadows();
            metrics.reset();
            setData('gardenMs', String(Math.round(performance.now() - start)));
            setGarden('ready');
          } catch {
            if (!disposed && !failed) setGarden('failed');
          }
        })();
        // The view drawn last: a moving one holds the full rate.
        const seenPosition = new THREE.Vector3();
        const seenQuaternion = new THREE.Quaternion();
        renderer.setAnimationLoop((now) => {
          if (document.hidden) {
            metrics.pause();
            return;
          }
          if (!camera.position.equals(seenPosition) || !camera.quaternion.equals(seenQuaternion)) {
            seenPosition.copy(camera.position);
            seenQuaternion.copy(camera.quaternion);
            frameRate?.hold(now);
          }
          if (frameRate && !frameRate.draw(now)) return;
          // The resolution follows the full rate's frames only: 30 fps is not a slow GPU.
          const capped = frameRate !== null && !frameRate.full(now);
          if (capped) resolution?.pause();
          const ratio = capped ? null : (resolution?.frame(now) ?? null);
          if (ratio !== null) {
            renderer.setPixelRatio(ratio);
            setData('pixelRatio', String(renderer.getPixelRatio()));
            metrics.reset();
          }
          updateAudio();
          const delta = metrics.frame(now);
          lighting.update(targetTime(), delta, reducedMotion.matches);
          setData('lighting', lightingRef.current);
          setData('timeOfDay', lighting.time.toFixed(3));
          steam.update(now, stageRef.current === 'sauna', reducedMotion.matches);
          waterEffects.update(now / 1000, reducedMotion.matches);
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
      for (const garden of gardenScenes) if (!garden.parent) disposeTree(garden);
      releaseProbes();
      mirror?.dispose();
      output.dispose();
      prepass.dispose();
      shadowMask?.dispose();
      renderer.dispose();
      // Frees the drawing buffer and three's own textures now rather than when the context is collected.
      renderer.forceContextLoss();
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
