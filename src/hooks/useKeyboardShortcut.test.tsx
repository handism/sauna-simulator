import { useRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useKeyboardShortcut } from './useKeyboardShortcut';

function Harness({ shortcut, onPress, inert = false }: { shortcut: string; onPress: () => void; inert?: boolean }) {
  const scope = useRef<HTMLDivElement>(null);
  useKeyboardShortcut(shortcut, onPress, { scope });
  return (
    <div inert={inert}>
      <div ref={scope}>
        <input aria-label="text" />
        <select aria-label="choice">
          <option>m</option>
        </select>
      </div>
      <button type="button">other</button>
    </div>
  );
}

describe('useKeyboardShortcut', () => {
  it('runs on a bare key press, ignoring case, and prevents the default', () => {
    const onPress = vi.fn();
    render(<Harness shortcut="m" onPress={onPress} />);

    expect(fireEvent.keyDown(document.body, { key: 'm' })).toBe(false);
    fireEvent.keyDown(document.body, { key: 'M' });
    fireEvent.keyDown(document.body, { key: 'n' });
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('leaves modified, repeated and composing presses to the browser', () => {
    const onPress = vi.fn();
    render(<Harness shortcut="f" onPress={onPress} />);

    for (const init of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }]) {
      expect(fireEvent.keyDown(document.body, { key: 'f', ...init })).toBe(true);
    }
    fireEvent.keyDown(document.body, { key: 'f', isComposing: true });
    expect(onPress).not.toHaveBeenCalled();
  });

  it('ignores keys typed into form fields', () => {
    const onPress = vi.fn();
    render(<Harness shortcut="m" onPress={onPress} />);

    fireEvent.keyDown(screen.getByLabelText('text'), { key: 'm' });
    fireEvent.keyDown(screen.getByLabelText('choice'), { key: 'm' });
    expect(onPress).not.toHaveBeenCalled();
  });

  it('ignores presses while the scope is inert', () => {
    const onPress = vi.fn();
    render(<Harness shortcut=" " onPress={onPress} inert />);

    fireEvent.keyDown(document.body, { key: ' ' });
    expect(onPress).not.toHaveBeenCalled();
  });

  it('keeps native Space activation on a keyboard-focused button', () => {
    const onPress = vi.fn();
    render(<Harness shortcut=" " onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'other' });
    fireEvent.pointerDown(document.body);
    fireEvent.pointerUp(document.body);
    button.focus();

    expect(fireEvent.keyDown(button, { key: ' ' })).toBe(true);
    expect(onPress).not.toHaveBeenCalled();
    expect(button).toHaveFocus();
  });

  it('takes Space from a button focused by a click so it is not clicked as well', () => {
    const onPress = vi.fn();
    render(<Harness shortcut=" " onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'other' });
    fireEvent.pointerDown(button);
    button.focus();
    fireEvent.pointerUp(button);

    expect(fireEvent.keyDown(button, { key: ' ' })).toBe(false);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(button).not.toHaveFocus();
  });

  it('removes the listener on unmount', () => {
    const onPress = vi.fn();
    const { unmount } = render(<Harness shortcut="u" onPress={onPress} />);
    unmount();

    fireEvent.keyDown(document.body, { key: 'u' });
    expect(onPress).not.toHaveBeenCalled();
  });
});
