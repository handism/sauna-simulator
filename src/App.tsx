import SoundControl from './components/SoundControl';
import { readPreference, writePreference } from './utils/preferences';
import { useEffect, useRef, useState } from 'react';
import './index.css';
import SceneMode from './components/SceneMode';
import { ActionIcon } from './components/ActionIcon';
import ScoreHistory from './components/ScoreHistory';
import SaunaRoom from './components/SaunaRoom';
import CoolingBath from './components/CoolingBath';
import TotonouSpace from './components/TotonouSpace';
import { FullscreenMenuButton, UiToggleButton } from './components/ControlButtons';
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
    volume,
    setVolume,
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

  const [keepBreathing, setKeepBreathing] = useState(
    () => readPreference('sui-keep-breathing', ['yes', 'no'], 'no') === 'yes',
  );
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
    <div
      className={`app-container ${isUiHidden ? 'ui-hidden' : ''}`}
      data-keep-breathing={keepBreathing}
      style={{ background: '#000' }}
    >
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
        keepBreathing={keepBreathing}
        settingsExtra={
          fullscreen.isSupported && (
            <FullscreenMenuButton isFullscreen={fullscreen.isFullscreen} onToggle={fullscreen.toggle} />
          )
        }
        onKeepBreathingChange={(value) => {
          setKeepBreathing(value);
          writePreference('sui-keep-breathing', value ? 'yes' : 'no');
        }}
      >
        {(is3d, toggle3d, settings) => (
          <div className="app-main-ui-container" ref={contentRef}>
            {/* 右上の操作はすべてここに並べる。入室前は表示設定だけ。全画面は表示設定の中 */}
            <div className="app-toolbar">
              {stage !== 'start' && (
                <>
                  <UiToggleButton isUiHidden={isUiHidden} onToggle={toggleUiVisibility} />
                  <SoundControl
                    key={stage}
                    isMuted={isMuted}
                    volume={volume}
                    onMute={toggleMute}
                    onVolume={setVolume}
                  />
                </>
              )}
              {settings}
            </div>

            {stage === 'start' && !sessionSummary && (
              <div className="app-start-screen" style={{ opacity }} inert={pendingStage !== null}>
                <p className="welcome-eyebrow">湯気と水と風のあいだで</p>
                <h1 className="app-main-title" tabIndex={-1}>
                  ブラウザサウナ
                </h1>
                <p className="app-subtitle">音と景色で、ひと息つく。</p>

                <p className="journey-guide" aria-label="体験の流れ">
                  サウナ <ActionIcon name="arrow" /> 水風呂 <ActionIcon name="arrow" /> 外気浴
                </p>
                {/* 景色は入室前に決めるため、入室ボタンより先に置く */}
                <div className="entry-scene-choice" role="group" aria-label="景色">
                  <button className="segment-btn" aria-pressed={!is3d} onClick={() => is3d && toggle3d()}>
                    2Dの景色
                  </button>
                  <button className="segment-btn" aria-pressed={is3d} onClick={() => !is3d && toggle3d()}>
                    3Dで見渡す
                  </button>
                </div>

                <div className="app-btn-group">
                  <button
                    className="primary-btn app-btn-primary"
                    onClick={() => handleStart(true)}
                    aria-describedby="headphone-note"
                  >
                    音ありで入室する
                  </button>
                  {/* 音ありの補足。押せる部品に見えないよう、面や枠を付けない */}
                  <p id="headphone-note" className="entry-note">
                    <ActionIcon name="headphones" /> ヘッドホン・イヤホン推奨
                  </p>
                  <button className="primary-btn app-btn-secondary" onClick={() => handleStart(false)}>
                    音なしで入室する
                  </button>
                </div>
                <ul className="app-shortcut-hint" aria-label="キーボード操作">
                  <li>
                    <kbd>Space</kbd> 各場面の主な操作
                  </li>
                  <li>
                    <kbd>M</kbd> ミュート
                  </li>
                  <li>
                    <kbd>U</kbd> UI表示切替
                  </li>
                  {fullscreen.isSupported && (
                    <li>
                      <kbd>F</kbd> 全画面
                    </li>
                  )}
                </ul>
              </div>
            )}

            {stage === 'start' && sessionSummary && (
              <section className="app-start-screen session-end" style={{ opacity }} inert={pendingStage !== null}>
                <p className="welcome-eyebrow">おつかれさまでした</p>
                <h1 className="app-main-title" tabIndex={-1}>
                  今日のひと息
                </h1>
                <p className="app-subtitle">この余韻を、日常へ。</p>
                <div className="glass-panel session-summary">
                  <dl className="session-summary-stats">
                    <div>
                      <dt>過ごしたセット</dt>
                      <dd>
                        {sessionSummary.scores.length}
                        <span> セット</span>
                      </dd>
                    </div>
                    <div>
                      <dt>滞在時間</dt>
                      {/* 1分未満は「0分」を付けず秒だけにする */}
                      <dd>
                        {sessionSummary.seconds >= 60 && (
                          <>
                            {Math.floor(sessionSummary.seconds / 60)}
                            <span> 分 </span>
                          </>
                        )}
                        {sessionSummary.seconds % 60}
                        <span> 秒</span>
                      </dd>
                    </div>
                  </dl>
                  {sessionSummary.scores.length > 0 && (
                    <details className="score-details session-summary-history">
                      <summary>体験内のスコアを見る</summary>
                      <p className="detail-note">ととのい度は体験内の遊びの指標です。</p>
                      <ScoreHistory scores={sessionSummary.scores} />
                    </details>
                  )}
                </div>
                {/* トップに戻るのが主操作。続けて入りたい人は入室画面を経ずに、今の音の設定のまま入り直せる */}
                <div className="session-end-actions">
                  <button className="primary-btn session-end-btn" onClick={dismissSummary}>
                    トップに戻る <ActionIcon name="arrow" />
                  </button>
                  <button className="primary-btn session-reenter-btn" onClick={() => handleStart(!isMuted)}>
                    <ActionIcon name="repeat" /> もう一度入室する
                  </button>
                </div>
              </section>
            )}

            {stage !== 'start' && (
              // Keyed by stage so each stage mounts its own container, as separate elements did.
              <div key={stage} className="app-stage-container" style={{ opacity }} inert={pendingStage !== null}>
                {stage === 'sauna' && (
                  <SaunaRoom
                    audio={audio}
                    setNumber={scoreHistory.length + 1}
                    onLoyly={() => loylyEvents.dispatchEvent(new Event('loyly'))}
                    onNext={completeSauna}
                  />
                )}
                {stage === 'water' && (
                  <CoolingBath
                    initialHeartRate={heartRate}
                    setNumber={scoreHistory.length + 1}
                    onNext={completeWater}
                  />
                )}
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
        )}
      </SceneMode>
    </div>
  );
}

export default App;
