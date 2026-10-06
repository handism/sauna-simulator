import * as THREE from 'three';
import { collectWarmupPasses, type WarmupPass, type WarmupPassOptions } from './warmupPasses';
import { collectWarmupGroups } from './warmupPrograms';
import { runWarmupSteps, type WarmupSchedule } from './warmupScheduler';

export interface SceneWarmupTarget<View> {
  renderer: Pick<THREE.WebGLRenderer, 'properties' | 'getContext'>;
  /** The groups come from here; the passes draw whatever scene contains it. */
  root: THREE.Object3D;
  /** Entry first: the later ones prepare what the stages after it first draw. */
  views: readonly View[];
  /** Poses the camera without publishing it (no audio, no canvas), with world matrices and the
   * per-view visibility (side images) updated. Called again before every step, as a look between
   * steps may have turned the camera. */
  pose: (view: View) => void;
  passOptions: () => WarmupPassOptions;
  /** Draws the pass into internal targets only and waits for it; false when it drew nothing. */
  draw: (pass: WarmupPass) => boolean;
}

export interface SceneWarmupResult {
  steps: number;
  groups: number;
  /** Groups a pass could draw that none did in any view (outside every frustum, say). */
  undrawn: number;
}

/**
 * Splits the first draws of the heavy programs under `root` over the views: each view draws the
 * rest first, then one group at a time in the passes that can draw it and have not. A group counts
 * as prepared in a pass only once three reported drawing one of its materials there
 * (onBeforeRender), never because a step ran. The caller serializes runs, fixes the lighting and
 * the configuration meanwhile, and refreshes shadows, mirror and history before its full draw.
 * `restore` is idempotent and synchronous, for an owner that disposes before the run settles.
 */
export function startSceneWarmup<View>(
  target: SceneWarmupTarget<View>,
  schedule: Omit<WarmupSchedule, 'restore'> & { restore?: () => void },
) {
  const { renderer, root, views, pose, passOptions, draw } = target;
  const warmed = new Set<string>();
  const needs = new Map<string, Set<WarmupPass>>();
  const keyOf = new Map<THREE.Material, string>();
  const hidden = new Set<THREE.Material>();
  const hooked: [THREE.Object3D, boolean, THREE.Object3D['onBeforeRender']][] = [];
  let pass: WarmupPass | null = null;
  let steps = 0;
  let restored = false;
  const showOnly = (shown: readonly THREE.Material[]) => {
    for (const material of hidden) material.visible = shown.includes(material);
  };
  const restore = () => {
    if (restored) return;
    restored = true;
    for (const material of hidden) material.visible = true;
    hidden.clear();
    for (const [object, own, original] of hooked)
      if (own) object.onBeforeRender = original;
      else delete (object as Partial<THREE.Object3D>).onBeforeRender;
    hooked.length = 0;
    schedule.restore?.();
  };
  root.traverse((object) => {
    if (!(object as THREE.Mesh).material) return;
    const own = Object.prototype.hasOwnProperty.call(object, 'onBeforeRender');
    const original = object.onBeforeRender;
    hooked.push([object, own, original]);
    // three passes the material it draws: never an override or a depth copy's.
    object.onBeforeRender = function (this: THREE.Object3D, ...args) {
      const key = keyOf.get(args[4]);
      if (pass && key) warmed.add(`${pass}|${key}`);
      return original.apply(this, args);
    };
  });
  const done = (key: string) => {
    const passes = needs.get(key);
    return !!passes?.size && [...passes].every((each) => warmed.has(`${each}|${key}`));
  };
  function* plan(): Generator<() => boolean> {
    for (const view of views) {
      // Materials hidden for an earlier view are shown again unless this view splits them too.
      showOnly([...hidden]);
      hidden.clear();
      keyOf.clear();
      pose(view);
      const options = passOptions();
      const groups = collectWarmupGroups(renderer, collectWarmupPasses(root, options));
      for (const [key, group] of groups) {
        const passes = needs.get(key) ?? new Set<WarmupPass>();
        for (const each of group.passes) passes.add(each);
        needs.set(key, passes);
        for (const material of group.materials) {
          keyOf.set(material, key);
          hidden.add(material);
        }
      }
      // A view whose mirror is out of sight draws no mirror steps.
      let mirror = options.mirrorEnabled;
      const step = (each: WarmupPass, shown: readonly THREE.Material[]) => () => {
        if (each === 'mirror' && !mirror) return false;
        pose(view);
        showOnly(shown);
        pass = each;
        let drawn: boolean;
        try {
          drawn = draw(each);
        } finally {
          pass = null;
        }
        if (each === 'mirror') mirror = drawn;
        if (drawn) steps++;
        return drawn;
      };
      yield step('mirror', []);
      yield step('main', []);
      for (const [key, group] of groups) {
        if (done(key)) continue;
        for (const each of ['mirror', 'main'] as const)
          if (group.passes.has(each) && !warmed.has(`${each}|${key}`)) yield step(each, group.materials);
      }
    }
  }
  const finished = runWarmupSteps(plan(), { ...schedule, restore }).then((): SceneWarmupResult => ({
    steps,
    groups: needs.size,
    undrawn: [...needs.keys()].filter((key) => !done(key)).length,
  }));
  return { finished, restore };
}
