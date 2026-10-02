/**
 * Client-safe view helpers: WIB wall-clock formatting and the lane-packing
 * algorithm the Today timeline uses to render overlapping entries side-by-side
 * (design.md §6/§7 Option A). No server-only imports — usable in client comps.
 */

const WIB_OFFSET_MS = 7 * 60 * 60_000;

/** HH:mm (WIB) for a UTC ISO instant. */
export function wibHHMM(iso: string): string {
  const wib = new Date(new Date(iso).getTime() + WIB_OFFSET_MS);
  return wib.toISOString().slice(11, 16);
}

/** Fractional WIB hour (e.g. 10.5 for 10:30) for a UTC ISO instant. */
export function wibFractionalHour(iso: string): number {
  const wib = new Date(new Date(iso).getTime() + WIB_OFFSET_MS);
  return wib.getUTCHours() + wib.getUTCMinutes() / 60;
}

/** Human duration: 90 -> "1h 30m", 45 -> "45m", 120 -> "2h". */
export function fmtDuration(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Minimal shape the lane packer needs. */
export interface TimedBlock {
  start_at: string;
  end_at: string;
}

export interface LanedBlock<T extends TimedBlock> {
  block: T;
  lane: number; // 0-based column index within its overlap cluster
  lanes: number; // total columns in that cluster (for width math)
}

/**
 * Assign each block a (lane, lanes) so overlapping entries render in separate
 * columns, non-overlapping entries reuse column 0. Blocks are grouped into
 * connected overlap clusters; within a cluster each block gets the smallest
 * free lane (greedy interval colouring) and the cluster-wide lane count, so
 * sibling columns share a uniform width.
 */
export function assignLanes<T extends TimedBlock>(blocks: T[]): LanedBlock<T>[] {
  const items = blocks
    .map((block) => ({
      block,
      start: new Date(block.start_at).getTime(),
      end: new Date(block.end_at).getTime(),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const result: LanedBlock<T>[] = [];

  let i = 0;
  while (i < items.length) {
    // Grow a cluster: keep adding while the next block starts before the
    // cluster's running max end (i.e. it overlaps something already inside).
    let clusterEnd = items[i].end;
    let j = i + 1;
    while (j < items.length && items[j].start < clusterEnd) {
      clusterEnd = Math.max(clusterEnd, items[j].end);
      j += 1;
    }

    const cluster = items.slice(i, j);
    // Greedy lane assignment within the cluster.
    const laneEndTimes: number[] = []; // laneEndTimes[k] = end of last block in lane k
    const lanes = new Array<number>(cluster.length);
    for (let k = 0; k < cluster.length; k++) {
      const c = cluster[k];
      let lane = laneEndTimes.findIndex((end) => end <= c.start);
      if (lane === -1) {
        lane = laneEndTimes.length;
        laneEndTimes.push(c.end);
      } else {
        laneEndTimes[lane] = c.end;
      }
      lanes[k] = lane;
    }
    const laneCount = laneEndTimes.length;
    for (let k = 0; k < cluster.length; k++) {
      result.push({ block: cluster[k].block, lane: lanes[k], lanes: laneCount });
    }

    i = j;
  }

  return result;
}
