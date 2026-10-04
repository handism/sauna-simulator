import { useEffect, useRef, useState } from 'react';
import './index.css';
import SceneMode from './components/SceneMode';
import { ActionIcon } from './components/ActionIcon';
import ScoreHistory from './components/ScoreHistory';
import SaunaRoom from './components/SaunaRoom';
import CoolingBath from './components/CoolingBath';
import TotonouSpace from './components/TotonouSpace';
import { FullscreenButton, MuteButton, UiToggleButton } from './components/ControlButtons';
import { useSaunaContext, type AmbientEnv } from './context/SaunaContext';
import { useFullscreen } from './hooks/useFullscreen';
import { useKeyboardShortcut } from './hooks/useKeyboardShortcut';

interface BackgroundConfig {
  gradient: string;
  image: string;
}

const BACKGROUNDS: Record<AmbientEnv, BackgroundConfig> = {
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
    scoreHistory,
    audio,
    handleStart,
    toggleMute,
    toggleUiVisibility,
    completeSauna,
    completeWater,
    completeTotonou,
    finishSession,
    sessionSummary,
    dismissSummary,
  } = useSaunaContext();

  const [loylyEvents] = useState(() => new EventTarget());
  const fullscreen = useFullscreen();
  // Space is bound by each stage to its own main action.
  useKeyboardShortcut('m', toggleMute, { enabled: stage !== 'start' });
  useKeyboardShortcut('u', toggleUiVisibility, { enabled: stage !== 'start' });
  useKeyboardShortcut('f', fullscreen.toggle, { enabled: fullscreen.isSupported });
  const background = BACKGROUNDS[stage === 'start' ? (sessionSummary ? 'totonou' : 'sauna') : stage];
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    contentRef.current?.querySelector<HTMLElement>('h1, h2')?.focus({ preventScroll: true });
  }, [stage, sessionSummary]);

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
      <div className="app-main-ui-container" ref={contentRef}>
        {stage !== 'start' && (
          <div className="app-toolbar">
            {fullscreen.isSupported && (
              <FullscreenButton isFullscreen={fullscreen.isFullscreen} onToggle={fullscreen.toggle} />
            )}
            <UiToggleButton isUiHidden={isUiHidden} onToggle={toggleUiVisibility} />
            <MuteButton isMuted={isMuted} onToggle={toggleMute} />
          </div>
        )}

        {stage === 'start' && !sessionSummary && (
          <div className="app-start-screen" style={{ opacity }} inert={pendingStage !== null}>
            <p className="welcome-eyebrow">ひと息つく、あなたの場所</p>
            <h1 className="app-main-title" tabIndex={-1}>
              ブラウザサウナ
            </h1>
            <p className="app-subtitle">音と景色で、ひと息つく。</p>

            <p className="journey-guide" aria-label="体験の流れ">
              サウナ <ActionIcon name="arrow" /> 水風呂 <ActionIcon name="arrow" /> 外気浴
            </p>
            <p className="app-headphone-notice">
              <ActionIcon name="headphones" /> ヘッドホン・イヤホン推奨
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

        {stage === 'start' && sessionSummary && (
          <section className="app-start-screen session-end" style={{ opacity }} inert={pendingStage !== null}>
            <p className="welcome-eyebrow">おつかれさまでした</p>
            <h1 className="app-main-title" tabIndex={-1}>
              今日のひと息
            </h1>
            <p className="app-subtitle">この余韻を、日常へ。</p>
            <dl className="glass-panel session-summary">
              <div>
                <dt>過ごしたセット</dt>
                <dd>
                  {sessionSummary.scores.length}
                  <span> セット</span>
                </dd>
              </div>
              <div>
                <dt>滞在時間</dt>
                <dd>
                  {Math.floor(sessionSummary.seconds / 60)}
                  <span> 分 </span>
                  {sessionSummary.seconds % 60}
                  <span> 秒</span>
                </dd>
              </div>
              {sessionSummary.scores.length > 0 && (
                <div className="session-summary-history">
                  <dt>ととのい度の推移</dt>
                  <dd>
                    <ScoreHistory scores={sessionSummary.scores} />
                  </dd>
                </div>
              )}
            </dl>
            <button className="primary-btn" onClick={dismissSummary}>
              トップに戻る <ActionIcon name="arrow" />
            </button>
          </section>
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
                scoreHistory={scoreHistory}
                onNext={completeTotonou}
                onFinish={finishSession}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
