import { useState } from 'react';
import './index.css';
import SceneMode from './components/SceneMode';
import SaunaRoom from './components/SaunaRoom';
import CoolingBath from './components/CoolingBath';
import TotonouSpace from './components/TotonouSpace';
import { FullscreenButton, MuteButton, UiToggleButton } from './components/ControlButtons';
import { useSaunaContext, type Stage } from './context/SaunaContext';
import { useFullscreen } from './hooks/useFullscreen';
import { useKeyboardShortcut } from './hooks/useKeyboardShortcut';

interface BackgroundConfig {
  gradient: string;
  image: string;
}

const BACKGROUNDS: Record<Exclude<Stage, 'start'>, BackgroundConfig> = {
  sauna: {
    gradient: 'rgba(0,0,0,0.45), rgba(0,0,0,0.75)',
    image: 'sauna_bg.webp',
  },
  water: {
    gradient: 'rgba(0,0,0,0.25), rgba(0,0,0,0.65)',
    image: 'water_bg.webp',
  },
  totonou: {
    gradient: 'rgba(0,0,0,0.55), rgba(0,0,0,0.85)',
    image: 'totonou_bg.webp',
  },
};

function App() {
  const {
    stage,
    pendingStage,
    opacity,
    isMuted,
    isUiHidden,
    enteredAt,
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

  const [loylyEvents] = useState(() => new EventTarget());
  const fullscreen = useFullscreen();
  // Space is bound by each stage to its own main action.
  useKeyboardShortcut('m', toggleMute, { enabled: stage !== 'start' });
  useKeyboardShortcut('u', toggleUiVisibility, { enabled: stage !== 'start' });
  useKeyboardShortcut('f', fullscreen.toggle, { enabled: fullscreen.isSupported });
  const background = stage === 'start' ? null : BACKGROUNDS[stage];

  return (
    <div className={`app-container ${isUiHidden ? 'ui-hidden' : ''}`} style={{ background: '#000' }}>
      <div className="background-stack" style={{ opacity }}>
        {background && (
          <div
            key={stage}
            className="app-bg-layer"
            style={{
              backgroundImage: `linear-gradient(${background.gradient}), url(${import.meta.env.BASE_URL}${background.image})`,
            }}
          />
        )}
      </div>
      <SceneMode
        audio={audio}
        stage={stage}
        enteredAt={enteredAt ?? undefined}
        opacity={opacity}
        loylyEvents={loylyEvents}
      />
      <div className="app-main-ui-container">
        {stage !== 'start' && (
          <>
            {fullscreen.isSupported && (
              <FullscreenButton isFullscreen={fullscreen.isFullscreen} onToggle={fullscreen.toggle} />
            )}
            <UiToggleButton isUiHidden={isUiHidden} onToggle={toggleUiVisibility} />
            <MuteButton isMuted={isMuted} onToggle={toggleMute} />
          </>
        )}

        {stage === 'start' && (
          <div className="app-start-screen" style={{ opacity }} inert={pendingStage !== null}>
            <h1 className="app-main-title">ブラウザサウナ</h1>
            <p className="app-subtitle">プレミアムな疑似サウナ体験</p>

            <p className="app-headphone-notice">
              <span>🎧</span> ヘッドホン・イヤホン推奨
            </p>

            <div className="app-btn-group">
              <button className="primary-btn app-btn-primary" onClick={() => handleStart(true)}>
                音ありで入室する
              </button>
              <button className="primary-btn app-btn-secondary" onClick={() => handleStart(false)}>
                静かに入室する
              </button>
            </div>
            <p className="app-shortcut-hint">
              <span>
                <kbd>Space</kbd> ロウリュ・次へ
              </span>
              <span>
                <kbd>M</kbd> ミュート
              </span>
              <span>
                <kbd>U</kbd> UI表示
              </span>
              {fullscreen.isSupported && (
                <span>
                  <kbd>F</kbd> 全画面
                </span>
              )}
            </p>
          </div>
        )}

        {stage !== 'start' && (
          // Keyed by stage so each stage mounts its own container, as separate elements did.
          <div key={stage} className="app-stage-container" style={{ opacity }} inert={pendingStage !== null}>
            {stage === 'sauna' && (
              <SaunaRoom
                audio={audio}
                onLoyly={() => loylyEvents.dispatchEvent(new Event('loyly'))}
                onNext={completeSauna}
              />
            )}
            {stage === 'water' && <CoolingBath initialHeartRate={heartRate} onNext={completeWater} />}
            {stage === 'totonou' && (
              <TotonouSpace
                saunaTime={saunaTime}
                waterTime={waterTime}
                loylyCount={loylyCount}
                onNext={completeTotonou}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
