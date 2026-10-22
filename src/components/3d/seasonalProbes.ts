import type { IrradianceHeader, SeasonProbeFiles } from './irradiance';
import type { createModelFetch } from './sceneAssets';
import type { Season } from './season';

// The outdoor grids (courtyard, outer) of spring, autumn and winter, rebaked from the source
// scene's seasonal proxy by scripts/bake_irradiance_probes.py --season (public/models/seasons/).
// Summer ships with the scene; a season's files (about 1.3 MB) are fetched only once it is
// chosen, and until they arrive the probes keep the calibrated gains of seasonalLight.ts. A failed
// fetch keeps those gains for the rest of the visit and does not stop the 3D view.

export type ProbeSeason = Exclude<Season, 'summer'>;
export const SEASON_PROBE_FILES = (season: ProbeSeason) =>
  [`seasons/${season}-irradiance`, `seasons/${season}-reflection`] as const;

export function createSeasonProbes(get: ReturnType<typeof createModelFetch>) {
  const loaded = new Map<ProbeSeason, SeasonProbeFiles | null>();
  const pending = new Set<ProbeSeason>();
  const fetchFile = async (name: string) => {
    const [header, buffer]: [IrradianceHeader, ArrayBuffer] = await Promise.all([
      get(`${name}.json`).then((r) => r.json()),
      get(`${name}.bin`).then((r) => r.arrayBuffer()),
    ]);
    return { header, buffer };
  };
  return {
    /**
     * The files of the season, null while they load (the fetch starts on the first call) or
     * after they failed; summer is always null (the shipped grids).
     */
    files(season: Season): SeasonProbeFiles | null {
      if (season === 'summer') return null;
      if (loaded.has(season)) return loaded.get(season) ?? null;
      if (!pending.has(season)) {
        pending.add(season);
        const [irradiance, reflection] = SEASON_PROBE_FILES(season);
        Promise.all([fetchFile(irradiance), fetchFile(reflection)]).then(
          ([irradiance, reflection]) => loaded.set(season, { irradiance, reflection }),
          () => loaded.set(season, null),
        );
      }
      return null;
    },
    /** A season whose files failed (their layout, or the fetch) keeps the calibrated gains. */
    reject(season: ProbeSeason) {
      loaded.set(season, null);
    },
  };
}
