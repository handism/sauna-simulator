import VolumeSetting from './components/VolumeSetting';
import { useEffect, useRef, useState } from 'react';
import './index.css';
import SceneMode from './components/SceneMode';
import { ActionIcon } from './components/ActionIcon';
import ScoreHistory from './components/ScoreHistory';
import { formatPreviousVisit } from './utils/visitLog';
import SaunaRoom from './components/SaunaRoom';
import CoolingBath from './components/CoolingBath';
import TotonouSpace from './components/TotonouSpace';
import { FullscreenMenuButton, MuteButton, UiToggleButton } from './components/ControlButtons';
import { useSaunaContext, type AmbientEnv } from './context/SaunaContext';
import { useFullscreen } from './hooks/useFullscreen';
import { useKeyboardShortcut } from './hooks/useKeyboardShortcut';
import { useWakeLock } from './hooks/useWakeLock';

// 計測用（e2e・診断スクリプト）。入室ボタンで音なしに入る。利用者向けの選択肢は出さない
const startsMuted = () => new URLSearchParams(window.location.search).get('sound') === 'off';

interface BackgroundConfig {
  gradient: string;
  image: string;
}

const BACKGROUNDS: Record<AmbientEnv, BackgroundConfig> = {
  sauna: {
    gradient: 'rgba(0,0,0,0.22), rgba(0,0,0,0.40)',
    image: 'sauna_bg.webp',
  },
  water: {
    gradient: 'rgba(0,0,0,0.15), rgba(0,0,0,0.35)',
    image: 'water_bg.webp',
  },
  totonou: {
    gradient: 'rgba(0,0,0,0.20), rgba(0,0,0,0.35)',
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

  const [loylyEvents] = useState(() => new EventTarget());
  const fullscreen = useFullscreen();
  // 外気浴などで操作しない時間が続いても、入室中は画面を消さない
  useWakeLock(stage !== 'start');
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
            data-image={background.image}
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
        settingsExtra={
          <>
            {stage !== 'start' && <VolumeSetting volume={volume} onVolume={setVolume} />}
            {fullscreen.isSupported && (
              <FullscreenMenuButton isFullscreen={fullscreen.isFullscreen} onToggle={fullscreen.toggle} />
            )}
          </>
        }
      >
        {(is3d, toggle3d, settings) => (
          <div className="app-main-ui-container" ref={contentRef}>
            {/* 右上の操作はすべてここに並べる。入室前は設定だけ。音量・全画面は設定の中。
                入室後はアイコンの下に名前を添える（アイコンだけでは意味が取りにくい） */}
            <div className="app-toolbar" data-labeled={stage !== 'start'}>
              {stage !== 'start' && (
                <>
                  <UiToggleButton isUiHidden={isUiHidden} onToggle={toggleUiVisibility} />
                  <MuteButton isMuted={isMuted} onToggle={toggleMute} />
                </>
              )}
              {settings}
            </div>

            {stage === 'start' && !sessionSummary && (
              <div className="app-start-screen" style={{ opacity }} inert={pendingStage !== null}>
                <h1 className="app-main-title" tabIndex={-1}>
                  ブラウザサウナ
                </h1>
                <p className="app-subtitle">音と景色で、ひと息つく。</p>

                {/* 流れと所要時間を1行で伝える。狭い画面では所要時間が次の行に回る */}
                <p className="journey-guide">
                  <span className="visually-hidden">体験の流れ：</span>
                  <span className="journey-steps">
                    サウナ <ActionIcon name="arrow" /> 水風呂 <ActionIcon name="arrow" /> 外気浴
                  </span>
                  <span className="journey-note">1セット約1〜2分・移動は自由</span>
                </p>
                {/* 景色は入室前に決めるため、入室ボタンより先に置く。説明は各選択肢の中に小さく添える */}
                <div className="entry-scene-choice" role="group" aria-label="景色">
                  <button className="segment-btn" aria-pressed={!is3d} onClick={() => is3d && toggle3d()}>
                    2Dの景色
                    <span className="segment-note">静かな一枚絵</span>
                  </button>
                  <button className="segment-btn" aria-pressed={is3d} onClick={() => !is3d && toggle3d()}>
                    3Dで見渡す
                    <span className="segment-note">ぐるりと見回せる</span>
                  </button>
                </div>

                {/* 入室は1つだけ。音は入室後に右上のミュートで切り替える */}
                <div className="app-btn-group">
                  <button
                    className="primary-btn app-btn-primary"
                    onClick={() => handleStart(!startsMuted())}
                    aria-describedby="headphone-note"
                  >
                    入室する
                  </button>
                  {/* 補足。押せる部品に見えないよう、面や枠を付けない */}
                  <p id="headphone-note" className="entry-note">
                    <ActionIcon name="headphones" /> 音が鳴ります（ヘッドホン推奨）
                  </p>
                </div>
              </div>
            )}

            {stage === 'start' && sessionSummary && (
              <section className="app-start-screen session-end" style={{ opacity }} inert={pendingStage !== null}>
                <h1 className="app-main-title" tabIndex={-1}>
                  おつかれさまでした
                </h1>
                <div className="glass-panel session-summary">
                  <dl className="session-summary-stats">
                    <div>
                      <dt>完了したセット</dt>
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
                    <div className="session-summary-history">
                      <p className="session-summary-caption">セットごとのととのい度</p>
                      <ScoreHistory scores={sessionSummary.scores} />
                    </div>
                  )}
                  {/* この端末での通算。数字を競わせないよう、控えめな1行に留める */}
                  {sessionSummary.totals && (
                    <p className="session-summary-log">
                      {sessionSummary.totals.visits === 1
                        ? 'この端末での最初の記録です'
                        : `通算 ${sessionSummary.totals.visits}回目・累計 ${sessionSummary.totals.totalSets}セット`}
                      {sessionSummary.totals.previousAt !== null &&
                        `（前回 ${formatPreviousVisit(sessionSummary.totals.previousAt)}）`}
                    </p>
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
                    onFinish={finishSession}
                  />
                )}
                {stage === 'water' && (
                  <CoolingBath
                    initialHeartRate={heartRate}
                    setNumber={scoreHistory.length + 1}
                    onNext={completeWater}
                    onFinish={finishSession}
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
