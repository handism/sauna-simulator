import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import App from "../App";
import { SaunaProvider } from "../context/SaunaContext";
import * as useAudioEngineModule from "../hooks/useAudioEngine";

// Mock child components to isolate App testing
vi.mock("../components/SaunaRoom", () => ({
  default: ({ onNext }: any) => (
    <div data-testid="sauna-room">
      <button onClick={() => onNext(100, 10, 2)}>Next to Water</button>
    </div>
  ),
}));

vi.mock("../components/CoolingBath", () => ({
  default: ({ onNext }: any) => (
    <div data-testid="cooling-bath">
      <button onClick={() => onNext(80, 2)}>Next to Totonou</button>
    </div>
  ),
}));

vi.mock("../components/TotonouSpace", () => ({
  default: ({ onNext }: any) => (
    <div data-testid="totonou-space">
      <button onClick={() => onNext()}>Next to Sauna</button>
    </div>
  ),
}));

const renderWithProvider = (ui: React.ReactElement) =>
  render(<SaunaProvider>{ui}</SaunaProvider>);

describe("App Component", () => {
  const mockAudioEngine = {
    init: vi.fn(),
    setMuted: vi.fn(),
    playAmbient: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(useAudioEngineModule, "useAudioEngine").mockReturnValue(
      mockAudioEngine,
    );
  });

  it("renders start screen initially", () => {
    renderWithProvider(<App />);
    expect(screen.getByText("ブラウザサウナ")).toBeInTheDocument();
    expect(screen.getByText("音ありで入室する")).toBeInTheDocument();
    expect(screen.getByText("静かに入室する")).toBeInTheDocument();
  });

  it("starts experience with sound when \"音ありで入室する\" is clicked", async () => {
    renderWithProvider(<App />);
    const button = screen.getByText("音ありで入室する");
    fireEvent.click(button);

    expect(mockAudioEngine.init).toHaveBeenCalled();
    expect(mockAudioEngine.setMuted).toHaveBeenCalledWith(false);
    expect(mockAudioEngine.playAmbient).toHaveBeenCalledWith("sauna");

    await waitFor(
      () => {
        expect(screen.getByTestId("sauna-room")).toBeInTheDocument();
      },
      { timeout: 1500 },
    );
  });

  it("starts experience muted when \"静かに入室する\" is clicked", async () => {
    renderWithProvider(<App />);
    const button = screen.getByText("静かに入室する");
    fireEvent.click(button);

    expect(mockAudioEngine.init).toHaveBeenCalled();
    expect(mockAudioEngine.setMuted).toHaveBeenCalledWith(true);
    expect(mockAudioEngine.playAmbient).toHaveBeenCalledWith("sauna");

    await waitFor(
      () => {
        expect(screen.getByTestId("sauna-room")).toBeInTheDocument();
      },
      { timeout: 1500 },
    );
  });

  it("transitions through stages correctly", async () => {
    renderWithProvider(<App />);

    // Start -> Sauna
    fireEvent.click(screen.getByText("音ありで入室する"));

    await waitFor(
      () => {
        expect(screen.getByTestId("sauna-room")).toBeInTheDocument();
      },
      { timeout: 1500 },
    );

    // Sauna -> Water
    fireEvent.click(screen.getByText("Next to Water"));

    await waitFor(
      () => {
        expect(screen.getByTestId("cooling-bath")).toBeInTheDocument();
      },
      { timeout: 1500 },
    );
    expect(mockAudioEngine.playAmbient).toHaveBeenCalledWith("water");

    // Water -> Totonou
    fireEvent.click(screen.getByText("Next to Totonou"));

    await waitFor(
      () => {
        expect(screen.getByTestId("totonou-space")).toBeInTheDocument();
      },
      { timeout: 1500 },
    );
    expect(mockAudioEngine.playAmbient).toHaveBeenCalledWith("totonou");

    // Totonou -> Sauna
    fireEvent.click(screen.getByText("Next to Sauna"));

    await waitFor(
      () => {
        expect(screen.getByTestId("sauna-room")).toBeInTheDocument();
      },
      { timeout: 1500 },
    );
    expect(mockAudioEngine.playAmbient).toHaveBeenCalledWith("sauna");
  });

  it("toggles mute correctly", async () => {
    renderWithProvider(<App />);

    // Start without sound
    fireEvent.click(screen.getByText("静かに入室する"));

    await waitFor(
      () => {
        expect(screen.getByTestId("sauna-room")).toBeInTheDocument();
      },
      { timeout: 1500 },
    );

    // Initial state (muted)
    const muteButton = screen.getByRole("button", { name: "ミュート解除" });
    expect(muteButton).toBeInTheDocument();

    // Toggle mute (unmute)
    fireEvent.click(muteButton);
    expect(mockAudioEngine.setMuted).toHaveBeenCalledWith(false);

    // Check if the button changed to 'ミュート'
    const unmuteButton = screen.getByRole("button", { name: "ミュート" });
    expect(unmuteButton).toBeInTheDocument();
  });

  it("toggles UI visibility correctly", async () => {
    renderWithProvider(<App />);

    // Start
    fireEvent.click(screen.getByText("音ありで入室する"));

    await waitFor(
      () => {
        expect(screen.getByTestId("sauna-room")).toBeInTheDocument();
      },
      { timeout: 1500 },
    );

    // Initial state (UI should not be hidden)
    const container = screen
      .getByLabelText("UI非表示")
      .closest(".app-container");
    expect(container).not.toHaveClass("ui-hidden");

    // Toggle UI (hide)
    const toggleButton = screen.getByLabelText("UI非表示");
    fireEvent.click(toggleButton);

    expect(container).toHaveClass("ui-hidden");
    expect(screen.getByLabelText("UI表示")).toBeInTheDocument();

    // Toggle UI (show again)
    const showButton = screen.getByLabelText("UI表示");
    fireEvent.click(showButton);

    expect(container).not.toHaveClass("ui-hidden");
    expect(screen.getByLabelText("UI非表示")).toBeInTheDocument();
  });
});
