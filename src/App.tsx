import { useState } from 'react';
import './index.css';
import SceneMode from './components/SceneMode';
import SaunaRoom from './components/SaunaRoom';
import CoolingBath from './components/CoolingBath';
import TotonouSpace from './components/TotonouSpace';
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
    image: 'sauna_bg.png',
  },
  water: {
    gradient: 'rgba(0,0,0,0.25), rgba(0,0,0,0.65)',
    image: 'water_bg.png',
  },
  totonou: {
    gradient: 'rgba(0,0,0,0.55), rgba(0,0,0,0.85)',
    image: 'totonou_bg.png',
  },
};

function UiToggleButton({ isUiHidden, onToggle }: { isUiHidden: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="mute-btn ui-toggle-btn"
      style={{ right: '72px', opacity: isUiHidden ? 0.3 : 1 }}
      onClick={onToggle}
      aria-label={isUiHidden ? 'UI表示' : 'UI非表示'}
      aria-pressed={isUiHidden}
      aria-keyshortcuts="U"
      title={isUiHidden ? 'UI表示 (U)' : 'UI非表示 (U)'}
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

function MuteButton({ isMuted, onToggle }: { isMuted: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="mute-btn"
      onClick={onToggle}
      aria-label={isMuted ? 'ミュート解除' : 'ミュート'}
      aria-pressed={isMuted}
      aria-keyshortcuts="M"
      title={isMuted ? 'ミュート解除 (M)' : 'ミュート (M)'}
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

function FullscreenButton({ isFullscreen, onToggle }: { isFullscreen: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="mute-btn"
      style={{ right: '128px' }}
      onClick={onToggle}
      aria-label={isFullscreen ? '全画面を終了' : '全画面表示'}
      aria-pressed={isFullscreen}
      aria-keyshortcuts="F"
      title={isFullscreen ? '全画面を終了 (F)' : '全画面表示 (F)'}
    >
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
        {isFullscreen ? (
          <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
        ) : (
          <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
        )}
      </svg>
    </button>
  );
}

function App() {
  const {
    stage,
    pendingStage,
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
      <SceneMode audio={audio} stage={stage} opacity={opacity} loylyEvents={loylyEvents} />
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

        {stage === 'sauna' && (
          <div className="app-stage-container" style={{ opacity }} inert={pendingStage !== null}>
            <SaunaRoom
              audio={audio}
              onLoyly={() => loylyEvents.dispatchEvent(new Event('loyly'))}
              onNext={completeSauna}
            />
          </div>
        )}

        {stage === 'water' && (
          <div className="app-stage-container" style={{ opacity }} inert={pendingStage !== null}>
            <CoolingBath initialHeartRate={heartRate} onNext={completeWater} />
          </div>
        )}

        {stage === 'totonou' && (
          <div className="app-stage-container" style={{ opacity }} inert={pendingStage !== null}>
            <TotonouSpace
              saunaTime={saunaTime}
              waterTime={waterTime}
              loylyCount={loylyCount}
              onNext={completeTotonou}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
