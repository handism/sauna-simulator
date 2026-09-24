import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import App from '../App';
import { SaunaProvider } from '../context/SaunaContext';
import * as useAudioEngineModule from '../hooks/useAudioEngine';

// Mock child components to isolate App testing
vi.mock('../components/SaunaRoom', () => ({
  default: ({ onNext }: any) => (
    <div data-testid="sauna-room">
      <button onClick={() => onNext(100, 10, 2)}>Next to Water</button>
    </div>
  ),
}));

vi.mock('../components/CoolingBath', () => ({
  default: ({ onNext }: any) => (
    <div data-testid="cooling-bath">
      <button onClick={() => onNext(80, 2)}>Next to Totonou</button>
    </div>
  ),
}));

vi.mock('../components/TotonouSpace', () => ({
  default: ({ onNext }: any) => (
    <div data-testid="totonou-space">
      <button onClick={() => onNext()}>Next to Sauna</button>
    </div>
  ),
}));

const renderWithProvider = (ui: React.ReactElement) => render(<SaunaProvider>{ui}</SaunaProvider>);

describe('App Component', () => {
  const mockAudioEngine = {
    init: vi.fn(),
    playLoyly: vi.fn(),
    setMuted: vi.fn(),
    setSpatialPose: vi.fn(),
    playAmbient: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(useAudioEngineModule, 'useAudioEngine').mockReturnValue(mockAudioEngine);
  });

  it('renders start screen initially', () => {
    renderWithProvider(<App />);
    expect(screen.getByText('ブラウザサウナ')).toBeInTheDocument();
    expect(screen.getByText('音ありで入室する')).toBeInTheDocument();
    expect(screen.getByText('静かに入室する')).toBeInTheDocument();
  });

  it('starts experience with sound when "音ありで入室する" is clicked', async () => {
    renderWithProvider(<App />);
    const button = screen.getByText('音ありで入室する');
    fireEvent.click(button);

    expect(mockAudioEngine.init).toHaveBeenCalled();
    expect(mockAudioEngine.setMuted).toHaveBeenCalledWith(false);
    expect(mockAudioEngine.playAmbient).not.toHaveBeenCalled();

    await waitFor(
      () => {
        expect(screen.getByTestId('sauna-room')).toBeInTheDocument();
      },
      { timeout: 1500 },
    );
  });

  it('starts experience muted when "静かに入室する" is clicked', async () => {
    renderWithProvider(<App />);
    const button = screen.getByText('静かに入室する');
    fireEvent.click(button);

    expect(mockAudioEngine.init).toHaveBeenCalled();
    expect(mockAudioEngine.setMuted).toHaveBeenCalledWith(true);
    expect(mockAudioEngine.playAmbient).not.toHaveBeenCalled();

    await waitFor(
      () => {
        expect(screen.getByTestId('sauna-room')).toBeInTheDocument();
      },
      { timeout: 1500 },
    );
  });

  it('transitions through stages correctly', async () => {
    renderWithProvider(<App />);

    // Start -> Sauna
    fireEvent.click(screen.getByText('音ありで入室する'));

    await waitFor(
      () => {
        expect(screen.getByTestId('sauna-room')).toBeInTheDocument();
      },
      { timeout: 1500 },
    );

    // Sauna -> Water
    fireEvent.click(screen.getByText('Next to Water'));

    await waitFor(
      () => {
        expect(screen.getByTestId('cooling-bath')).toBeInTheDocument();
      },
      { timeout: 1500 },
    );
    expect(mockAudioEngine.playAmbient).toHaveBeenCalledWith('water');

    // Water -> Totonou
    fireEvent.click(screen.getByText('Next to Totonou'));

    await waitFor(
      () => {
        expect(screen.getByTestId('totonou-space')).toBeInTheDocument();
      },
      { timeout: 1500 },
    );
    expect(mockAudioEngine.playAmbient).toHaveBeenCalledWith('totonou');

    // Totonou -> Sauna
    fireEvent.click(screen.getByText('Next to Sauna'));

    await waitFor(
      () => {
        expect(screen.getByTestId('sauna-room')).toBeInTheDocument();
      },
      { timeout: 1500 },
    );
    expect(mockAudioEngine.playAmbient).toHaveBeenCalledWith('sauna');
  });

  it('toggles mute correctly', async () => {
    renderWithProvider(<App />);

    // Start without sound
    fireEvent.click(screen.getByText('静かに入室する'));

    await waitFor(
      () => {
        expect(screen.getByTestId('sauna-room')).toBeInTheDocument();
      },
      { timeout: 1500 },
    );

    // Initial state (muted)
    const muteButton = screen.getByRole('button', { name: 'ミュート解除' });
    expect(muteButton).toBeInTheDocument();

    // Toggle mute (unmute)
    fireEvent.click(muteButton);
    expect(mockAudioEngine.setMuted).toHaveBeenCalledWith(false);

    // Check if the button changed to 'ミュート'
    const unmuteButton = screen.getByRole('button', { name: 'ミュート' });
    expect(unmuteButton).toBeInTheDocument();
  });

  it('toggles UI visibility correctly', async () => {
    renderWithProvider(<App />);

    // Start
    fireEvent.click(screen.getByText('音ありで入室する'));

    await waitFor(
      () => {
        expect(screen.getByTestId('sauna-room')).toBeInTheDocument();
      },
      { timeout: 1500 },
    );

    // Initial state (UI should not be hidden)
    const container = screen.getByLabelText('UI非表示').closest('.app-container');
    expect(container).not.toHaveClass('ui-hidden');

    // Toggle UI (hide)
    const toggleButton = screen.getByLabelText('UI非表示');
    fireEvent.click(toggleButton);

    expect(container).toHaveClass('ui-hidden');
    expect(screen.getByLabelText('UI表示')).toBeInTheDocument();

    // Toggle UI (show again)
    const showButton = screen.getByLabelText('UI表示');
    fireEvent.click(showButton);

    expect(container).not.toHaveClass('ui-hidden');
    expect(screen.getByLabelText('UI非表示')).toBeInTheDocument();
  });

  const enterSauna = async () => {
    fireEvent.click(screen.getByText('静かに入室する'));
    await waitFor(() => expect(screen.getByTestId('sauna-room')).toBeInTheDocument(), { timeout: 1500 });
  };

  it('toggles mute and UI visibility with the M and U keys once the session has started', async () => {
    renderWithProvider(<App />);

    // Before entry the audio graph does not exist yet and the entry buttons pick the mute state.
    fireEvent.keyDown(document.body, { key: 'm' });
    expect(mockAudioEngine.setMuted).not.toHaveBeenCalled();

    await enterSauna();
    const container = screen.getByLabelText('UI非表示').closest('.app-container');

    fireEvent.keyDown(document.body, { key: 'm' });
    expect(mockAudioEngine.setMuted).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('button', { name: 'ミュート' })).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'u' });
    expect(container).toHaveClass('ui-hidden');
    fireEvent.keyDown(document.body, { key: 'u' });
    expect(container).not.toHaveClass('ui-hidden');
  });

  it('hides fullscreen controls where the Fullscreen API is unavailable', async () => {
    renderWithProvider(<App />);
    expect(screen.queryByText('全画面')).not.toBeInTheDocument();

    await enterSauna();
    expect(screen.queryByRole('button', { name: '全画面表示' })).not.toBeInTheDocument();
  });

  describe('with the Fullscreen API', () => {
    let fullscreenElement: Element | null;
    const requestFullscreen = vi.fn(() => {
      fullscreenElement = document.documentElement;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    });
    const exitFullscreen = vi.fn(() => {
      fullscreenElement = null;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    });

    beforeEach(() => {
      fullscreenElement = null;
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement });
      Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen });
      Object.defineProperty(document.documentElement, 'requestFullscreen', {
        configurable: true,
        value: requestFullscreen,
      });
    });

    afterEach(() => {
      for (const key of ['fullscreenEnabled', 'fullscreenElement', 'exitFullscreen']) {
        delete (document as any)[key];
      }
      delete (document.documentElement as any).requestFullscreen;
    });

    it('toggles fullscreen from the button', async () => {
      renderWithProvider(<App />);
      await enterSauna();

      fireEvent.click(screen.getByRole('button', { name: '全画面表示' }));
      expect(requestFullscreen).toHaveBeenCalledTimes(1);

      fireEvent.click(await screen.findByRole('button', { name: '全画面を終了' }));
      expect(exitFullscreen).toHaveBeenCalledTimes(1);
      expect(await screen.findByRole('button', { name: '全画面表示' })).toBeInTheDocument();
    });

    it('toggles fullscreen with the F key, including on the start screen', async () => {
      renderWithProvider(<App />);
      expect(screen.getByText('全画面')).toBeInTheDocument();

      fireEvent.keyDown(document.body, { key: 'f' });
      expect(requestFullscreen).toHaveBeenCalledTimes(1);

      await enterSauna();
      expect(screen.getByRole('button', { name: '全画面を終了' })).toBeInTheDocument();
      fireEvent.keyDown(document.body, { key: 'f' });
      expect(exitFullscreen).toHaveBeenCalledTimes(1);
    });

    it('ignores a refused fullscreen request', async () => {
      requestFullscreen.mockImplementationOnce(() => Promise.reject(new TypeError('denied')));
      renderWithProvider(<App />);
      await enterSauna();

      fireEvent.click(screen.getByRole('button', { name: '全画面表示' }));
      await Promise.resolve();
      expect(screen.getByRole('button', { name: '全画面表示' })).toBeInTheDocument();
    });
  });
});
