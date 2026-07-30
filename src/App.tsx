import { useState, useEffect } from "react";
import "./index.css";
import SaunaRoom from "./components/SaunaRoom";
import CoolingBath from "./components/CoolingBath";
import TotonouSpace from "./components/TotonouSpace";
import { useSaunaContext, type Stage } from "./context/SaunaContext";

interface BackgroundConfig {
  stage: Stage;
  gradient: string;
  image: string;
}

const BACKGROUNDS: BackgroundConfig[] = [
  {
    stage: "sauna",
    gradient: "rgba(0,0,0,0.45), rgba(0,0,0,0.75)",
    image: "sauna_bg.png",
  },
  {
    stage: "water",
    gradient: "rgba(0,0,0,0.25), rgba(0,0,0,0.65)",
    image: "water_bg.png",
  },
  {
    stage: "totonou",
    gradient: "rgba(0,0,0,0.55), rgba(0,0,0,0.85)",
    image: "totonou_bg.png",
  },
];

function UiToggleButton({
  isUiHidden,
  onToggle,
}: {
  isUiHidden: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="mute-btn ui-toggle-btn"
      style={{ right: "72px", opacity: isUiHidden ? 0.3 : 1 }}
      onClick={onToggle}
      aria-label={isUiHidden ? "UI表示" : "UI非表示"}
      aria-pressed={isUiHidden}
    >
      {isUiHidden ? (
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
          <line x1="1" y1="1" x2="23" y2="23"></line>
        </svg>
      ) : (
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>
      )}
    </button>
  );
}

function MuteButton({
  isMuted,
  onToggle,
}: {
  isMuted: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="mute-btn"
      onClick={onToggle}
      aria-label={isMuted ? "ミュート解除" : "ミュート"}
      aria-pressed={isMuted}
    >
      {isMuted ? (
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </svg>
      ) : (
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        </svg>
      )}
    </button>
  );
}

function App() {
  const {
    stage,
    opacity,
    isMuted,
    isUiHidden,
    heartRate,
    saunaTime,
    loylyCount,
    waterTime,
    audio,
    handleStart,
    toggleMute,
    toggleUiVisibility,
    completeSauna,
    completeWater,
    completeTotonou,
  } = useSaunaContext();

  // 背景画像レイヤーのアンマウント最適化
  // クロスフェード遷移中のみ現在と遷移先の背景を保持し、遷移完了後に非アクティブな背景をDOMからアンマウント
  const [activeLayers, setActiveLayers] = useState<Stage[]>([stage]);

  useEffect(() => {
    setActiveLayers((prev) => Array.from(new Set([...prev, stage])));
    const timer = setTimeout(() => {
      setActiveLayers([stage]);
    }, 1000);
    return () => clearTimeout(timer);
  }, [stage]);

  return (
    <div
      className={`app-container ${isUiHidden ? "ui-hidden" : ""}`}
      style={{ background: "#000" }}
    >
      {/* Background image crossfading with unmount optimization */}
      {BACKGROUNDS.filter(({ stage: s }) => activeLayers.includes(s)).map(
        ({ stage: s, gradient, image }) => (
          <div
            key={s}
            className="app-bg-layer"
            style={{
              opacity: stage === s ? 1 : 0,
              backgroundImage: `linear-gradient(${gradient}), url(${import.meta.env.BASE_URL}${image})`,
            }}
          />
        ),
      )}

      <div className="app-main-ui-container">
        {stage !== "start" && (
          <>
            <UiToggleButton
              isUiHidden={isUiHidden}
              onToggle={toggleUiVisibility}
            />
            <MuteButton isMuted={isMuted} onToggle={toggleMute} />
          </>
        )}

        {stage === "start" && (
          <div className="app-start-screen" style={{ opacity }}>
            <h1 className="app-main-title">ブラウザサウナ</h1>
            <p className="app-subtitle">プレミアムな疑似サウナ体験</p>

            <p className="app-headphone-notice">
              <span>🎧</span> ヘッドホン・イヤホン推奨
            </p>

            <div className="app-btn-group">
              <button
                className="primary-btn app-btn-primary"
                onClick={() => handleStart(true)}
              >
                音ありで入室する
              </button>
              <button
                className="primary-btn app-btn-secondary"
                onClick={() => handleStart(false)}
              >
                静かに入室する
              </button>
            </div>
          </div>
        )}

        {stage === "sauna" && (
          <div className="app-stage-container" style={{ opacity }}>
            <SaunaRoom
              audio={audio}
              onNext={(finalHeartRate, duration, loylys) => {
                completeSauna(finalHeartRate, duration, loylys);
              }}
            />
          </div>
        )}

        {stage === "water" && (
          <div className="app-stage-container" style={{ opacity }}>
            <CoolingBath
              initialHeartRate={heartRate}
              onNext={(finalHeartRate, duration) => {
                completeWater(finalHeartRate, duration);
              }}
            />
          </div>
        )}

        {stage === "totonou" && (
          <div className="app-stage-container" style={{ opacity }}>
            <TotonouSpace
              saunaTime={saunaTime}
              waterTime={waterTime}
              loylyCount={loylyCount}
              onNext={() => {
                completeTotonou();
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
