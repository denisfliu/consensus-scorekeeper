import { describe, it, expect } from 'vitest';

describe('vitest setup', () => {
  it('can run a basic assertion', () => {
    expect(1 + 1).toBe(2);
  });

  it('has a dom (happy-dom)', () => {
    document.body.innerHTML = '<div id="t">hi</div>';
    expect(document.getElementById('t').textContent).toBe('hi');
  });
});
