import { useDismissibleDetails } from '../hooks/useDismissibleDetails';
import { MuteButton } from './ControlButtons';

export default function SoundControl({
  isMuted,
  volume,
  onMute,
  onVolume,
}: {
  isMuted: boolean;
  volume: number;
  onMute: () => void;
  onVolume: (value: number) => void;
}) {
  const ref = useDismissibleDetails();
  return (
    <details className="sound-control" ref={ref} data-muted={isMuted}>
      <summary className="icon-btn" aria-label="音の設定" title="音の設定（Mでミュート切替）">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M11 5 6 9H2v6h4l5 4Z" />
          {isMuted || volume === 0 ? (
            <path d="m17 9 6 6m0-6-6 6" />
          ) : (
            <path d="M16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14" />
          )}
        </svg>
      </summary>
      <div className="sound-panel">
        <div className="sound-mute-row">
          <span>{isMuted ? 'ミュート中' : volume === 0 ? '音量 0%' : '音を再生中'}</span>
          <MuteButton isMuted={isMuted} onToggle={onMute} />
        </div>
        <label className="volume-label" htmlFor="master-volume">
          音量 <output>{Math.round(volume * 100)}%</output>
        </label>
        <input
          id="master-volume"
          type="range"
          min="0"
          max="100"
          value={Math.round(volume * 100)}
          onChange={(event) => onVolume(Number(event.target.value) / 100)}
        />
        {isMuted && <p className="detail-note">音量を変えても、ミュートは続きます。</p>}
        <p className="control-hint">
          <kbd>M</kbd> ミュート切替
        </p>
      </div>
    </details>
  );
}
