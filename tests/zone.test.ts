import { describe, expect, it } from 'vitest';
import { feetInSpot, pointInPolygon, type Point, type SpotPolygon } from '../src/vision/zone';
import { countOnSpot } from '../src/vision/manager';

const square: SpotPolygon = {
  points: [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.75, 0.75],
    [0.25, 0.75],
  ],
};

describe('pointInPolygon', () => {
  it('returns true for a point strictly inside', () => {
    expect(pointInPolygon([0.5, 0.5], square)).toBe(true);
  });

  it('returns false for a point outside', () => {
    expect(pointInPolygon([0.9, 0.9], square)).toBe(false);
    expect(pointInPolygon([0.1, 0.5], square)).toBe(false);
  });

  it('treats a point on a vertex as inside', () => {
    expect(pointInPolygon([0.25, 0.25], square)).toBe(true);
  });

  it('returns false for a degenerate polygon (<3 points)', () => {
    expect(pointInPolygon([0.5, 0.5], { points: [] })).toBe(false);
    expect(
      pointInPolygon([0.5, 0.5], { points: [[0.25, 0.25], [0.75, 0.75]] as Point[] }),
    ).toBe(false);
  });

  it('handles concave polygons', () => {
    // L-shape: the notch (top-right) is outside, the bar (bottom) is inside.
    const l: SpotPolygon = {
      points: [
        [0, 0],
        [0.5, 0],
        [0.5, 0.5],
        [1, 0.5],
        [1, 1],
        [0, 1],
      ],
    };
    expect(pointInPolygon([0.2, 0.8], l)).toBe(true);
    expect(pointInPolygon([0.75, 0.25], l)).toBe(false);
  });
});

describe('feetInSpot', () => {
  it('returns true when any foot is inside', () => {
    expect(
      feetInSpot(
        [
          [0.1, 0.1],
          [0.5, 0.5],
        ],
        square,
      ),
    ).toBe(true);
  });

  it('returns false when all feet are outside', () => {
    expect(
      feetInSpot(
        [
          [0.1, 0.1],
          [0.9, 0.9],
        ],
        square,
      ),
    ).toBe(false);
  });

  it('returns false for an empty feet list', () => {
    expect(feetInSpot([], square)).toBe(false);
  });
});

describe('countOnSpot (one-rider rule)', () => {
  it('counts only face-visible persons whose feet are in the spot', () => {
    const persons = [
      { feet: [0.5, 0.5] as [number, number], face: true }, // on spot
      { feet: [0.9, 0.9] as [number, number], face: true }, // off spot
      { feet: [0.5, 0.5] as [number, number], face: false }, // on spot, no face
    ];
    expect(countOnSpot(persons, square)).toBe(1);
  });

  it('returns 0 without a calibrated spot', () => {
    expect(countOnSpot([{ feet: [0.5, 0.5], face: true }], null)).toBe(0);
  });

  it('counts two on the spot so the caller can refuse to start', () => {
    const persons = [
      { feet: [0.4, 0.5] as [number, number], face: true },
      { feet: [0.6, 0.5] as [number, number], face: true },
    ];
    expect(countOnSpot(persons, square)).toBe(2);
  });
});
