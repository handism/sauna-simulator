// 設定メニューの中の全体音量。ミュートは右上のボタン（M）で切り替え、ここでは解除しない
export default function VolumeSetting({ volume, onVolume }: { volume: number; onVolume: (value: number) => void }) {
  return (
    <div className="volume-setting">
      <label className="volume-label" htmlFor="master-volume">
        音量 <span aria-hidden="true">{Math.round(volume * 100)}%</span>
      </label>
      <input
        id="master-volume"
        type="range"
        min="0"
        max="100"
        value={Math.round(volume * 100)}
        onChange={(event) => onVolume(Number(event.target.value) / 100)}
      />
    </div>
  );
}
