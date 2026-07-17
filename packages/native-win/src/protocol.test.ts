import { describe, expect, it } from 'vitest';
import { parseRecorderLine } from './protocol.js';

describe('parseRecorderLine', () => {
  it('parses ready', () => {
    expect(parseRecorderLine('{"event":"ready","nativeMs":12345.678}')).toEqual({
      event: 'ready',
      nativeMs: 12345.678,
    });
  });

  it('parses firstFrame', () => {
    expect(parseRecorderLine('{"event":"firstFrame","nativeMs":12400.5,"ptsSec":8123.25}')).toEqual(
      {
        event: 'firstFrame',
        nativeMs: 12400.5,
        ptsSec: 8123.25,
      },
    );
  });

  it('parses cursorShape', () => {
    const line =
      '{"event":"cursorShape","nativeMs":13000,"shapeId":"da39a3ee5e6b4b0d3255bfef95601890afd80709",' +
      '"hotspotX":4,"hotspotY":4,"w":32,"h":32}';
    expect(parseRecorderLine(line)).toEqual({
      event: 'cursorShape',
      nativeMs: 13000,
      shapeId: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
      hotspotX: 4,
      hotspotY: 4,
      w: 32,
      h: 32,
    });
  });

  it('parses stats', () => {
    expect(parseRecorderLine('{"event":"stats","frames":120,"dropped":2}')).toEqual({
      event: 'stats',
      frames: 120,
      dropped: 2,
    });
  });

  it('parses stopped', () => {
    expect(parseRecorderLine('{"event":"stopped","durationMs":3016.7}')).toEqual({
      event: 'stopped',
      durationMs: 3016.7,
    });
  });

  it('parses error', () => {
    expect(parseRecorderLine('{"event":"error","message":"boom"}')).toEqual({
      event: 'error',
      message: 'boom',
    });
  });

  it('returns null for torn lines', () => {
    expect(parseRecorderLine('{"event":"ready","nat')).toBeNull();
  });

  it('returns null for unknown events', () => {
    expect(parseRecorderLine('{"event":"heartbeat","nativeMs":1}')).toBeNull();
  });

  it('returns null for known events with malformed payloads', () => {
    expect(parseRecorderLine('{"event":"ready"}')).toBeNull();
    expect(parseRecorderLine('{"event":"ready","nativeMs":"soon"}')).toBeNull();
    expect(parseRecorderLine('{"event":"stopped","durationMs":null}')).toBeNull();
    expect(parseRecorderLine('{"event":"cursorShape","nativeMs":1,"shapeId":"x"}')).toBeNull();
  });

  it('rejects the mac protocol field name (swiftMs)', () => {
    expect(parseRecorderLine('{"event":"ready","swiftMs":12345}')).toBeNull();
  });

  it('returns null for empty and non-object lines', () => {
    expect(parseRecorderLine('')).toBeNull();
    expect(parseRecorderLine('   ')).toBeNull();
    expect(parseRecorderLine('42')).toBeNull();
    expect(parseRecorderLine('[1,2]')).toBeNull();
    expect(parseRecorderLine('null')).toBeNull();
  });
});
