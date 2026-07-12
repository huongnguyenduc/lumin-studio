import { describe, it, expect } from 'vitest';
import { modelMimeFor, sha256Hex } from '../src/lib/upload-model';

// Pins the two pure bits of the model upload (P3-l l-2): the extension→MIME bounce (so we never upload a
// file Garage would refuse) and the SHA-256 content hash used as the asset-job `sourceVersion` (ADR-004).
// The presign/POST/enqueue I/O is covered by Playwright in Phase 5, not here.

describe('modelMimeFor', () => {
  it('maps the 3 accepted extensions (case-insensitive) and rejects the rest', () => {
    expect(modelMimeFor('lamp.glb')).toBe('model/gltf-binary');
    expect(modelMimeFor('lamp.STL')).toBe('model/stl');
    expect(modelMimeFor('lamp.3mf')).toBe('model/3mf');
    expect(modelMimeFor('archive.tar.glb')).toBe('model/gltf-binary'); // only the last extension counts
    expect(modelMimeFor('photo.png')).toBeNull();
    expect(modelMimeFor('noext')).toBeNull();
  });
});

describe('sha256Hex', () => {
  it('matches the known SHA-256 vectors (lowercase hex)', async () => {
    const abc = new TextEncoder().encode('abc');
    expect(await sha256Hex(abc.buffer)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    const empty = new Uint8Array(0);
    expect(await sha256Hex(empty.buffer)).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});
