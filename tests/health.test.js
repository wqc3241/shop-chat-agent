import { describe, it, expect } from 'vitest';
import { loader } from '~/routes/health';

describe('Health check endpoint', () => {
  it('returns 200 with status ok', async () => {
    const request = new Request('http://localhost/health');
    const response = await loader({ request });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
    expect(new Date(body.timestamp).getTime()).not.toBeNaN();
  });

  it('sets correct content-type header', async () => {
    const request = new Request('http://localhost/health');
    const response = await loader({ request });
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });
});
